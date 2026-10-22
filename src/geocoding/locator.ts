import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { agreeingGroup, compatible, placement } from "./agreement.js";
import { addressCacheKey, postgresGeocodeCache, type GeocodeCache } from "./cache.js";
import { postgresGeocodeBudget, type GeocodeBudget } from "./budget.js";
import { geocoderProviders } from "./registry.js";
import { streetsInZip } from "./zip-streets.js";
import { roundCoord, type Trace } from "../rates/types.js";
import { EDGE_METRES, marginOf, metresBetween, validPoint,
  type AddressToLocate, type SourcedPoint, type LocatedPoint, type GeocoderProvider, type Locate } from "./types.js";
import { PARAMS } from "../params.js";

/** The typed city is a plausibility check, never a precision upgrade. No
 * county-of-ZIP shortcut: a ZIP can span counties and county checks are weak. */
export async function insideTypedCity(a: AddressToLocate, p: LocatedPoint): Promise<"inside" | "outside" | "no outline"> {
  if (!a.city.trim()) return "no outline";
  const rows = await db.execute<{ inside: boolean }>(sql`
    select st_covers(geom, st_setsrid(st_point(${p.lon}, ${p.lat}), 4326)) as inside
    from sales_tax_shapes where state = ${a.state}
      and kind in ('place', 'cousub')
      and regexp_replace(upper(name), '[^A-Z0-9]', '', 'g') = ${a.city.toUpperCase().replace(/[^A-Z0-9]/g, "")}`);
  if (!rows.length) return "no outline";
  return rows.some((r) => r.inside) ? "inside" : "outside";
}
/** Whether the point lies in the typed ZIP's area (its Census ZCTA), or in
 * a Census place or county subdivision of the typed city's name, asked of
 * the Census Bureau's free coordinates lookup. For an address in a place
 * with no outline loaded (an unincorporated community, or a Pennsylvania
 * township the rates don't need), these are the plausibility check the
 * typed city's outline can't be. */
export async function insideTypedArea(a: AddressToLocate, p: LocatedPoint) {
  const zip = /^\d{5}/.exec(a.zip ?? "")?.[0];
  const city = townName(a.city);
  if (!zip && !city) return false;
  const url = new URL("https://geocoding.geo.census.gov/geocoder/geographies/coordinates");
  url.search = new URLSearchParams({ x: String(p.lon), y: String(p.lat), benchmark: "Public_AR_Current",
    vintage: "Current_Current", layers: "all", format: "json" }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(6_000) });
  if (!response.ok) return false;
  const body = await response.json() as { result?: { geographies?: Record<string, Array<{ ZCTA5?: string; GEOID?: string; NAME?: string }>> } };
  return Object.entries(body.result?.geographies ?? {}).some(([layer, geos]) =>
    (/zip code tabulation/i.test(layer) && geos.some(g => (g.ZCTA5 ?? g.GEOID) === zip))
    || (/places|county subdivisions/i.test(layer) && !!city && geos.some(g => townName(g.NAME ?? "") === city)));
}
/** A town's name without the Census's kind of place: "Hatfield township"
 *  and "Hatfield borough" are both "HATFIELD". */
const townName = (name: string) =>
  name.toUpperCase().replace(/\b(CITY|TOWN|TOWNSHIP|BOROUGH|VILLAGE|CDP|PLANTATION|MUNICIPALITY)\b/g, "").replace(/[^A-Z0-9]/g, "");
/** A lone dataset's point is plausible inside the typed city's outline; or,
 * where the typed city has no outline loaded, inside the typed ZIP's area or
 * a Census place or township of the typed name. Outside an outline the city
 * does have is not, unless lonePointOutsideCity lets the typed ZIP's area
 * vouch for it. */
async function plausible(a: AddressToLocate, p: LocatedPoint) {
  const city = await insideTypedCity(a, p);
  if (city === "outside" && PARAMS.lonePointOutsideCity) return insideTypedArea({ ...a, city: "" }, p);
  return city === "inside" || (city === "no outline" && await insideTypedArea(a, p));
}
interface Options {
  providers?: GeocoderProvider[];
  cache?: GeocodeCache;
  budget?: GeocodeBudget;
  checkSingle?: (address: AddressToLocate, point: LocatedPoint) => Promise<boolean>;
  /** Records every provider's point and the point placed, for display. */
  trace?: Trace;
  /** The streets in the typed ZIP, for telling a typo from another street. */
  zipStreets?: (address: AddressToLocate) => Promise<ReadonlySet<string> | null>;
}
export interface GeocodeTrace { provider: string; outcome: "cached" | "matched" | "no-match" | "skipped" | "failed" }
/** The widest circle disagreeing datasets may be placed within. */
const WIDE_METRES = PARAMS.wideMetres;
// Coalesce duplicate requests in this process, without retaining non-storable results.
const inFlight = new Map<string, Promise<SourcedPoint | null | undefined>>();

export function createLocator(address: AddressToLocate, options: Options = {}): Locate & { trace: GeocodeTrace[] } {
  const providers = options.providers ?? geocoderProviders();
  const cache = options.cache ?? postgresGeocodeCache;
  const budget = options.budget ?? postgresGeocodeBudget;
  const checkSingle = options.checkSingle ?? plausible;
  const cacheEnabled = process.env.OPENTAXRATE_GEOCODE_CACHE !== "off";
  const readOnly = process.env.OPENTAXRATE_GEOCODE_READ_ONLY === "true";
  const key = addressCacheKey(address);
  const trace: GeocodeTrace[] = [];
  const memo = new Map<string, SourcedPoint | null | undefined>();
  const shown = options.trace;
  const remember = (id: string, point: SourcedPoint | null | undefined) => {
    memo.set(id, point);
    if (point && shown)
      shown.geocoders.push({ source: id, lon: roundCoord(point.lon), lat: roundCoord(point.lat), accuracy: point.accuracy });
  };
  // Loaded once, when a provider is first asked; without them the matcher
  // stays exact.
  let located: Promise<AddressToLocate> | undefined;
  const withStreets = () => (located ??= (options.zipStreets ?? streetsInZip)(address)
    .then((zipStreets) => ({ ...address, zipStreets }), () => address));
  const considered = new Set<string>();
  let base: Promise<LocatedPoint | null> | undefined;
  let refined: Promise<LocatedPoint | null> | undefined;
  let accepted: SourcedPoint[] = [];

  async function cached(p: GeocoderProvider) {
    if (!cacheEnabled || !p.storable) return;
    try {
      const result = await cache.get(key, p.cacheId);
      if (result !== undefined && (result === null || (validPoint(result) && result.provider === p.id
        && typeof result.source === "string" && result.source.length > 0))) {
        remember(p.id, result);
        trace.push({ provider: p.id, outcome: "cached" });
      }
    } catch { /* Cache outages still require a budget reservation before calls. */ }
  }
  async function ask(p: GeocoderProvider): Promise<SourcedPoint | null | undefined> {
    considered.add(p.id);
    if (memo.has(p.id)) return memo.get(p.id);
    const flightKey = `${p.cacheId}:${key}`;
    const run = async () => {
      if (readOnly || !await budget.reserve(p)) {
        trace.push({ provider: p.id, outcome: "skipped" });
        return undefined;
      }
      try {
        const point = await p.geocode(await withStreets(), AbortSignal.timeout(6_000));
        if (point && (!validPoint(point) || point.provider !== p.id || !point.source)) throw new Error("Invalid geocoder point");
        budget.success(p);
        trace.push({ provider: p.id, outcome: point ? "matched" : "no-match" });
        if (p.storable && cacheEnabled) {
          try { await cache.put(key, p.cacheId, point); } catch { /* Do not lose a valid placement. */ }
        }
        return point;
      } catch (error) {
        budget.failure(p, error);
        trace.push({ provider: p.id, outcome: "failed" });
        return undefined;
      }
    };
    let pending = inFlight.get(flightKey);
    if (!pending) {
      pending = run().finally(() => { inFlight.delete(flightKey); });
      inFlight.set(flightKey, pending);
    }
    const point = await pending;
    remember(p.id, point);
    return point;
  }
  const points = () => [...memo.entries()].filter(([id]) => considered.has(id))
    .map(([, point]) => point).filter((p): p is SourcedPoint => !!p);
  const agreed = () => {
    const group = agreeingGroup(points());
    if (!group) return null;
    accepted = group;
    return placement(group);
  };

  async function initial() {
    // Replay cached providers in cost order. A cached third-source rooftop
    // remains a refinement, rather than changing the initial group's margin
    // just because all three responses are now available at once.
    await Promise.all(providers.map(cached));
    let result: LocatedPoint | null = null;
    for (const p of providers) {
      if (!memo.has(p.id)) continue;
      considered.add(p.id);
      result = agreed();
      if (result) return result;
    }
    const unused = providers.filter(p => !memo.has(p.id));
    // Prefer the cheapest provider from a different potential dataset.
    // With an existing cached vote, ask one provider at a time: starting
    // another pair here could buy a paid result before a free one agrees.
    const first = points().length ? undefined : unused.shift();
    if (first) {
      const index = unused.findIndex(p => p.sources.some(s => !first.sources.includes(s)));
      const second = index >= 0 ? unused.splice(index, 1)[0] : undefined;
      await Promise.all([first, second].filter((p): p is GeocoderProvider => !!p).map(ask));
      result = agreed();
      if (result) return result;
    }
    for (const p of unused) {
      await ask(p);
      result = agreed();
      if (result) return result;
    }
    const remaining = points();
    if (!remaining.length) return null;
    // Datasets that disagree still bound where the address is: the most
    // precise point, with a margin reaching every other dataset's point. The
    // engine answers only if no rate line crosses that circle, so a rural
    // address the datasets place a few hundred metres apart still gets the
    // one rate they all fall in.
    if (new Set(remaining.map(p => p.source)).size > 1) {
      // The circle reaches each dataset's point and that point's own margin,
      // and these points are the evidence: a refinement must agree with all.
      const wide = placement(remaining);
      const metres = Math.ceil(Math.max(...remaining.map(p => metresBetween(wide, p) + marginOf(p))));
      if (metres > WIDE_METRES) return null;
      accepted = remaining;
      return { ...wide, metres };
    }
    // One dataset: it must agree with itself, and pass the plausibility check.
    if (remaining.some(a => remaining.some(b => !compatible(a, b)))) return null;
    const single = placement(remaining);
    try {
      if (await checkSingle(address, single)) { accepted = remaining; return single; }
    } catch { /* No city outline/check available: refuse. */ }
    return null;
  }

  async function sharpen() {
    const prior = await (base ??= initial());
    if (!prior) return null;
    // The old boundary distance is a hint, not an eligibility threshold:
    // a corrected point can move away from (or across) the boundary.
    for (const p of providers) {
      if (EDGE_METRES[p.typicalAccuracy] >= marginOf(prior)) continue;
      const alreadyKnown = memo.has(p.id);
      const point = await ask(p);
      if (!point || marginOf(point) >= marginOf(prior)) continue;
      // Reusing the same accepted evidence cannot erase a margin that its
      // disagreement just widened. Cached third-source refinements remain usable.
      if (alreadyKnown && accepted.some(member => member.source === point.source)) continue;
      if (metresBetween(point, prior) > marginOf(prior)
        || accepted.some(member => !compatible(point, member))) continue;
      return { ...point, placedBy: [...new Set([...(prior.placedBy ?? []), `${point.provider} (${point.source})`])] };
    }
    return prior;
  }
  const placed = async (pending: Promise<LocatedPoint | null>) => {
    const point = await pending;
    if (point && shown)
      shown.point = { lon: roundCoord(point.lon), lat: roundCoord(point.lat), accuracy: point.accuracy,
        source: (point.placedBy ?? []).join(", "), marginMetres: marginOf(point), spreadMetres: point.metres ?? 0 };
    return point;
  };
  const locate: Locate = need => placed(need ? (refined ??= sharpen()) : (base ??= initial()));
  return Object.assign(locate, { trace });
}
