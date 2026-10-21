/**
 * Finds the rate at an address in a state whose local taxes follow county,
 * city and district lines rather than published address ranges: the address
 * is placed on the map, and each outline it falls in adds its rate.
 *
 * A state's rates are rows keyed by type and code (see LEVY_TYPES):
 *   - 45: the state's own rate, everywhere;
 *   - 00: a county's, across the county, unless the address's city has a
 *     rate that stands in for it (01x);
 *   - 01: a city's or town's, added inside it;
 *   - 01x: a city's that replaces its county's (New York's own-rate cities);
 *     coded "city@county" for a city whose rate differs in one of the
 *     counties it spans (a Louisiana town in two parishes), which wins there;
 *   - 0c: the part of a county's rate that differs inside one city (an
 *     Alabama county that taxes more or less within a named city's limits),
 *     added inside that city, and may be below zero;
 *   - rc: a county's that applies only outside every city with a rate (New
 *     Mexico's "remainder of county");
 *   - x: an exclusive area's (a Texas city or combined area): inside it, it
 *     stands in for every other local rate except those its kx rows keep, at
 *     the rate each kx row gives, which may be lower than that jurisdiction's
 *     own outside the area (a kx row's code is "area>kept code");
 *   - no: a county whose rates depend on lines no one publishes outlines for
 *     (Alabama's counties split by city limits and police jurisdictions);
 *     an address in it is refused;
 *   - pj: a city's police jurisdiction rate, levied up to three miles
 *     outside its limits with no published outline; an address outside the
 *     city but that close to it is refused;
 *   - maybe: a district inside a city with no outline of its own and a
 *     different rate (a Louisiana economic development district); an
 *     address in the city is refused with both rates;
 *   - need: a marker that every address in the state lies in an exclusive
 *     area (Illinois, New Mexico), so one outside them all is refused
 *     rather than given the state's rate alone;
 *   - addr: one street address's rate in place of its exclusive area's (an
 *     Illinois business district, published as an address list), coded
 *     "area|house number|street key";
 *   - any other type: a special district's, inside its own outline.
 * Cities match Census places or county subdivisions by FIPS, counties by
 * county FIPS, districts by the code their outline was loaded under.
 *
 * An address too close to an outline's edge for its geocode's accuracy is
 * refused, unless moving it across that edge would not change the rate.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  salesTaxDataReleases,
  salesTaxJurisdictionRates,
} from "../db/schema.js";
import { RateError } from "../errors.js";
import { traceOutline, type RatePart, type Trace, type TracedOutline } from "./types.js";
import { marginOf, type LocatedPoint, type Locate } from "../geocoding/types.js";
import { pointsAcross, shapesAround, shapesHolding, type PlacedShape } from "./shapes.js";
import { parseStreet } from "../address.js";

export interface GeoRate {
  placedBy?: string[];
  rate: number;
  parts: RatePart[];
  /** The state's code, then each county, city and district code whose rate
   *  is in it, joined by dashes. */
  locationCode: string;
  files: string[];
}

/** How far a police jurisdiction can reach past its city's limits. */
const PJ_METRES = 4_828;

type Shape = PlacedShape;
type RateRow = typeof salesTaxJurisdictionRates.$inferSelect;

export async function geoRateAt(
  state: string,
  pointOrLocate: LocatedPoint | Locate | null,
  date: string,
  street?: string,
  trace?: Trace,
): Promise<GeoRate> {
  const locate = typeof pointOrLocate === "function" ? pointOrLocate : undefined;
  const point = locate ? await locate() : pointOrLocate as LocatedPoint | null;
  const files = await releaseFiles(state);
  if (!files.length)
    throw new RateError(`This service hasn't loaded ${state}'s rate data.`, 502);
  if (!point)
    throw new RateError(
      `${state}'s local rates follow city and county lines, and this address couldn't be placed on the map. Verify the street, city and ZIP.`,
      422,
    );

  // Outlines within ~300 m of the point, or three miles where a police
  // jurisdiction could reach it.
  const pjState = await hasRows(state, "pj");
  const pad = Math.max(0.003, marginOf(point) / (110_000 * Math.max(0.1, Math.cos(point.lat * Math.PI / 180))));
  const shapes = await shapesAround(state, point, pjState ? Math.max(0.06, pad) : pad);
  const rows = await db
    .select()
    .from(salesTaxJurisdictionRates)
    .where(
      and(
        eq(salesTaxJurisdictionRates.state, state),
        lte(salesTaxJurisdictionRates.startsOn, date),
        gte(salesTaxJurisdictionRates.endsOn, date),
      ),
    )
    .orderBy(salesTaxJurisdictionRates.startsOn);
  // A later start wins where a table overlaps two spans.
  const rates = new Map(rows.map((r) => [`${r.type}:${r.code}`, r]));
  const keptCodes = new Set(
    rows.filter((r) => r.type === "kx").map((r) => r.code.split(">")[1]),
  );
  const levied = shapes.filter(
    (s) => leviesOf(s, rates).length || keptCodes.has(s.fips),
  );
  // Recorded before any refusal, so a refused address still shows its lines.
  const traced = new Map<Shape, TracedOutline>();
  if (trace) for (const s of shapes) traced.set(s, traceOutline(trace, s));

  if (!shapes.some((s) => s.kind === "county" && s.inside))
    throw new RateError(
      `This address's map point isn't inside any ${state} county this service has an outline for. Verify the address.`,
      422,
    );
  const inside = new Set(levied.filter((s) => s.inside));
  for (const s of shapes) {
    if (s.kind !== "county" || !rates.has(`no:${s.fips}`) || !s.inside) continue;
    throw new RateError(
      `${s.name} County's ${state} rates depend on city limits and police jurisdictions no one publishes outlines for. Confirm the rate with the county.`,
      422,
    );
  }
  // A police jurisdiction reaches only unincorporated land, never into
  // another city.
  if (pjState && !inRatedCity(inside, rates))
    for (const s of shapes) {
      const pj = rates.get(`pj:${s.fips}`) ?? [...rates.entries()].find(([k]) => k.startsWith(`pj:${s.fips}@`))?.[1];
      if (!pj || s.kind === "county" || s.inside) continue;
      if (s.edgeMetres < PJ_METRES)
        throw new RateError(
          `This address is outside ${s.name} but within three miles of it, where its police jurisdiction may add ${+(Number(pj.rate) * 100).toFixed(4)}%. Confirm the rate with the city.`,
          422,
        );
    }
  const parsed = street ? parseStreet(street) : null;
  const addressKey = parsed ? `${parsed.house ?? parsed.houseText}|${parsed.streetKey}` : null;
  const levying = new Set<Shape>();
  const answer = rateOf(state, inside, rates, addressKey, levying);
  for (const s of levying) {
    const outline = traced.get(s);
    if (outline) outline.levies = true;
  }
  for (const s of inside) {
    const maybe = rates.get(`maybe:${s.fips}`);
    // A county's unmapped district matters only outside its rated cities.
    if (maybe && (s.kind !== "county" || !inRatedCity(inside, rates)))
      throw new RateError(
        `${s.name} is ${pct(answer.rate)}, or ${pct(answer.rate - Number(rates.get(`01x:${s.fips}`)?.rate ?? rates.get(`rc:${s.fips}`)?.rate ?? 0) + Number(maybe.rate))} in one of its districts, which have no published outlines. Confirm which applies.`,
        422,
      );
  }

  // Near an edge, the address could be on either side; that only matters if
  // the other side's rate differs. The other side is read at a point just
  // past the edge, so every outline that changes there is counted.
  const margin = marginOf(point);
  for (const s of levied) {
    if (s.edgeMetres >= margin) continue;
    // Two metres over, so a narrow outline just past the line isn't skipped.
    for (const beyond of pointsAcross(point, s.foot, s.edgeMetres, 2)) {
      const holding = await shapesHolding(state, beyond);
      const across = new Set(levied.filter((l) => holding.has(`${l.kind}:${l.fips}`)));
    // Across the line may be no rated area at all, which is a different rate.
    let other: { rate: number };
    try {
      other = rateOf(state, across, rates, addressKey);
    } catch (error) {
      if (!(error instanceof RateError)) throw error;
      other = { rate: NaN };
    }
    if (other.rate !== answer.rate) {
      if (locate) {
        const sharper = await locate({ marginUnder: s.edgeMetres });
        // Re-evaluate every outline, rate and deciding edge at the new point.
        if (sharper) return geoRateAt(state, sharper, date, street, trace);
      }
      throw new RateError(
        `This address is within ${margin} m of the ${s.name} line, too close to tell from the map whether it is ${pct(answer.rate)}${Number.isNaN(other.rate) ? " or another rate" : ` or ${pct(other.rate)}`}. Confirm the rate with the address's city or county.`,
        422,
      );
    }
    }
  }
  return { ...answer, files, placedBy: point.placedBy };
}

/** Whether the point is inside a city with its own rate. */
function inRatedCity(inside: Set<Shape>, rates: Map<string, RateRow>) {
  return [...inside].some(
    (s) => (s.kind === "place" || s.kind === "cousub") && leviesOf(s, rates).some((r) => r.type === "01" || r.type === "01x"),
  );
}

/** The rate rows a shape could carry, by its kind. */
function leviesOf(shape: Shape, rates: Map<string, RateRow>): RateRow[] {
  const types =
    shape.kind === "county"
      ? ["00", "rc"]
      : shape.kind === "district"
        ? [...rates.keys()]
            .filter((k) => k.endsWith(`:${shape.fips}`))
            .map((k) => k.split(":")[0])
            .filter((t) => !["45", "00", "rc", "01", "01x", "0c", "kx", "addr", "need", "no", "pj", "maybe"].includes(t))
        : ["01", "01x", "x", "0c"];
  return types.flatMap((t) => {
    const own = rates.get(`${t}:${shape.fips}`);
    if (own) return [own];
    // A city whose rate is set for only some of the counties it spans.
    const prefix = `${t}:${shape.fips}@`;
    const inCounty = [...rates.entries()].find(([k]) => k.startsWith(prefix));
    return inCounty ? [inCounty[1]] : [];
  });
}

/** A row for one of the counties the point is in, where the city has one,
 *  else its own. */
function forCounty(rates: Map<string, RateRow>, row: RateRow, fips: string, counties: string[]) {
  for (const c of counties) {
    const own = rates.get(`${row.type}:${fips}@${c}`);
    if (own) return own;
  }
  return rates.get(`${row.type}:${fips}`) ?? null;
}

function rateOf(
  state: string,
  inside: Set<Shape>,
  rates: Map<string, RateRow>,
  addressKey: string | null,
  /** Collects the shapes whose rows were added. */
  levying?: Set<Shape>,
) {
  const stateRow = [...rates.values()].find((r) => r.type === "45");
  if (!stateRow)
    throw new RateError(
      `This service's ${state} rate table doesn't cover this date. Enter the rate the sale charged.`,
      422,
    );
  const parts: RatePart[] = [
    { kind: "state", code: `45:${stateRow.code}`, rate: Number(stateRow.rate) },
  ];
  const kindOf = (s: Shape): RatePart["kind"] =>
    s.kind === "county" ? "county" : s.kind === "district" ? "district" : "city";
  const add = (s: Shape, row: RateRow, rate = Number(row.rate)) => {
    // A city counts once, whether matched as a place or as a town.
    const code = `${row.type}:${row.code}`;
    if (parts.some((p) => p.code === code)) return;
    parts.push({ kind: kindOf(s), code, rate });
    levying?.add(s);
  };
  const sorted = [...inside].sort(byKind);

  // Inside an exclusive area, only it and what it keeps apply, at its rates.
  // One drawn inside another (a combined area within its city) stands in
  // for the outer one.
  const area = (s: Shape) => s.area;
  const exclusive = sorted
    .flatMap((s) =>
      leviesOf(s, rates)
        .filter((r) => r.type === "x")
        .map((row) => ({ shape: s, row })),
    )
    .sort((a, b) => area(a.shape) - area(b.shape))
    .slice(0, 1);
  if (!exclusive.length && rates.has("need:x"))
    throw new RateError(
      `This address isn't inside any of ${state}'s published tax locations on this date. Confirm the rate with the state.`,
      422,
    );
  if (exclusive.length) {
    for (const { shape, row } of exclusive) {
      const own = addressKey ? rates.get(`addr:${row.code}|${addressKey}`) : undefined;
      add(shape, row, own ? Number(own.rate) : undefined);
    }
    for (const s of sorted)
      for (const { row: x } of exclusive) {
        const kept = rates.get(`kx:${x.code}>${s.fips}`);
        if (kept) add(s, kept);
      }
    return total(parts, stateRow);
  }

  const cityRows = sorted
    .filter((s) => s.kind === "place" || s.kind === "cousub")
    .flatMap((s) => leviesOf(s, rates))
    .filter((r) => r.type !== "0c");
  const replacesCounty = cityRows.some((r) => r.type === "01x");
  const inRatedCity = cityRows.length > 0;
  const counties = sorted.filter((s) => s.kind === "county").map((s) => s.fips);
  for (const s of sorted)
    for (const row of leviesOf(s, rates)) {
      if (s.kind === "place" || s.kind === "cousub") {
        const own = forCounty(rates, row, s.fips, counties);
        if (!own) continue;
        if (own !== row) {
          add(s, own);
          continue;
        }
      }
      if (row.type === "00" && replacesCounty) continue;
      if (row.type === "rc" && inRatedCity) continue;
      add(s, row);
    }
  return total(parts, stateRow);
}

function total(parts: RatePart[], stateRow: RateRow) {
  return {
    rate: Math.round(parts.reduce((sum, p) => sum + p.rate, 0) * 1e6) / 1e6,
    parts,
    locationCode: [
      stateRow.code,
      ...new Set(parts.slice(1).map((p) => p.code.split(":")[1].split("@")[0])),
    ].join("-"),
  };
}

const ORDER = { county: 0, place: 1, cousub: 2, district: 3 };
const byKind = (a: Shape, b: Shape) =>
  ORDER[a.kind as keyof typeof ORDER] - ORDER[b.kind as keyof typeof ORDER] ||
  a.fips.localeCompare(b.fips);

const pct = (rate: number) => `${+(rate * 100).toFixed(4)}%`;

async function hasRows(state: string, type: string) {
  const [row] = await db
    .select({ code: salesTaxJurisdictionRates.code })
    .from(salesTaxJurisdictionRates)
    .where(and(eq(salesTaxJurisdictionRates.state, state), eq(salesTaxJurisdictionRates.type, type)))
    .limit(1);
  return Boolean(row);
}

async function releaseFiles(state: string) {
  const rows = await db
    .select({ file: salesTaxDataReleases.file })
    .from(salesTaxDataReleases)
    .where(eq(salesTaxDataReleases.state, state));
  return rows.map((r) => r.file);
}

