/**
 * Finds the rate at an address in a Streamlined member state from the
 * state's own files, as loaded by ingest/load.ts. Tries the most precise match the
 * address allows, and only answers where the state's data has one rate there:
 *
 *   1. Street: a house-number range on the address's street, narrowed by ZIP
 *      or city, then by street type, directions and unit. When a ZIP+4 is
 *      known its ranges must agree; if they disagree the address is refused.
 *      Without one, in a ZIP of more than one rate, the map (step 4) must not
 *      put the address at another rate either.
 *   2. ZIP+4: the ranges covering it, when the street wasn't found.
 *   3. ZIP: when every range in the ZIP has the same rate (a ZIP that
 *      doesn't cross a boundary, or a one-rate state).
 *   4. Map: when the caller can place the address on a map, the ZIP's areas
 *      whose county and city outlines (Census TIGER) hold the point. Both
 *      sources must agree, and a point too close to a line for its
 *      geocode's accuracy is refused.
 * Otherwise the address is refused with the rates it could be, for the owner
 * to pick. Rates add up: state, then county, city and each special district
 * on the date asked.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  salesTaxAreas,
  salesTaxDataReleases,
  salesTaxJurisdictionRates,
  salesTaxShapes,
  salesTaxStreetRanges,
} from "../db/schema.js";
import { parseStreet } from "../address.js";
import { RateError } from "../errors.js";
import type { StandardAddress } from "../standardize/index.js";
import { citiesInZip, normalizeCity, zipAreas, zipDefaultAreas } from "./places.js";
import { findStreet, listedInZip } from "./streets/index.js";
import type { StreetPicker } from "./streets/jev.js";
import { HISTORY_FROM, RANGE_FIPS, WHOLE_CODE_TYPE } from "../coverage.js";
import { rangePolygonAreas } from "./range-polygons.js";
import { pointsAcross, shapesAround, shapesHolding } from "./shapes.js";
import { agreedByType, sumByType, traceOutline, type RatePart, type RatesByType, type Trace } from "./types.js";
import { marginOf, type LocatedPoint, type Locate } from "../geocoding/types.js";
import { PARAMS } from "../params.js";

export interface SstRate {
  rate: number;
  /** The combined rate for each kind of sale. Where the matched areas share
   *  a general rate but not another, that one is null. */
  byType: RatesByType;
  parts: RatePart[];
  match: "street" | "zip4" | "zip5" | "map";
  /** "state-county-place[-district...]" FIPS codes; null when several areas
   *  share the rate and the address doesn't say which. */
  locationCode: string | null;
  /** The ids the boundary file gives the matched area, keyed by the
   *  publisher's column name (Washington's location code in the composite
   *  SER column, Missouri's jurisdiction code); {} when the matched areas
   *  differ. */
  locationIds: Record<string, string>;
  files: string[];
  /** How the address was found when not by its own typed street, e.g. "street
   *  read as COFFEY RD (closest spelling in the ZIP)". */
  note?: string;
}

interface Lookup {
  state: string;
  street: string;
  city: string;
  zip?: string | null;
  /** Places the address on a map; asked only when the ZIP alone can't say. */
  locate?: Locate;
  /** The address in the Postal Service's form with its ZIP+4; asked only
   *  when the typed street isn't found and no ZIP+4 was typed. */
  standardize?: () => Promise<StandardAddress | null>;
  /** Records the deciding street range and the outlines around a map point. */
  trace?: Trace;
  /** Reads a misspelled street as one of the ZIP's; see StreetQuery. */
  pickStreet?: StreetPicker | null;
}

export async function sstRateAt(input: Lookup, date: string): Promise<SstRate> {
  const fips = RANGE_FIPS[input.state];
  const releases = await releaseFiles(input.state);
  const files = releases.map((r) => r.file);
  if (!fips || files.length < 2)
    throw new RateError(
      `This service hasn't loaded ${input.state}'s rate and boundary files.`,
      502,
    );
  if (date < HISTORY_FROM)
    throw new RateError(
      `This service keeps ${input.state}'s rates from ${HISTORY_FROM}. Enter the rate the sale charged.`,
      422,
    );
  let zip5 = /^(\d{5})/.exec(input.zip ?? "")?.[1] ?? null;
  let plus4 = /^\d{5}-?(\d{4})$/.exec(input.zip ?? "")?.[1] ?? null;
  let standardizedZip4 = false;
  const city = normalizeCity(input.city);
  const notes: string[] = [];

  let foundStreet = input.street;
  let found = await findStreet({ state: input.state, street: input.street, city: input.city, zip5, date, pickStreet: input.pickStreet });
  // Off every street range with no ZIP+4 typed, the address's own ZIP (and
  // ZIP+4, where it has one) and its street as the Postal Service writes it
  // may still place it. A ZIP other than the typed one is a different
  // address, not a correction.
  if (!found && !plus4 && input.standardize) {
    const standard = await input.standardize();
    if (standard && (!zip5 || standard.zip5 === zip5)) {
      zip5 = standard.zip5;
      plus4 = standard.plus4;
      standardizedZip4 = plus4 !== null;
      notes.push(
        plus4
          ? `ZIP+4 ${zip5}-${plus4} from ${standard.source}${standard.exact ? "" : " (the building's; no unit given)"}`
          : `ZIP ${zip5} from ${standard.source}`,
      );
      found = await findStreet({ state: input.state, street: standard.street, city: standard.city || input.city, zip5, date, pickStreet: input.pickStreet });
      if (found) foundStreet = standard.street;
      if (found) notes.push(`street as ${standard.source} writes it, ${standard.street}`);
    }
  }
  if (found?.note) notes.push(found.note);
  const streetAreas = found?.areaIds ?? [];
  const zip4Areas =
    zip5 && plus4 ? await zipAreas(input.state, zip5, date, Number(plus4)) : [];

  const answer = async (
    areaIds: number[],
    match: SstRate["match"],
  ): Promise<SstRate | null> => {
    const rated = await rateAreas(input.state, fips, areaIds, date);
    const rates = new Set(rated.map((a) => a.rate));
    if (rates.size !== 1) return null;
    return {
      rate: rated[0].rate,
      byType: agreedByType(rated.map((a) => a.byType)),
      parts: rated[0].parts,
      match,
      locationCode: rated.length === 1 ? rated[0].locationCode : null,
      locationIds: new Set(rated.map((a) => JSON.stringify(a.locationIds))).size === 1 ? rated[0].locationIds : {},
      files,
      ...(notes.length ? { note: notes.join("; ") } : {}),
    };
  };

  if (streetAreas.length) {
    const byStreet = await answer(streetAreas, "street");
    if (byStreet && zip4Areas.length) {
      const byZip4 = await answer(zip4Areas, "zip4");
      if (!byZip4 || byZip4.rate !== byStreet.rate)
        throw await refusal(
          input,
          `${input.state}'s street ranges and ZIP+4 ranges disagree on this address's rate.`,
          [...streetAreas, ...zip4Areas],
          fips,
          date,
        );
    }
    // Street ranges are filed by the hundred-block, and a block can straddle
    // a city line; where the ZIP has more than one rate and the address can
    // be placed, the outlines its point falls in must not say otherwise. A
    // point interpolated along the street is read from ranges like these,
    // and often far off on rural roads, so it can't overrule them.
    // An area of the ZIP the loaded rates don't cover can't speak either.
    if (byStreet && !zip4Areas.length && zip5 && input.locate) {
      const inZip = await zipAreas(input.state, zip5, date);
      const zipRates = await rateAreas(input.state, fips, inZip, date).then(
        (rated) => new Set(rated.map((a) => a.rate)).size,
        () => 2,
      );
      const point = zipRates > 1 ? await input.locate() : null;
      const refined =
        point && point.accuracy !== "interpolated"
          ? await mapWithRefinement(input.state, inZip, point, date, input.locate, input.trace, files, false)
          : null;
      const onMap = refined ? refined.areas : [];
      const mappedPoint = refined?.point;
      if (Array.isArray(onMap) && onMap.length) {
        const byMap = await answer(onMap, "map").catch(() => null);
        // Street ranges are filed by the hundred-block; a precise point that
        // two datasets agree on, clear of every line, says which side of the
        // block's county or city line the house is on.
        const mapped = (mappedPoint ?? point)!;
        // Two datasets, not two providers: Geocodio's TIGER points are Census's.
        const datasets = new Set((mapped.placedBy ?? []).map((p) => /\(([^)]*)\)$/.exec(p)?.[1] ?? p));
        if (byMap && byMap.rate !== byStreet.rate && datasets.size >= 2 && marginOf(mapped) <= PARAMS.preciseMetres) {
          notes.push(`the map point, placed by ${mapped.placedBy!.join(", ")}, in place of the street range's ${+(byStreet.rate * 100).toFixed(4)}%`);
          return traced({ ...byMap, note: notes.join("; ") }, input.trace);
        }
        if (byMap && byMap.rate !== byStreet.rate)
          throw await refusal(
            input,
            `${input.state}'s street ranges and the county and city outlines its map point falls in disagree on this address's rate.`,
            [...streetAreas, ...onMap],
            fips,
            date,
          );
      }
    }
    if (byStreet) {
      if (input.trace) input.trace.range = await rangeAt(input.state, foundStreet, zip5, streetAreas, date, releases);
      return traced(byStreet, input.trace);
    }
    throw await refusal(
      input,
      `${input.state}'s files put this street address in more than one taxing area.`,
      streetAreas,
      fips,
      date,
    );
  }
  if (zip4Areas.length) {
    const byZip4 = await answer(zip4Areas, "zip4");
    // A ZIP+4 looked up here, not typed, is a lead: it answers unless the
    // map, placed apart from it, says otherwise; and in a state whose ZIP+4
    // ranges have put houses in the wrong area, only where the map agrees.
    if (byZip4 && standardizedZip4 && zip5) {
      const inZip = await zipAreas(input.state, zip5, date);
      const point = input.locate ? await input.locate() : null;
      const mapped = point ? await mapWithRefinement(input.state, inZip, point, date, input.locate, input.trace, files) : null;
      // Coverage that ingestion couldn't verify can't be confirmed by the
      // ZIP+4 that may leave its district out.
      if (mapped?.areas === "unresolved") throw unresolved(input.state, date, mapped.file);
      const onMap = mapped && Array.isArray(mapped.areas) ? mapped.areas : [];
      const byMap = onMap.length ? await answer(onMap, "map") : null;
      // An automatically obtained ZIP+4 is only a lead. Complete tax
      // polygons may settle its conflict; a caller-supplied ZIP+4 and a
      // published street range are not overridden by this fallback.
      if (byMap && mapped?.taxPolygons && (byMap.rate === byZip4.rate || PARAMS.outlinesOverZip4)) {
        notes.push(byMap.rate === byZip4.rate ? "confirmed by tax polygons" : "tax polygons resolve the conflicting looked-up ZIP+4");
        return traced({ ...byMap, note: notes.join("; ") }, input.trace);
      }
      const contradicted = byMap && byMap.rate !== byZip4.rate;
      if (contradicted || (!byMap && UNCONFIRMED_ZIP4_STATES.includes(input.state)))
        throw await refusal(
          input,
          `${input.state}'s files have no range for this street, and its ZIP+4 ${zip5}-${plus4} isn't confirmed by the address's place on the map.`,
          [...zip4Areas, ...onMap],
          fips,
          date,
        );
      if (byMap) notes.push("confirmed by the map");
      return { ...byZip4, note: notes.join("; ") };
    }
    if (byZip4) return byZip4;
  }
  if (!zip5)
    throw new RateError(
      `${input.state}'s files have no range for this street. Add the ZIP code.`,
      422,
    );
  const inZip = await zipAreas(input.state, zip5, date);
  // A ZIP alone answers only for a city its ranges name, so a mistyped ZIP
  // doesn't lend its rate to an address elsewhere.
  const zipCities = await citiesInZip(input.state, zip5, date);
  const cityNamed = !zipCities.length || zipCities.includes(city);
  if (inZip.length && cityNamed) {
    const byZip = await answer(inZip, "zip5");
    if (byZip) return byZip;
  }
  // A street the ZIP's file doesn't list at all takes the ZIP's default, as
  // the Streamlined files rank them, where the ZIP's other areas add only
  // special districts: a district is the streets listed for it (Teton
  // County's resort districts, around a 7% default), but a city or county
  // levies on every street in it, and a default without one (West
  // Virginia's state-only rows) is a fallback, not the street's rate. A
  // listed street whose house isn't listed doesn't take it either.
  if (inZip.length > 1 && cityNamed) {
    const byDefault = await zipDefaultAreas(input.state, zip5, date);
    const rated = byDefault.length === 1 ? await rateAreas(input.state, fips, inZip, date).catch(() => []) : [];
    const levies = (a: (typeof rated)[number]) =>
      // By the publisher's type: a place filed as a district (WY's 69) is one.
      a.parts.filter((p) => /^0[01]:/.test(p.code)).map((p) => p.code).sort().join();
    const base = rated.find((a) => a.areaId === byDefault[0]);
    // A whole-code area (Missouri's) files its city and county as one
    // code, so it can't show that only districts set it apart.
    const wholeCode = rated.some((a) => a.parts.some((p) => p.code.startsWith(`${WHOLE_CODE_TYPE}:`)));
    const districtsApart =
      !!base && !wholeCode && rated.length === inZip.length && rated.every((a) => levies(a) === levies(base));
    if (districtsApart && !(await listedInZip({ ...input, zip5, date }))) {
      notes.push(`street not in ZIP ${zip5}'s file; the ZIP's default`);
      const answered = await answer(byDefault, "zip5");
      if (answered) return answered;
    }
  }
  // A ZIP split between rates, or one whose ranges don't name the typed city,
  // is settled on the map: the point must fall in an area's county and city.
  let point =
    (inZip.length > 1 || (inZip.length === 1 && !cityNamed)) && input.locate
      ? await input.locate()
      : null;
  if (point) {
    const mapped = await mapWithRefinement(input.state, inZip, point, date, input.locate, input.trace, files);
    const onMap = mapped.areas;
    point = mapped.point;
    if (onMap === "unresolved") throw unresolved(input.state, date, mapped.file);
    if (onMap === "near_edge")
      throw await refusal(
        input,
        `This address is within ${marginOf(point)} m of a county or city line in ${input.state}, too close to tell which side from the map.`,
        inZip,
        fips,
        date,
      );
    if (onMap.length) {
      if (point.placedBy?.length) notes.push(`placed by ${point.placedBy.join(", ")}`);
      const byMap = await answer(onMap, "map");
      if (byMap) return traced(byMap, input.trace);
    }
  }
  throw await refusal(
    input,
    inZip.length > 1
      ? `${input.state}'s files have no range for this street, and ZIP ${zip5} has more than one rate.`
      : inZip.length
        ? `${input.state}'s files have no range for this street, and ZIP ${zip5}'s ranges don't name ${input.city}.`
        : `${input.state}'s files have nothing for ZIP ${zip5} on ${date}.`,
    inZip,
    fips,
    date,
  );
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

/** States whose ZIP+4 ranges put a looked-up ZIP+4 in the wrong area (Missouri:
 *  2 of 4 on the bench), so one must be confirmed by the map. */
const UNCONFIRMED_ZIP4_STATES = ["MO"];

async function mapWithRefinement(state: string, areaIds: number[], point: LocatedPoint, date: string, locate?: Locate, trace?: Trace, files?: string[], useTaxPolygons = true) {
  const map = async () => {
    const polygon = useTaxPolygons ? await rangePolygonAreas(state, areaIds, point, date, trace) : null;
    if (polygon) {
      if (files && !files.includes(polygon.file)) files.push(polygon.file);
      return { areas: polygon.areas, taxPolygons: true, held: polygon.held ?? false, file: polygon.file };
    }
    return { areas: await mapAreas(state, areaIds, point, date, trace), taxPolygons: false, held: false, file: "" };
  };
  let mapped: Awaited<ReturnType<typeof map>> = await map();
  if (mapped.areas === "near_edge" && locate) {
    const sharper = await locate({ marginUnder: marginOf(point) });
    if (sharper) {
      point = sharper;
      mapped = await map();
    }
  }
  // Still within its margin of coverage that couldn't be verified, the
  // address may be in it: unresolved, never the ordinary map's smaller total.
  if (mapped.areas === "near_edge" && mapped.held) mapped = { ...mapped, areas: "unresolved" };
  return { ...mapped, point };
}

/** A refusal for an address in, or too near, a district ingestion found but
 *  couldn't verify a complete rate for: the rates the ZIP's files give may
 *  leave it out, so none is offered. */
function unresolved(state: string, date: string, file: string) {
  return new RateError(
    `${state}'s tax-area outlines (${file}) put this address in or near a taxing district whose complete rate on ${date} this service couldn't verify. Confirm the rate with ${state}'s own lookup; no partial rate has been returned.`,
    422,
  );
}

/** The candidate areas whose county and city (or town) hold the point. An
 *  area with no city fits a point outside every candidate city, since the
 *  files leave out cities that levy nothing. */
async function mapAreas(
  state: string,
  areaIds: number[],
  point: LocatedPoint,
  date: string,
  trace?: Trace,
): Promise<number[] | "near_edge"> {
  const areas = await db
    .select()
    .from(salesTaxAreas)
    .where(inArray(salesTaxAreas.id, areaIds));
  const candidatePlaces = [
    ...new Set(areas.map((a) => a.place).filter((p): p is string => !!p)),
  ];
  // A candidate city with no outline to test (a state's own code for a
  // district or part-town, not a Census place) can't be ruled in or out, so
  // its areas stay possible wherever the point is; the rates must still
  // agree for an answer.
  let unoutlined = new Set<string>();
  if (candidatePlaces.length) {
    const outlined = await db
      .selectDistinct({ fips: salesTaxShapes.fips })
      .from(salesTaxShapes)
      .where(
        and(
          eq(salesTaxShapes.state, state),
          inArray(salesTaxShapes.kind, ["place", "cousub"]),
          inArray(salesTaxShapes.fips, candidatePlaces),
        ),
      );
    const have = new Set(outlined.map((o) => o.fips));
    unoutlined = new Set(candidatePlaces.filter((p) => !have.has(p)));
  }
  // Outlines within ~300 m of the point.
  const pad = Math.max(0.003, marginOf(point) / (110_000 * Math.max(0.1, Math.cos(point.lat * Math.PI / 180))));
  const shapes = await shapesAround(state, point, pad);
  if (trace) for (const s of shapes) traceOutline(trace, s);
  const holding = new Set(shapes.filter(s => s.inside).map(s => `${s.kind}:${s.fips}`));
  const candidateCounties = new Set(areas.map(a => a.county).filter(Boolean));
  const candidatesAt = (holding: Set<string>) => {
    const counties = [...holding].filter(key => key.startsWith("county:")).map(key => key.slice(7));
    if (!counties.length) return [];
    const inside = (place: string) => holding.has(`place:${place}`) || holding.has(`cousub:${place}`);
    return areas.filter(a =>
      (a.county ? counties.includes(a.county) : Boolean(a.place) || !counties.some(c => candidateCounties.has(c)))
      && (a.place ? inside(a.place) || unoutlined.has(a.place) : !candidatePlaces.some(inside)),
    ).map(a => a.id);
  };
  const here = candidatesAt(holding);
  if (![...holding].some(key => key.startsWith("county:"))) return [];
  const nearby = shapes.filter(s => s.edgeMetres < marginOf(point)
    && (s.kind === "county" ? candidateCounties.has(s.fips)
      : (s.kind === "place" || s.kind === "cousub") && candidatePlaces.includes(s.fips)));
  if (!nearby.length) return here;

  const rated = await rateAreas(state, RANGE_FIPS[state], areaIds, date);
  const totals = new Map(rated.map(a => [a.areaId, a.rate]));
  const signature = (ids: number[]) => [...new Set(ids.map(id => totals.get(id)))].sort().join("|");
  const hereRate = signature(here);
  for (const shape of nearby)
    for (const beyond of pointsAcross(point, shape.foot, shape.edgeMetres, 2)) {
      const across = await shapesHolding(state, beyond);
      // Outside the requested state's county outlines is not another candidate rate.
      if (![...across].some(key => key.startsWith("county:"))) continue;
      if (signature(candidatesAt(across)) !== hereRate) return "near_edge";
    }
  return here;
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

const NOT_DISTRICTS = ["00", "01", "45"];
/** Each area's combined rate on `date`, with its parts. A jurisdiction with
 *  no rate on the date levies none. Some states file a place or district
 *  under a different type in the two files, so a code not found under its
 *  own type is looked up among the district types. */
export async function rateAreas(
  state: string,
  fips: string,
  areaIds: number[],
  date: string,
) {
  const areas = await db
    .select()
    .from(salesTaxAreas)
    .where(inArray(salesTaxAreas.id, areaIds));
  const codes = new Set([fips]);
  for (const a of areas) {
    if (a.county) codes.add(a.county);
    if (a.place) codes.add(a.place);
    for (const d of districtsOf(a.districts)) codes.add(d.code);
  }
  const rateRows = await db
    .select()
    .from(salesTaxJurisdictionRates)
    .where(
      and(
        eq(salesTaxJurisdictionRates.state, state),
        inArray(salesTaxJurisdictionRates.code, [...codes]),
        lte(salesTaxJurisdictionRates.startsOn, date),
        gte(salesTaxJurisdictionRates.endsOn, date),
      ),
    )
    .orderBy(salesTaxJurisdictionRates.startsOn);
  // A later start wins where a file overlaps two spans.
  const rates = new Map(rateRows.map((r) => [`${r.type}:${r.code}`, r]));
  const find = (type: string, code: string) => {
    const own = rates.get(`${type}:${code}`);
    if (own) return own;
    return [...rateRows]
      .reverse()
      .find((r) => r.code === code && !NOT_DISTRICTS.includes(r.type));
  };

  const stateRate = rates.get(`45:${fips}`);
  if (!stateRate)
    throw new RateError(
      `The ${state} rate file has no state rate on ${date}.`,
      502,
    );
  return areas.map((a) => {
    const parts: RatePart[] = [
      { kind: "state", code: `45:${fips}`, rate: Number(stateRate.rate), byType: byTypeOf(stateRate) },
    ];
    const districts = districtsOf(a.districts);
    const add = (kind: RatePart["kind"], type: string, code: string) => {
      // Only a city or district may be filed under another type, and never
      // as one of the area's own districts, which count on their own.
      const row =
        kind === "county"
          ? rates.get(`${type}:${code}`)
          : (rates.get(`${type}:${code}`) ??
            (kind === "city" && districts.some((d) => d.code === code) ? undefined : find(type, code)));
      if (row && !parts.some((p) => p.code === `${row.type}:${code}`))
        parts.push({ kind, code: `${row.type}:${code}`, rate: Number(row.rate), byType: byTypeOf(row) });
      // A Missouri code is the address's whole local rate; none on the date
      // is missing data, not no tax.
      else if (!row && type === WHOLE_CODE_TYPE)
        throw new RateError(
          `The loaded ${state} rates don't cover jurisdiction ${code} on ${date}.`,
          422,
        );
    };
    if (a.county) add("county", "00", a.county);
    if (a.place) add("city", "01", a.place);
    for (const d of districts) add("district", d.type, d.code);
    return {
      areaId: a.id,
      rate: round(parts.reduce((sum, p) => sum + p.rate, 0)),
      byType: sumByType(parts.map((p) => p.byType!)),
      parts,
      locationIds: a.ids,
      locationCode: [
        fips,
        a.county ?? "000",
        a.place ?? "00000",
        ...districtsOf(a.districts).map((d) => d.code),
      ].join("-"),
    };
  });
}

function byTypeOf(row: typeof salesTaxJurisdictionRates.$inferSelect): RatesByType {
  const optional = (r: string | null) => (r === null ? null : Number(r));
  return {
    general: Number(row.rate),
    generalInterstate: optional(row.rateInterstate),
    foodDrug: optional(row.foodDrugRate),
    foodDrugInterstate: optional(row.foodDrugRateInterstate),
  };
}

function districtsOf(districts: string) {
  return districts
    .split(" ")
    .filter(Boolean)
    .map((d) => {
      const [type, code] = d.split(":");
      return { type, code };
    });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A refusal naming the rates the address could be and the cities they're
 *  in, so the owner can pick one. */
async function refusal(
  input: Lookup,
  reason: string,
  areaIds: number[],
  fips: string,
  date: string,
) {
  if (!areaIds.length)
    return new RateError(
      `${reason} Verify the street, city and ZIP; no rate has been guessed.`,
      422,
    );
  const rated = await rateAreas(input.state, fips, [...new Set(areaIds)], date);
  const cities = await citiesOf(input.state, rated.map((a) => a.areaId));
  const byRate = new Map<number, Set<string>>();
  for (const a of rated) {
    const names = byRate.get(a.rate) ?? new Set<string>();
    for (const c of cities.get(a.areaId) ?? []) names.add(c);
    byRate.set(a.rate, names);
  }
  const options = [...byRate]
    .sort(([a], [b]) => a - b)
    .slice(0, 6)
    .map(([rate, names]) => {
      const where = [...names].slice(0, 3).join(", ");
      return `${+(rate * 100).toFixed(4)}%${where ? ` (${where})` : ""}`;
    });
  return new RateError(
    `${reason} It could be ${options.join(" or ")}. Confirm the full street address, or pick the rate.`,
    422,
  );
}

async function citiesOf(state: string, areaIds: number[]) {
  const rows = await db
    .selectDistinct({
      areaId: salesTaxStreetRanges.areaId,
      city: salesTaxStreetRanges.city,
    })
    .from(salesTaxStreetRanges)
    .where(
      and(
        eq(salesTaxStreetRanges.state, state),
        inArray(salesTaxStreetRanges.areaId, areaIds),
        sql`${salesTaxStreetRanges.city} <> ''`,
      ),
    )
    .limit(50);
  const cities = new Map<number, string[]>();
  for (const r of rows)
    cities.set(r.areaId, [...(cities.get(r.areaId) ?? []), titleCase(r.city)]);
  return cities;
}

async function releaseFiles(state: string) {
  return db
    .select({ kind: salesTaxDataReleases.kind, file: salesTaxDataReleases.file })
    .from(salesTaxDataReleases)
    .where(eq(salesTaxDataReleases.state, state))
    .orderBy(salesTaxDataReleases.kind);
}

/** The street range a trace shows for a street match: the narrowest range
 *  on the matched street that holds the house and is in one of the areas
 *  that decided. None when the address was found another way (between
 *  listed houses, or under a corrected name the typed key doesn't share). */
async function rangeAt(
  state: string,
  line: string,
  zip5: string | null,
  areaIds: number[],
  date: string,
  releases: Array<{ kind: string; file: string }>,
): Promise<Trace["range"]> {
  const street = parseStreet(line);
  if (!street || street.house === null || !areaIds.length) return undefined;
  const r = salesTaxStreetRanges;
  const [row] = await db
    .select()
    .from(r)
    .where(
      and(
        eq(r.state, state),
        eq(r.streetKey, street.streetKey),
        inArray(r.areaId, areaIds),
        lte(r.startsOn, date),
        gte(r.endsOn, date),
        lte(r.houseLow, street.house),
        gte(r.houseHigh, street.house),
        zip5 ? eq(r.zip5, zip5) : undefined,
      ),
    )
    .orderBy(sql`${r.houseHigh} - ${r.houseLow}`)
    .limit(1);
  if (!row) return undefined;
  return {
    street: row.street,
    low: row.houseLow ?? street.house,
    high: row.houseHigh ?? street.house,
    side: row.parity === "O" ? "odd" : row.parity === "E" ? "even" : "both",
    zip: row.zip5 || null,
    file: releases.find((x) => x.kind === "boundaries")?.file ?? releases[0]?.file ?? "",
  };
}

/** Marks the traced outlines whose county or city is one of the answer's
 *  parts. */
function traced(found: SstRate, trace?: Trace): SstRate {
  // A tax-area outline's `levies` is set where it was tested.
  for (const o of trace?.outlines.filter((o) => o.kind !== "district") ?? []) {
    const kind = o.kind === "county" ? "county" : "city";
    o.levies = found.parts.some((p) => p.kind === kind && p.code.split(":")[1] === o.fips);
  }
  return found;
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const round = (n: number) => Math.round(n * 1e6) / 1e6;
