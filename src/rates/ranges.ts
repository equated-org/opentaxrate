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
import { RateError } from "../errors.js";
import type { StandardAddress } from "../standardize/index.js";
import { citiesInZip, normalizeCity, zipAreas } from "./places.js";
import { findStreet } from "./streets/index.js";
import { HISTORY_FROM, RANGE_FIPS, WHOLE_CODE_TYPE } from "../coverage.js";
import { shapesAround } from "./shapes.js";
import { agreedByType, sumByType, type RatePart, type RatesByType } from "./types.js";
import { marginOf, type LocatedPoint } from "../geocoding/index.js";

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
  locate?: () => Promise<LocatedPoint | null>;
  /** The address in the Postal Service's form with its ZIP+4; asked only
   *  when the typed street isn't found and no ZIP+4 was typed. */
  standardize?: () => Promise<StandardAddress | null>;
}

export async function sstRateAt(input: Lookup, date: string): Promise<SstRate> {
  const fips = RANGE_FIPS[input.state];
  const files = await releaseFiles(input.state);
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
  const city = normalizeCity(input.city);
  const notes: string[] = [];

  let found = await findStreet({ state: input.state, street: input.street, city: input.city, zip5, date });
  // Off every street range with no ZIP+4 typed, the address's own ZIP+4, and
  // its street as the Postal Service writes it, may still place it. A ZIP
  // other than the typed one is a different address, not a correction.
  if (!found && !plus4 && input.standardize) {
    const standard = await input.standardize();
    if (standard && (!zip5 || standard.zip5 === zip5)) {
      zip5 = standard.zip5;
      plus4 = standard.plus4;
      notes.push(`ZIP+4 ${zip5}-${plus4} from ${standard.source}`);
      found = await findStreet({ state: input.state, street: standard.street, city: standard.city || input.city, zip5, date });
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
    // be placed, the outlines its point falls in must not say otherwise.
    if (byStreet && !zip4Areas.length && zip5 && input.locate) {
      const inZip = await zipAreas(input.state, zip5, date);
      const zipRates = new Set((await rateAreas(input.state, fips, inZip, date)).map((a) => a.rate));
      const point = zipRates.size > 1 ? await input.locate() : null;
      const onMap = point ? await mapAreas(input.state, inZip, point) : [];
      if (onMap !== "near_edge" && onMap.length) {
        const byMap = await answer(onMap, "map");
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
    if (byStreet) return byStreet;
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
  // A ZIP split between rates, or one whose ranges don't name the typed city,
  // is settled on the map: the point must fall in an area's county and city.
  const point =
    (inZip.length > 1 || (inZip.length === 1 && !cityNamed)) && input.locate
      ? await input.locate()
      : null;
  if (point) {
    const onMap = await mapAreas(input.state, inZip, point);
    if (onMap === "near_edge")
      throw await refusal(
        input,
        `This address is within ${marginOf(point)} m of a county or city line in ${input.state}, too close to tell which side from the map.`,
        inZip,
        fips,
        date,
      );
    if (onMap.length) {
      const byMap = await answer(onMap, "map");
      if (byMap) return byMap;
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

/** The candidate areas whose county and city (or town) hold the point. An
 *  area with no city fits a point outside every candidate city, since the
 *  files leave out cities that levy nothing. */
async function mapAreas(
  state: string,
  areaIds: number[],
  point: LocatedPoint,
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
  const shapes = await shapesAround(state, point, 0.003);
  const county = shapes.find((s) => s.kind === "county" && s.inside);
  if (!county) return [];
  const inside = new Set(shapes.filter((s) => s.kind !== "county" && s.inside).map((s) => s.fips));

  const deciding = new Set([
    ...areas.map((a) => `county:${a.county}`),
    ...candidatePlaces.map((p) => `place:${p}`),
  ]);
  // A county line matters only toward another candidate county: the edge of
  // the county holding the point may be the state line, with no rate across.
  for (const s of shapes)
    if (
      deciding.has(`${s.kind === "county" ? "county" : "place"}:${s.fips}`) &&
      !(s.kind === "county" && s.inside) &&
      s.edgeMetres < marginOf(point)
    )
      return "near_edge";

  // Likewise an area with no county and no city fits only a point in a
  // county no candidate names: some files leave out counties that levy
  // nothing (Minnesota), and a ZIP-wide default may list the state alone.
  const candidateCounties = new Set(areas.map((a) => a.county).filter(Boolean));
  return areas
    .filter(
      (a) =>
        (a.county
          ? a.county === county.fips
          : Boolean(a.place) || !candidateCounties.has(county.fips)) &&
        (a.place
          ? inside.has(a.place) || unoutlined.has(a.place)
          : !candidatePlaces.some((p) => inside.has(p))),
    )
    .map((a) => a.id);
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

const NOT_DISTRICTS = ["00", "01", "45"];
/** Each area's combined rate on `date`, with its parts. A jurisdiction with
 *  no rate on the date levies none. Some states file a place or district
 *  under a different type in the two files, so a code not found under its
 *  own type is looked up among the district types. */
async function rateAreas(
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
  const rows = await db
    .select({ file: salesTaxDataReleases.file })
    .from(salesTaxDataReleases)
    .where(eq(salesTaxDataReleases.state, state))
    .orderBy(salesTaxDataReleases.kind);
  return rows.map((r) => r.file);
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const round = (n: number) => Math.round(n * 1e6) / 1e6;
