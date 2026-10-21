/**
 * States whose official address lookup runs on the same rate service
 * (Colorado's salestaxlookup.colorado.gov, Alaska's Remote Seller Sales Tax
 * Commission map): it gives every jurisdiction's dated rate and its
 * outline, keyed by its own place ids, and the state, county or borough,
 * city and every district an address falls in are added.
 *
 * The service is shared across states and numbers new districts anywhere,
 * so a state's jurisdictions are found by asking which hold points across
 * it: a coarse grid over the state, and a few points inside each Census
 * place, where small districts sit, on top of the ids already loaded. The
 * service answers about one point a second, so four batches run at once.
 *
 * Rates are read as of each half-year since 2024 and today, so coverage
 * starts 2024-01-01.
 */
import { latestTigerFiles } from "../downloads.js";
import { contains, readTigerZip, STATE_FIPS } from "../tiger.js";
import { eq } from "drizzle-orm";
import { db } from "../../db.js";
import { salesTaxJurisdictionRates } from "../../schema.js";
import { ringsOf, bboxOf } from "./sources.js";
import type { GeoRateRow, GeoState, GeoStateData } from "./index.js";

const FIRST = "2024-01-01";
/** The service's place ids are plain numbers, which could equal a Census
 *  FIPS code; prefixed, they can't be mistaken for one. */
const CODE_PREFIX = "ttr";

interface Service {
  state: string;
  host: string;
  /** Ids known to be the state's, found even where the grids miss. */
  knownIds: number[];
  bounds: { west: number; east: number; south: number; north: number };
  /** The state-wide grid's spacing, in degrees. */
  step: number;
  /** Points a side, at most, of the grid inside each Census place. */
  townGrid: number;
}
const KINDS: Record<string, "county" | "place" | "district"> = { "3": "county", "4": "place", "5": "district" };
const TYPES: Record<string, string> = { "2": "45", "3": "00", "4": "01", "5": "d" };

/** Colorado: 2.9% state, county, city (state-collected or home rule, which
 *  taxes its own base) and districts such as RTD and the cultural
 *  facilities district. Its first 555 place ids are its own. */
export const colorado = ttrState({
  state: "CO",
  host: "https://salestaxlookup.colorado.gov",
  knownIds: Array.from({ length: 555 }, (_, i) => i + 1),
  bounds: { west: -109.06, east: -102.04, south: 36.99, north: 41.01 },
  step: 0.2,
  townGrid: 3,
});

/** Alaska: no state tax; boroughs and cities, some with seasonal rates the
 *  service dates. Only the Commission's member jurisdictions are in it. */
export const alaska = ttrState({
  state: "AK",
  host: "https://alaska.atr.avalara.com",
  knownIds: [],
  bounds: { west: -179.2, east: -129.9, south: 51.2, north: 71.4 },
  step: 0.5,
  townGrid: 3,
});

function ttrState(service: Service): GeoState {
  return {
    state: service.state,
    fetch: (dir) => fetchState(service, dir),
  };
}

async function fetchState(service: Service, dir?: string): Promise<GeoStateData> {
    const post = (path: string, body: unknown) => request(service.host, path, body);
    const today = new Date().toISOString().slice(0, 10);
    const stored = await db
      .selectDistinct({ code: salesTaxJurisdictionRates.code })
      .from(salesTaxJurisdictionRates)
      .where(eq(salesTaxJurisdictionRates.state, service.state));
    const placeIds = [
      ...new Set([
        ...service.knownIds,
        ...stored.map((r) => Number(r.code.replace(CODE_PREFIX, ""))).filter(Number.isInteger),
        ...(await discoverIds(service, today, dir)),
      ]),
    ];
    const dates = [today];
    for (let d = new Date(`${FIRST}T00:00:00Z`); d.toISOString().slice(0, 10) < today; d.setUTCMonth(d.getUTCMonth() + 6))
      dates.push(d.toISOString().slice(0, 10));

    const found = new Map<string, GeoRateRow>();
    const kindOf = new Map<string, string>();
    for (const date of dates) {
      const body = (await post("rates.byPlace", { placeIds, date, taxTypeFilter: 2, taxTypeIds: [1] })) as {
        places: Record<string, { rates: Array<{ placeId: string; name: string; placeTypeId: string; value: number; effDate: string; endDate: string }> }>;
      };
      for (const { rates } of Object.values(body.places))
        for (const r of rates) {
          const type = TYPES[r.placeTypeId];
          if (!type) continue;
          kindOf.set(r.placeId, r.placeTypeId);
          found.set(`${r.placeId}|${r.effDate}|${r.value}`, {
            type,
            code: type === "45" ? r.placeId : `${CODE_PREFIX}${r.placeId}`,
            rate: r.value,
            startsOn: type === "45" && r.effDate < FIRST ? FIRST : r.effDate,
            endsOn: r.endDate,
          });
        }
    }
    // The state's own rate starts coverage on the first day read.
    const rates = [...found.values()].map((r) =>
      r.type === "45" ? { ...r, startsOn: r.startsOn < FIRST ? FIRST : r.startsOn } : r,
    );

    const shapes: GeoStateData["shapes"] = [];
    const ids = [...kindOf].filter(([, t]) => KINDS[t]).map(([id]) => Number(id));
    // An outline the service can't draw fails its batch; it is split until
    // that one is found and left out (the map then refuses its addresses).
    const outlines = async (batch: number[]): Promise<void> => {
      let body: { shapes: Record<string, string | null> };
      try {
        body = (await post("places.shapes.map", { placeIds: batch, date: today })) as typeof body;
      } catch (error) {
        if (!/answered 500/.test((error as Error).message)) throw error;
        if (batch.length === 1) return console.warn(`${service.state}: no outline for place ${batch[0]}`);
        await outlines(batch.slice(0, Math.ceil(batch.length / 2)));
        await outlines(batch.slice(Math.ceil(batch.length / 2)));
        return;
      }
      for (const [id, geojson] of Object.entries(body.shapes)) {
        if (!geojson) continue;
        const rings = ringsOf(JSON.parse(geojson));
        if (!rings.length) continue;
        shapes.push({ kind: KINDS[kindOf.get(id)!], fips: `${CODE_PREFIX}${id}`, name: id, rings, bbox: bboxOf(rings) });
      }
    };
    for (let i = 0; i < ids.length; i += 15) await outlines(ids.slice(i, i + 15));
    if (!rates.some((r) => r.type === "45"))
      rates.push({ type: "45", code: service.state, rate: 0, startsOn: FIRST, endsOn: "9999-12-31" });
    return {
      rates,
      shapes,
      files: {
        rates: `${service.state} rate service ${new URL(service.host).host} ${FIRST} to ${today}`,
        boundaries: `${service.state} rate service outlines ${today}`,
      },
    };
}

/** Every place id holding a point of the state's grid or its towns' grids. */
async function discoverIds(service: Service, snapshot: string, dir?: string) {
  const { bounds, state, host } = service;
  const points: Array<[number, number]> = [];
  const grid = (west: number, south: number, east: number, north: number, step: number) => {
    for (let lat = south; lat <= north; lat += step)
      for (let lng = west; lng <= east; lng += step) points.push([lat, lng]);
  };
  const fips = STATE_FIPS[state];
  const files = await latestTigerFiles([fips], dir);
  // The state-wide grid keeps only points on land in the state.
  const [countyFile] = files.filter((f) => f.kind === "county");
  const counties = readTigerZip(await countyFile.bytes(), "county", new Set([fips]));
  grid(bounds.west, bounds.south, bounds.east, bounds.north, service.step);
  const onLand = points.filter(([lat, lng]) =>
    counties.some((c) => lng >= c.bbox[0] && lng <= c.bbox[2] && lat >= c.bbox[1] && lat <= c.bbox[3] && contains(c, { lon: lng, lat })),
  );
  points.length = 0;
  points.push(...onLand);
  const [places] = files.filter((f) => f.kind === "place");
  for (const p of readTigerZip(await places.bytes(), "place", new Set([fips]))) {
    const [w, s, e, n] = p.bbox;
    grid(w, s, e, n, Math.max(0.02, (e - w) / service.townGrid, (n - s) / service.townGrid));
    points.push([(s + n) / 2, (w + e) / 2]);
  }
  // A point outside every state fails its whole batch, so a failing batch
  // is split until the point is found and dropped.
  const ids = new Set<number>();
  const ask = async (batch: Array<[number, number]>): Promise<void> => {
    let body: { places: Array<{ results?: Array<{ placeId: string }> }> };
    try {
      body = (await request(host, "places.pinpoints", {
        queries: batch.map(([lat, lng]) => `${lat}, ${lng}`),
        pinpoints: batch.map(([lat, lng]) => ({ lat, lng, valid: true })),
        snapshot,
      })) as typeof body;
    } catch (error) {
      // The service fails a whole batch on a point outside every state with a
      // server error, and times out on a batch too slow for it; both are
      // split. Anything else is a real failure.
      const message = (error as Error).message;
      if (!/answered 50[04]/.test(message)) throw error;
      if (batch.length === 1) {
        if (/answered 504/.test(message)) throw error;
        return;
      }
      const half = Math.ceil(batch.length / 2);
      await ask(batch.slice(0, half));
      await ask(batch.slice(half));
      return;
    }
    for (const place of body.places) for (const r of place.results ?? []) ids.add(Number(r.placeId));
  };
  const batches: Array<Array<[number, number]>> = [];
  for (let i = 0; i < points.length; i += 50) batches.push(points.slice(i, i + 50));
  const workers = Array.from({ length: 4 }, async () => {
    for (let batch = batches.shift(); batch; batch = batches.shift()) await ask(batch);
  });
  await Promise.all(workers);
  return ids;
}

/** One call to the service, tried three times when its gateway times out
 *  under load. */
async function request(host: string, path: string, body: unknown): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${host}/api/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: host, Referer: `${host}/` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    }).catch((error: Error) => error);
    if (!(response instanceof Error) && response.ok) return response.json();
    const status = response instanceof Error ? response.message : response.status;
    // Only a gateway that timed out or dropped the call is worth asking again.
    const transient = response instanceof Error || [502, 503, 504].includes(response.status);
    if (attempt === 3 || !transient) throw new Error(`${host} ${path} answered ${status}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
  }
}
