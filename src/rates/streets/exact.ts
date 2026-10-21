/**
 * A typed street's own ranges in the state's file: its key and every other
 * spelling a file may use, narrowed by place, type, directions and unit.
 */
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "../../db/client.js";
import { salesTaxAreas, salesTaxShapes, salesTaxStreetRanges } from "../../db/schema.js";
import { letteredHouse, parseStreet, streetVariantsOf, type StreetParts } from "../../address.js";
import { citiesInZip, normalizeCity, zipAreas } from "../places.js";

export type StreetRow = typeof salesTaxStreetRanges.$inferSelect;


/** The areas of the ranges that best fit the address, or none. The street's
 *  own key is tried before any other spelling of it. */
export async function exactAreas(
  state: string,
  street: StreetParts,
  zip5: string | null,
  city: string,
  date: string,
): Promise<number[]> {
  const zipCities = zip5 ? await citiesInZip(state, zip5, date) : [];
  for (const variant of streetVariantsOf(street)) {
    const key = variant.streetKey;
    const rows = await db
      .select()
      .from(salesTaxStreetRanges)
      .where(
        and(
          eq(salesTaxStreetRanges.state, state),
          eq(salesTaxStreetRanges.streetKey, key),
          lte(salesTaxStreetRanges.startsOn, date),
          gte(salesTaxStreetRanges.endsOn, date),
          variant.house === null
            ? or(
                eq(salesTaxStreetRanges.houseText, variant.houseText),
                ...lettered(variant.houseText),
              )
            : or(
                and(
                  isNull(salesTaxStreetRanges.houseText),
                  lte(salesTaxStreetRanges.houseLow, variant.house),
                  gte(salesTaxStreetRanges.houseHigh, variant.house),
                  inArray(salesTaxStreetRanges.parity, [
                    "B",
                    variant.house % 2 ? "O" : "E",
                  ]),
                ),
                eq(salesTaxStreetRanges.houseText, variant.houseText),
              ),
        ),
      );
    const suffixes =
      rows.length && variant.suffix
        ? await suffixesOf(state, key, rows.some((r) => r.zip5 === zip5) ? zip5 : null, city, date)
        : [];
    const best = bestRows(rows, variant, zip5, city, zipCities, suffixes);
    if (best.length) return [...new Set(best.map((r) => r.areaId))];
  }
  // A typed "County Road 932" may be filed under the county's name
  // ("Craighead 932 Rd"): try each county the ZIP reaches, keeping every
  // county's match so two counties' same-numbered roads can't pick one.
  const countyRoad = /^CR(\d+[A-Z]?)$/.exec(street.streetKey)?.[1];
  if (countyRoad && zip5) {
    const found = new Set<number>();
    for (const key of await countyRoadKeys(state, countyRoad, zip5, date))
      for (const id of await exactAreas(state, { ...street, streetKey: key, alternates: [] }, zip5, city, date))
        found.add(id);
    return [...found];
  }
  return [];
}

/** A lettered number's place in the file's lettered ranges on its grid line. */
function lettered(houseText: string) {
  const house = letteredHouse(houseText);
  if (!house) return [];
  return [
    and(
      eq(salesTaxStreetRanges.houseText, house.line),
      lte(salesTaxStreetRanges.houseLow, house.number),
      gte(salesTaxStreetRanges.houseHigh, house.number),
      inArray(salesTaxStreetRanges.parity, ["B", house.number % 2 ? "O" : "E"]),
    ),
  ];
}

/** The keys a county's numbered road is filed under when named for the
 *  county, for the counties a ZIP's ranges reach. */
async function countyRoadKeys(state: string, road: string, zip5: string, date: string) {
  const areaIds = await zipAreas(state, zip5, date);
  if (!areaIds.length) return [];
  const counties = await db
    .selectDistinct({ name: salesTaxShapes.name })
    .from(salesTaxShapes)
    .innerJoin(
      salesTaxAreas,
      and(eq(salesTaxAreas.state, salesTaxShapes.state), eq(salesTaxAreas.county, salesTaxShapes.fips)),
    )
    .where(and(eq(salesTaxShapes.state, state), eq(salesTaxShapes.kind, "county"), inArray(salesTaxAreas.id, areaIds)));
  return counties
    .map((c) => parseStreet(`1 ${c.name} ${road}`)?.streetKey)
    .filter((k): k is string => Boolean(k) && !/^CR\d/.test(k!));
}

/** The street types the files use for a street name in a ZIP (or, with no
 *  ZIP on file, a city). */
export async function suffixesOf(
  state: string,
  key: string,
  zip5: string | null,
  city: string,
  date: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ suffix: salesTaxStreetRanges.suffix, city: salesTaxStreetRanges.city })
    .from(salesTaxStreetRanges)
    .where(
      and(
        eq(salesTaxStreetRanges.state, state),
        eq(salesTaxStreetRanges.streetKey, key),
        zip5 ? eq(salesTaxStreetRanges.zip5, zip5) : undefined,
        lte(salesTaxStreetRanges.startsOn, date),
        gte(salesTaxStreetRanges.endsOn, date),
      ),
    );
  return [
    ...new Set(
      rows
        .filter((r) => zip5 || normalizeCity(r.city) === city)
        .map((r) => r.suffix)
        .filter(Boolean),
    ),
  ];
}

/** Narrows a street's ranges step by step, each step keeping the rows that
 *  fit best and never emptying the set on a detail the address leaves out. */
export function bestRows(
  rows: StreetRow[],
  street: StreetParts,
  zip5: string | null,
  city: string,
  zipCities: string[],
  fileSuffixes: string[],
): StreetRow[] {
  // The place must agree: the same ZIP, or failing that the same city (a
  // typed ZIP is sometimes a neighbour's).
  let kept = zip5 ? rows.filter((r) => r.zip5 === zip5) : [];
  if (!kept.length) kept = rows.filter((r) => normalizeCity(r.city) === city);
  // The same number filed under the typed city in another ZIP counts too,
  // when the typed city is one of the ZIP's but the ZIP's own rows name
  // another: a file that gives the two different rates can't say which the
  // address is, so it is refused. A city the ZIP never names (a neighbour's
  // or a mailing name) leaves the ZIP's rows to speak.
  else if (zipCities.includes(city) && !kept.some((r) => normalizeCity(r.city) === city))
    kept = [...kept, ...rows.filter((r) => r.zip5 !== zip5 && normalizeCity(r.city) === city)];

  // A type or direction both sides state must match; one side's silence
  // is allowed, but an exact match beats it. Directions compare as sets, so
  // a direction only one side states ("E Jackson Ave" filed as "E Jackson
  // Ave N") is silence, not a clash.
  const directions = (pre: string, post: string) =>
    [pre, post].filter(Boolean).sort().join(" ");
  const wanted = directions(street.preDirectional, street.postDirectional);
  const within = (a: string, b: string) =>
    a.split(" ").filter(Boolean).every((d) => b.split(" ").includes(d));
  // A typed type the file never uses for this name in the place ("Martinson
  // Ave" where the file has only "Martinson St", at any number) is taken as
  // a mistyped type of that one street; with two or more types on file for
  // the name it must match.
  const typedSuffix =
    street.suffix && fileSuffixes.length === 1 && fileSuffixes[0] !== street.suffix
      ? ""
      : street.suffix;
  kept = kept.filter((r) => {
    const filed = directions(r.preDirectional, r.postDirectional);
    return (
      (!typedSuffix || !r.suffix || r.suffix === typedSuffix) &&
      (within(wanted, filed) || within(filed, wanted))
    );
  });
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

