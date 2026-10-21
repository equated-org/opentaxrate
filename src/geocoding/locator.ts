import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { agreeingGroup, compatible, placement } from "./agreement.js";
import { addressCacheKey, postgresGeocodeCache, type GeocodeCache } from "./cache.js";
import { postgresGeocodeBudget, type GeocodeBudget } from "./budget.js";
import { geocoderProviders } from "./registry.js";
import { roundCoord, type Trace } from "../rates/types.js";
import { EDGE_METRES, marginOf, metresBetween, validPoint,
  type AddressToLocate, type SourcedPoint, type LocatedPoint, type GeocoderProvider, type Locate } from "./types.js";

/** The typed city is a plausibility check, never a precision upgrade. No
 * county-of-ZIP shortcut: a ZIP can span counties and county checks are weak. */
export async function insideTypedCity(a: AddressToLocate, p: LocatedPoint) {
  if (!a.city.trim()) return false;
  const rows = await db.execute(sql`
    select 1 from sales_tax_shapes where state = ${a.state}
      and kind in ('place', 'cousub')
      and regexp_replace(upper(name), '[^A-Z0-9]', '', 'g') = ${a.city.toUpperCase().replace(/[^A-Z0-9]/g, "")}
      and st_covers(geom, st_setsrid(st_point(${p.lon}, ${p.lat}), 4326)) limit 1`);
  return rows.length > 0;
}
interface Options {
  providers?: GeocoderProvider[];
  cache?: GeocodeCache;
  budget?: GeocodeBudget;
  checkSingle?: (address: AddressToLocate, point: LocatedPoint) => Promise<boolean>;
  /** Records every provider's point and the point placed, for display. */
  trace?: Trace;
}
export interface GeocodeTrace { provider: string; outcome: "cached" | "matched" | "no-match" | "skipped" | "failed" }
// Coalesce duplicate requests in this process, without retaining non-storable results.
const inFlight = new Map<string, Promise<SourcedPoint | null | undefined>>();

export function createLocator(address: AddressToLocate, options: Options = {}): Locate & { trace: GeocodeTrace[] } {
  const providers = options.providers ?? geocoderProviders();
  const cache = options.cache ?? postgresGeocodeCache;
  const budget = options.budget ?? postgresGeocodeBudget;
  const checkSingle = options.checkSingle ?? insideTypedCity;
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
        const point = await p.geocode(address, AbortSignal.timeout(6_000));
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
    // Same-source duplicates are not corroboration, and conflicting points
    // must not be reduced to an arbitrary single just because no pair won.
    if (!remaining.length || new Set(remaining.map(p => p.source)).size > 1
      || remaining.some(a => remaining.some(b => !compatible(a, b)))) return null;
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
