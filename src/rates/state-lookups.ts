/**
 * The states' own live rate lookups, asked at the address's map point in
 * place of the loaded data (Missouri only after local lookup fails), for
 * the states named in STATE_LOOKUPS ("MO,CO", or "all"). Off by default:
 * each fallback/request is a live call to a service
 * the state runs (several on Avalara's platform), with no published terms
 * for automated use.
 *   - Missouri: the DOR's Sales and Use Tax Lookup (missouri.atr.avalara.com);
 *   - Colorado and Alaska: the lookups the loaded data is read from at sync
 *     (ingest/states/ttr.ts), asked live;
 *   - Texas: the Comptroller's GIS rate API (latlongrate), keyed by
 *     TX_CPA_CLIENT_ID and TX_CPA_CLIENT_SECRET; without them, never asked.
 *     Only the current quarter's rates: a past date isn't asked.
 * An answer counts only when the point, and each edge of its margin, give
 * one rate; otherwise the loaded data answers as usual.
 */
import { marginOf, type LocatedPoint } from "../geocoding/types.js";

interface StateLookup {
  /** Who runs the lookup, for the answer's source. */
  name: string;
  /** The combined general rate at a point on a date, or null when the
   *  service gives none or fails. */
  atPoint(lon: number, lat: number, date: string): Promise<number | null>;
}

const TIMEOUT_MS = 10_000;

async function json(url: string, init: RequestInit = {}): Promise<unknown> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

const missouri: StateLookup = {
  name: "Missouri DOR's Sales and Use Tax Lookup (run by Avalara for the DOR)",
  async atPoint(lon, lat, date) {
    const host = "https://missouri.atr.avalara.com";
    const body = (await json(`${host}/api/ssut-taxes/taxes/calculations?latlng=${lat},${lon}&effectiveOn=${date}`, {
      headers: { Accept: "application/json", Referer: `${host}/` },
    })) as { data?: Array<{ taxCode?: { name?: string }; salesTax?: { total?: number } }> } | null;
    const totals = new Set(
      (body?.data ?? []).flatMap((d) =>
        d.taxCode?.name === "Sales Tax" && typeof d.salesTax?.total === "number" ? [round(d.salesTax.total)] : [],
      ),
    );
    return totals.size === 1 ? [...totals][0] : null;
  },
};

/** A state's lookup on the rate service Colorado's and Alaska's share: the
 *  places holding the point, then each one's rates in force on the date. */
function ttr(name: string, stateName: string, host: string): StateLookup {
  const post = (path: string, body: object) =>
    json(`${host}/api/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: host, Referer: `${host}/` },
      body: JSON.stringify(body),
    });
  return {
    name,
    async atPoint(lon, lat, date) {
      const pinned = (await post("places.pinpoints", { pinpoints: [{ lat, lng: lon, valid: true }], snapshot: date })) as {
        places?: Array<{ results?: Array<{ placeId: number; name: string; type: string }> }>;
      } | null;
      const places = pinned?.places?.[0]?.results ?? [];
      // A point across the state line, or in none, isn't this state's answer.
      if (places.filter((p) => p.type === "State").map((p) => p.name).join() !== stateName) return null;
      const rated = (await post("rates.byPlace", {
        placeIds: places.map((p) => p.placeId),
        date,
        taxTypeFilter: 2,
        taxTypeIds: [1],
      })) as { places?: Record<string, { rates?: Array<{ name: string; value: number; effDate: string; endDate?: string | null }> }> } | null;
      if (!rated?.places) return null;
      const parts = new Set<string>();
      for (const place of Object.values(rated.places))
        for (const r of place.rates ?? [])
          if (r.effDate.slice(0, 10) <= date && (!r.endDate || r.endDate.slice(0, 10) >= date)) parts.add(`${r.name}\t${r.value}`);
      return round([...parts].reduce((sum, p) => sum + Number(p.split("\t")[1]), 0));
    },
  };
}

const texas: StateLookup = {
  name: "Texas Comptroller's GIS sales tax rate API",
  async atPoint(lon, lat, date) {
    const id = process.env.TX_CPA_CLIENT_ID;
    const secret = process.env.TX_CPA_CLIENT_SECRET;
    if (!id || !secret) return null;
    // The API answers by quarter; only today's is asked.
    const today = new Date().toISOString().slice(0, 10);
    const quarter = (day: string) => `${day.slice(0, 4)}Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
    if (quarter(date) !== quarter(today)) return null;
    const url = new URL("https://mulesoft.cpa.texas.gov:8088/api/cpa/gis/v1/salestaxrate/latlongrate");
    url.search = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      quarter: quarter(date).slice(5),
      year: date.slice(0, 4),
    }).toString();
    const body = (await json(url.toString(), { headers: { client_id: id, client_secret: secret } })) as { TOTALTAXRATE?: string | number } | null;
    // Seven implied decimals ("0825000" is 8.25%); none for an over-cap
    // combination or a point it can't place. Any other form isn't guessed at.
    const total = String(body?.TOTALTAXRATE ?? "").trim();
    if (!/^\d+$/.test(total)) {
      if (total) console.warn(`TX lookup: unexpected TOTALTAXRATE ${JSON.stringify(total)}`);
      return null;
    }
    return round(Number(total) / 1e7);
  },
};

const LOOKUPS: Record<string, StateLookup> = {
  MO: missouri,
  TX: texas,
  CO: ttr("Colorado DOR's Sales Tax Lookup (run by Avalara for the DOR)", "Colorado", "https://salestaxlookup.colorado.gov"),
  AK: ttr("Alaska Remote Seller Sales Tax Commission's lookup (run by Avalara)", "Alaska", "https://alaska.atr.avalara.com"),
};

/** The state's own lookup, when STATE_LOOKUPS names the state (or is "all"). */
export function stateLookup(state: string): StateLookup | null {
  const named = (process.env.STATE_LOOKUPS ?? "").toUpperCase().split(/[\s,]+/).filter(Boolean);
  return named.includes("ALL") || named.includes(state) ? (LOOKUPS[state] ?? null) : null;
}

/** The point and, where it is less sure than `buffer` metres, the four edges
 *  of its margin beyond that: a lookup that answers alike at every one
 *  answers for wherever in the margin the address really is. */
export function marginProbes(point: LocatedPoint, buffer = 0): Array<{ lon: number; lat: number }> {
  const reach = marginOf(point) - buffer;
  if (reach <= 0) return [point];
  const dLat = reach / 111_000;
  const dLon = dLat / Math.cos((point.lat * Math.PI) / 180);
  return [point, ...[[dLat, 0], [-dLat, 0], [0, dLon], [0, -dLon]].map(([y, x]) => ({ lon: point.lon + x, lat: point.lat + y }))];
}

/** The state's lookup's rate across the point's margin, or null when it
 *  gives none or more than one. */
export async function stateLookupAt(lookup: StateLookup, point: LocatedPoint, date: string): Promise<number | null> {
  const rates = await Promise.all(marginProbes(point).map((p) => lookup.atPoint(p.lon, p.lat, date)));
  return rates.every((r) => r !== null && r === rates[0]) ? rates[0] : null;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
