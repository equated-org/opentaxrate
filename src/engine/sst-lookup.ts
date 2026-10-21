/**
 * Finds the rate at an address in a Streamlined member state from the
 * state's own files, as loaded by load.ts. Tries the most precise match the
 * address allows, and only answers where the state's data has one rate there:
 *
 *   1. Street: a house-number range on the address's street, narrowed by ZIP
 *      or city, then by street type, directions and unit. When a ZIP+4 is
 *      known its ranges must agree; if they disagree the address is refused.
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
import { and, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  salesTaxAreas,
  salesTaxDataReleases,
  salesTaxJurisdictionRates,
  salesTaxShapes,
  salesTaxStreetRanges,
  salesTaxZipRanges,
} from "../schema.js";
import { RateError } from "../errors.js";
import { parseStreet, streetKeysOf, type StreetParts } from "./address.js";
import { HISTORY_FROM, RANGE_FIPS } from "./sst-files.js";
import { shapesAround } from "./shapes.js";
import { marginOf, type LocatedPoint, type RatePart } from "./types.js";

export interface SstRate {
  rate: number;
  parts: RatePart[];
  match: "street" | "zip4" | "zip5" | "map";
  /** "state-county-place[-district...]" FIPS codes; null when several areas
   *  share the rate and the address doesn't say which. */
  locationCode: string | null;
  files: string[];
}

interface Lookup {
  state: string;
  street: string;
  city: string;
  zip?: string | null;
  /** Places the address on a map; asked only when the ZIP alone can't say. */
  locate?: () => Promise<LocatedPoint | null>;
}

type StreetRow = typeof salesTaxStreetRanges.$inferSelect;

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
  const zip5 = /^(\d{5})/.exec(input.zip ?? "")?.[1] ?? null;
  const plus4 = /^\d{5}-?(\d{4})$/.exec(input.zip ?? "")?.[1] ?? null;
  const city = normalizeCity(input.city);
  const street = parseStreet(input.street);

  const streetAreas = street
    ? await streetMatch(input.state, street, zip5, city, date)
    : [];
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
      parts: rated[0].parts,
      match,
      locationCode: rated.length === 1 ? rated[0].locationCode : null,
      files,
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
  if (inZip.length && (!zipCities.length || zipCities.includes(city))) {
    const byZip = await answer(inZip, "zip5");
    if (byZip) return byZip;
  }
  const point = inZip.length > 1 && input.locate ? await input.locate() : null;
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
    inZip.length
      ? `${input.state}'s files have no range for this street, and ZIP ${zip5} has more than one rate.`
      : `${input.state}'s files have nothing for ZIP ${zip5} on ${date}.`,
    inZip,
    fips,
    date,
  );
}

// ---------------------------------------------------------------------------
// Street ranges
// ---------------------------------------------------------------------------

/** The areas of the ranges that best fit the address, or none. The street's
 *  own key is tried before any other spelling of it. */
async function streetMatch(
  state: string,
  street: StreetParts,
  zip5: string | null,
  city: string,
  date: string,
): Promise<number[]> {
  for (const key of streetKeysOf(street)) {
    const rows = await db
      .select()
      .from(salesTaxStreetRanges)
      .where(
        and(
          eq(salesTaxStreetRanges.state, state),
          eq(salesTaxStreetRanges.streetKey, key),
          lte(salesTaxStreetRanges.startsOn, date),
          gte(salesTaxStreetRanges.endsOn, date),
          street.house === null
            ? eq(salesTaxStreetRanges.houseText, street.houseText)
            : or(
                and(
                  lte(salesTaxStreetRanges.houseLow, street.house),
                  gte(salesTaxStreetRanges.houseHigh, street.house),
                  inArray(salesTaxStreetRanges.parity, [
                    "B",
                    street.house % 2 ? "O" : "E",
                  ]),
                ),
                eq(salesTaxStreetRanges.houseText, street.houseText),
              ),
        ),
      );
    const best = bestRows(rows, street, zip5, city);
    if (best.length) return [...new Set(best.map((r) => r.areaId))];
  }
  return [];
}

/** Narrows a street's ranges step by step, each step keeping the rows that
 *  fit best and never emptying the set on a detail the address leaves out. */
function bestRows(
  rows: StreetRow[],
  street: StreetParts,
  zip5: string | null,
  city: string,
): StreetRow[] {
  // The place must agree: the same ZIP, or failing that the same city (a
  // typed ZIP is sometimes a neighbour's).
  let kept = zip5 ? rows.filter((r) => r.zip5 === zip5) : [];
  if (!kept.length) kept = rows.filter((r) => normalizeCity(r.city) === city);

  // A type or direction both sides state must match; one side's silence
  // is allowed, but an exact match beats it.
  const directions = (pre: string, post: string) =>
    [pre, post].filter(Boolean).sort().join(" ");
  const wanted = directions(street.preDirectional, street.postDirectional);
  kept = kept.filter(
    (r) =>
      (!street.suffix || !r.suffix || r.suffix === street.suffix) &&
      (!wanted ||
        !directions(r.preDirectional, r.postDirectional) ||
        directions(r.preDirectional, r.postDirectional) === wanted),
  );
  kept = preferring(kept, (r) => r.suffix === street.suffix);
  kept = preferring(
    kept,
    (r) => directions(r.preDirectional, r.postDirectional) === wanted,
  );

  // A unit range speaks only for the units in it.
  kept = kept.filter(
    (r) => !r.unitLow || (street.unit && unitIn(street.unit, r)),
  );
  return preferring(kept, (r) =>
    street.unit ? Boolean(r.unitLow) : !r.unitLow,
  );
}

function preferring<T>(rows: T[], better: (row: T) => boolean): T[] {
  const best = rows.filter(better);
  return best.length ? best : rows;
}

function unitIn(unit: string, r: StreetRow) {
  const low = r.unitLow ?? "";
  const high = r.unitHigh || low;
  if (/^\d+$/.test(unit) && /^\d+$/.test(low) && /^\d+$/.test(high))
    return Number(low) <= Number(unit) && Number(unit) <= Number(high);
  return unit === low.toUpperCase() || unit === high.toUpperCase();
}

// ---------------------------------------------------------------------------
// ZIP ranges
// ---------------------------------------------------------------------------

/** The areas in a ZIP, or in one ZIP+4 of it: the ZIP+4 ranges covering it,
 *  or for a whole ZIP every ZIP and street range in it. */
async function zipAreas(
  state: string,
  zip5: string,
  date: string,
  plus4?: number,
): Promise<number[]> {
  const zipRows = await db
    .selectDistinct({ areaId: salesTaxZipRanges.areaId })
    .from(salesTaxZipRanges)
    .where(
      and(
        eq(salesTaxZipRanges.state, state),
        eq(salesTaxZipRanges.zip5, zip5),
        lte(salesTaxZipRanges.startsOn, date),
        gte(salesTaxZipRanges.endsOn, date),
        plus4 === undefined
          ? undefined
          : and(
              eq(salesTaxZipRanges.kind, "zip4"),
              lte(salesTaxZipRanges.plus4Low, plus4),
              gte(salesTaxZipRanges.plus4High, plus4),
            ),
      ),
    );
  if (plus4 !== undefined) return zipRows.map((r) => r.areaId);
  const streetRows = await db
    .selectDistinct({ areaId: salesTaxStreetRanges.areaId })
    .from(salesTaxStreetRanges)
    .where(
      and(
        eq(salesTaxStreetRanges.state, state),
        eq(salesTaxStreetRanges.zip5, zip5),
        lte(salesTaxStreetRanges.startsOn, date),
        gte(salesTaxStreetRanges.endsOn, date),
      ),
    );
  return [...new Set([...zipRows, ...streetRows].map((r) => r.areaId))];
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

/** The candidate areas whose county and city (or town) hold the point. An
 *  area with no city fits a point outside every candidate city, since the
 *  files leave out cities that levy nothing. Nothing is settled when a
 *  candidate's city has no outline to test. */
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
    if (outlined.length < candidatePlaces.length) return [];
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
  for (const s of shapes)
    if (
      deciding.has(`${s.kind === "county" ? "county" : "place"}:${s.fips}`) &&
      s.edgeMetres < marginOf(point)
    )
      return "near_edge";

  return areas
    .filter(
      (a) =>
        (!a.county || a.county === county.fips) &&
        (a.place
          ? inside.has(a.place)
          : !candidatePlaces.some((p) => inside.has(p))),
    )
    .map((a) => a.id);
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

const NOT_DISTRICTS = ["00", "01", "45"];
/** The type a state that publishes only whole-location rates (Missouri)
 *  files them under. */
export const WHOLE_CODE_TYPE = "99";

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
      { kind: "state", code: `45:${fips}`, rate: Number(stateRate.rate) },
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
        parts.push({ kind, code: `${row.type}:${code}`, rate: Number(row.rate) });
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

async function citiesInZip(state: string, zip5: string, date: string) {
  const rows = await db
    .selectDistinct({ city: salesTaxStreetRanges.city })
    .from(salesTaxStreetRanges)
    .where(
      and(
        eq(salesTaxStreetRanges.state, state),
        eq(salesTaxStreetRanges.zip5, zip5),
        lte(salesTaxStreetRanges.startsOn, date),
        gte(salesTaxStreetRanges.endsOn, date),
        sql`${salesTaxStreetRanges.city} <> ''`,
      ),
    );
  return rows.map((r) => normalizeCity(r.city));
}

async function releaseFiles(state: string) {
  const rows = await db
    .select({ file: salesTaxDataReleases.file })
    .from(salesTaxDataReleases)
    .where(eq(salesTaxDataReleases.state, state))
    .orderBy(salesTaxDataReleases.kind);
  return rows.map((r) => r.file);
}

function normalizeCity(city: string) {
  return city
    .toUpperCase()
    .replace(/[.,']/g, "")
    .replace(/^SAINT /, "ST ")
    .replace(/^MOUNT /, "MT ")
    .replace(/^FORT /, "FT ")
    .replace(/\s+/g, " ")
    .trim();
}

const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const round = (n: number) => Math.round(n * 1e6) / 1e6;
