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
 *
 * An address no geocoder can place still gets a rate when its whole ZIP has
 * one: when the typed ZIP's Census area, widened by zipMarginMetres, lies
 * wholly inside every rated outline it touches (a rural ZIP far from any
 * city or district line).
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  salesTaxDataReleases,
  salesTaxJurisdictionRates,
  salesTaxShapes,
} from "../db/schema.js";
import { RateError } from "../errors.js";
import { sameBreakdown, traceOutline, type Breakdown, type RatePart, type Trace, type TracedOutline } from "./types.js";
import { marginOf, type LocatedPoint, type Locate } from "../geocoding/types.js";
import { outlinesAt, pointsAcross, shapesHolding, type PlacedShape } from "./shapes.js";
import { parseStreet, streetKeysOf } from "../address.js";
import { districtCode } from "../coverage.js";
import { PARAMS } from "../params.js";

export interface GeoRate {
  placedBy?: string[];
  /** The ZIP whose whole area has the rate, when no point placed the
   *  address. */
  wholeZip?: string;
  rate: number;
  parts: RatePart[];
  /** The state's code, then each county, city and district code whose rate
   *  is in it, joined by dashes. */
  locationCode: string;
  files: string[];
  /** Other combinations of jurisdictions the address could be in, each
   *  with the same total: the rate is settled, its parts aren't. */
  alternatives: Breakdown[];
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
  /** The typed ZIP and city, for an address no point places. */
  typed?: { zip?: string | null; city?: string },
): Promise<GeoRate> {
  const locate = typeof pointOrLocate === "function" ? pointOrLocate : undefined;
  const point = locate ? await locate() : pointOrLocate as LocatedPoint | null;
  const files = await releaseFiles(state);
  if (!files.length)
    throw new RateError(`This service hasn't loaded ${state}'s rate data.`, 502);
  const pjState = await hasRows(state, "pj");
  if (!point) {
    const zip5 = /^\d{5}/.exec(typed?.zip ?? "")?.[0];
    const byZip = zip5 && !pjState ? await wholeZipRate(state, zip5, typed?.city ?? "", await ratesOn(state, date), date, street) : null;
    if (byZip) return { ...byZip, files, placedBy: [], wholeZip: zip5, alternatives: [] };
    throw new RateError(
      `${state}'s local rates follow city and county lines, and this address couldn't be placed on the map. Verify the street, city and ZIP.`,
      422,
    );
  }

  // Outlines within ~300 m of the point, or three miles where a police
  // jurisdiction could reach it.
  const outlineMargin = PARAMS.outlineMarginMetres[state] ?? 0;
  const reach = Math.max(marginOf(point) + outlineMargin, PARAMS.breakdownMarginMetres);
  const pad = Math.max(0.003, reach / (110_000 * Math.max(0.1, Math.cos(point.lat * Math.PI / 180))));
  const shapes = await outlinesAt(state, point, date, "all", pjState ? Math.max(0.06, pad) : pad);
  const rates = await ratesOn(state, date);
  const keptCodes = new Set(
    [...rates.values()].filter((r) => r.type === "kx").map((r) => r.code.split(">")[1]),
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
    if (!rates.has(`no:${s.fips}`)) continue;
    if (s.kind === "county" && s.inside)
      throw new RateError(
        `${s.name} County's ${state} rates depend on city limits and police jurisdictions no one publishes outlines for. Confirm the rate with the county.`,
        422,
      );
    // A district whose rate no source confirms: inside it, or close enough
    // that it could be, there is no rate to give.
    if (s.kind === "district" && (s.inside || s.edgeMetres < marginOf(point)))
      throw new RateError(
        `This address is ${s.inside ? "in" : `within ${marginOf(point)} m of`} ${s.name}, which levies its own tax at a rate no published source confirms. Confirm the rate with ${s.name}.`,
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
  if (PARAMS.refuseBeforeFirstRate) {
    const later = await ratedOnlyLater(state, date, shapes.filter((s) => s.inside && !levying.has(s)), answer.parts);
    if (later)
      throw new RateError(
        `This address is in ${later.shape.name.trim() || `${later.shape.kind} ${later.shape.fips}`}, whose tax this service has on record only from ${later.from}, so it can't tell whether it applied on ${date}. Confirm the rate with the state.`,
        422,
      );
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
  // A different combination with the same total settles the rate, not its
  // parts: kept as an alternative, or refused with breakdownMustAgree.
  const margin = marginOf(point) + outlineMargin;
  const alternatives: Breakdown[] = [];
  for (const s of levied) {
    if (s.edgeMetres >= Math.max(margin, PARAMS.breakdownMarginMetres)) continue;
    // Past the margin, only a breakdown is in question, never the rate.
    const breakdownOnly = s.edgeMetres >= margin;
    // Two metres over, so a narrow outline just past the line isn't skipped.
    for (const beyond of pointsAcross(point, s.foot, s.edgeMetres, 2)) {
      const holding = await shapesHolding(state, beyond, date);
      const across = new Set(levied.filter((l) => holding.has(`${l.kind}:${l.fips}`)));
    // Across the line may be no rated area at all, which is a different rate.
    let other: { rate: number; parts: RatePart[]; locationCode: string };
    try {
      other = rateOf(state, across, rates, addressKey);
    } catch (error) {
      if (!(error instanceof RateError)) throw error;
      other = { rate: NaN, parts: [], locationCode: "" };
    }
    const breakdownDiffers = other.rate === answer.rate && !sameBreakdown(other, answer);
    if (!breakdownOnly && (other.rate !== answer.rate || (breakdownDiffers && PARAMS.breakdownMustAgree))) {
      if (locate) {
        const sharper = await locate({ marginUnder: s.edgeMetres });
        // Re-evaluate every outline, rate and deciding edge at the new point.
        if (sharper) return geoRateAt(state, sharper, date, street, trace, typed);
      }
      throw new RateError(
        breakdownDiffers
          ? `This address is within ${margin} m of the ${s.name.trim() || `${s.kind} ${s.fips}`} line: its rate is ${pct(answer.rate)} on either side, but the jurisdictions it is paid to differ. Confirm the address's city or county.`
          : `This address is within ${margin} m of the ${s.name.trim() || `${s.kind} ${s.fips}`} line, too close to tell from the map whether it is ${pct(answer.rate)}${Number.isNaN(other.rate) ? " or another rate" : ` or ${pct(other.rate)}`}. Confirm the rate with the address's city or county.`,
        422,
      );
    }
    if (breakdownDiffers && !alternatives.some((a) => sameBreakdown(a, other)))
      alternatives.push({ locationCode: other.locationCode, parts: other.parts });
    }
  }
  return { ...answer, files, placedBy: point.placedBy, alternatives };
}

/** The state's rate rows on a date, keyed "type:code"; a later start wins
 *  where a table overlaps two spans. */
async function ratesOn(state: string, date: string) {
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
  return new Map(rows.map((r) => [`${r.type}:${r.code}`, r]));
}

/** The rate everywhere in the typed ZIP's Census area widened by
 *  zipMarginMetres (the area is drawn from whole census blocks, by the ZIP
 *  most of a block's addresses use, and simplified), or null unless it has
 *  exactly one: every rated outline it touches must hold all of it, the
 *  state's counties must, and no district whose rate no source confirms may
 *  touch it. Null too where the typed city or street says the ZIP was typed
 *  wrong: a city with an outline the area doesn't reach, or a street the
 *  Census lists in the state only in ZIPs far from this one. (A street it
 *  lists nowhere can't say either way.) */
async function wholeZipRate(
  state: string,
  zip5: string,
  city: string,
  rates: Map<string, RateRow>,
  date: string,
  street?: string,
): Promise<Omit<GeoRate, "files" | "alternatives"> | null> {
  const widened = sql`(select st_buffer(geom::geography, ${PARAMS.zipMarginMetres})::geometry as g from zip_areas where zip5 = ${zip5})`;
  const rows = await db.execute<{ kind: Shape["kind"]; fips: string; name: string; area: number; holds: boolean }>(sql`
    select s.kind, s.fips, s.name, st_area(s.geom) as area, st_covers(s.geom, z.g) as holds
    from sales_tax_shapes s cross join ${widened} z
    where s.state = ${state} and ${date} between s.starts_on and s.ends_on and st_intersects(s.geom, z.g)`);
  if (!rows.length) return null;
  // All of it in the state: its counties together hold it. Which county
  // matters only where one levies, and a levying one must hold all of it.
  const [within] = await db.execute<{ held: boolean | null }>(sql`
    select st_covers(st_union(s.geom), z.g) as held
    from sales_tax_shapes s cross join ${widened} z
    where s.state = ${state} and s.kind = 'county' and ${date} between s.starts_on and s.ends_on and st_intersects(s.geom, z.g)
    group by z.g`);
  if (!within?.held) return null;

  const typedCity = city.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (typedCity) {
    const [named] = await db.execute<{ reaches: boolean | null }>(sql`
      select bool_or(st_intersects(s.geom, z.g)) as reaches
      from sales_tax_shapes s cross join ${widened} z
      where s.state = ${state} and s.kind in ('place', 'cousub') and ${date} between s.starts_on and s.ends_on
        and regexp_replace(upper(s.name), '[^A-Z0-9]', '', 'g') = ${typedCity}`);
    if (named?.reaches === false) return null;
  }
  const parsed = street ? parseStreet(street) : null;
  if (parsed) {
    const keys = [...new Set([...streetKeysOf(parsed), ...(parsed.alternates ?? []).map((a) => a.streetKey)])];
    const [listed] = await db.execute<{ near: boolean | null }>(sql`
      select bool_or(st_intersects(a.geom, z.g)) as near
      from zip_street_names n join zip_areas a on a.zip5 = n.zip5 cross join ${widened} z
      where n.state = ${state} and n.street_key in ${keys}`);
    if (listed?.near === false) return null;
  }

  const shapes: Shape[] = rows.map((r) => ({
    kind: r.kind, fips: r.fips, name: r.name, area: Number(r.area), inside: r.holds,
    edgeMetres: Infinity, foot: { lon: 0, lat: 0 },
  }));
  const keptCodes = new Set([...rates.values()].filter((r) => r.type === "kx").map((r) => r.code.split(">")[1]));
  const levied = shapes.filter((s) => leviesOf(s, rates).length || keptCodes.has(s.fips));
  if (levied.some((s) => !s.inside)) return null;
  if (shapes.some((s) => rates.has(`no:${s.fips}`) || rates.has(`maybe:${s.fips}`))) return null;
  const addressKey = parsed ? `${parsed.house ?? parsed.houseText}|${parsed.streetKey}` : null;
  try {
    return rateOf(state, new Set(levied), rates, addressKey);
  } catch (error) {
    if (error instanceof RateError) return null;
    throw error;
  }
}

/** An outline holding the point that adds nothing on `date`, though its
 *  jurisdiction has a rate starting later that would apply there: inside an
 *  exclusive area, the area's kx row keeping it; elsewhere its own. Only a
 *  rate starting on the day its source first lists rates like it counts
 *  (the release's first_listed: Texas's current quarter, for districts
 *  outside cities), as it may have applied before; any other rate's start
 *  is the publisher's, and before it there was no tax. */
async function ratedOnlyLater(state: string, date: string, holding: Shape[], parts: RatePart[]) {
  if (!holding.length) return null;
  const [release] = await db
    .select({ firstListed: salesTaxDataReleases.firstListed })
    .from(salesTaxDataReleases)
    .where(and(eq(salesTaxDataReleases.state, state), eq(salesTaxDataReleases.kind, "rates")));
  const listed = release?.firstListed;
  if (!listed || listed <= date) return null;
  const exclusive = parts.find((p) => p.code.startsWith("x:"))?.code.slice(2);
  const fips = holding.map((s) => s.fips);
  const rows = await db.execute<{ type: string; code: string; from: string }>(sql`
    select type, code, min(starts_on)::text as from from sales_tax_jurisdiction_rates
    where state = ${state} and starts_on = ${listed}
      and (split_part(code, '@', 1) in ${fips} or split_part(code, '>', 2) in ${fips})
    group by type, code order by 3`);
  const fits = (s: Shape, type: string) =>
    s.kind === "county" ? ["00", "rc"].includes(type)
      : s.kind === "district" ? !NOT_DISTRICT.includes(type)
        : ["01", "01x", "x", "0c"].includes(type);
  for (const r of rows)
    for (const s of holding) {
      const applies = exclusive
        ? r.type === "kx" && r.code === `${exclusive}>${s.fips}`
        : r.type !== "kx" && r.code.split("@")[0] === s.fips && fits(s, r.type);
      if (applies) return { shape: s, from: r.from };
    }
  return null;
}

/** Whether the point is inside a city with its own rate. */
function inRatedCity(inside: Set<Shape>, rates: Map<string, RateRow>) {
  return [...inside].some(
    (s) => (s.kind === "place" || s.kind === "cousub") && leviesOf(s, rates).some((r) => r.type === "01" || r.type === "01x"),
  );
}

/** Rate types that are never a special district's own. */
const NOT_DISTRICT = ["45", "00", "rc", "01", "01x", "0c", "kx", "addr", "need", "no", "pj", "maybe"];

/** The rate rows a shape could carry, by its kind. */
function leviesOf(shape: Shape, rates: Map<string, RateRow>): RateRow[] {
  const types =
    shape.kind === "county"
      ? ["00", "rc"]
      : shape.kind === "district"
        ? [...rates.keys()]
            .filter((k) => k.endsWith(`:${shape.fips}`))
            .map((k) => k.split(":")[0])
            .filter((t) => !NOT_DISTRICT.includes(t))
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
    parts.push({ kind: kindOf(s), name: s.name.trim() || null, code, rate });
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

/** A district of its own (a "no" or resort-tax "rt" row) that `city` is
 *  named for, as its state's seed coded it, and whether it has an outline;
 *  "unloaded" when the state has no data loaded. */
export async function districtNamed(state: string, city: string, date: string): Promise<{ outlined: boolean } | null | "unloaded"> {
  if (!(await releaseFiles(state)).length) return "unloaded";
  const code = districtCode(city);
  const [row] = await db
    .select({ code: salesTaxJurisdictionRates.code })
    .from(salesTaxJurisdictionRates)
    .where(and(eq(salesTaxJurisdictionRates.state, state), inArray(salesTaxJurisdictionRates.type, ["no", "rt"]),
      eq(salesTaxJurisdictionRates.code, code), lte(salesTaxJurisdictionRates.startsOn, date), gte(salesTaxJurisdictionRates.endsOn, date)));
  if (!row) return null;
  const [outline] = await db
    .select({ fips: salesTaxShapes.fips })
    .from(salesTaxShapes)
    .where(and(eq(salesTaxShapes.state, state), eq(salesTaxShapes.kind, "district"), eq(salesTaxShapes.fips, code)))
    .limit(1);
  return { outlined: Boolean(outline) };
}

async function releaseFiles(state: string) {
  const rows = await db
    .select({ file: salesTaxDataReleases.file })
    .from(salesTaxDataReleases)
    .where(eq(salesTaxDataReleases.state, state));
  return rows.map((r) => r.file);
}

