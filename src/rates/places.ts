/**
 * What the range files say about a ZIP and its places, shared by the range
 * engine and street matching: the areas a ZIP (or one ZIP+4) holds, the
 * cities its ranges name, and a city name as both sides compare it.
 */
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { salesTaxStreetRanges, salesTaxZipRanges } from "../db/schema.js";

/** The areas in a ZIP, or in one ZIP+4 of it: the ZIP+4 ranges covering it,
 *  or for a whole ZIP every ZIP and street range in it. */
export async function zipAreas(
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


/** The cities a ZIP's street ranges name, as normalizeCity writes them. */
export async function citiesInZip(state: string, zip5: string, date: string) {
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

/** A city name as typed or filed, so "Lake Saint Louis" and the file's "LAKE
 *  ST LOUIS" compare equal: case, punctuation and spacing dropped, and
 *  Saint, Mount and Fort abbreviated wherever they stand in the name. */
export function normalizeCity(city: string) {
  return city
    .toUpperCase()
    .replace(/[.,']/g, "")
    .replace(/\bSAINT\b/g, "ST")
    .replace(/\bMOUNT\b/g, "MT")
    .replace(/\bFORT\b/g, "FT")
    .replace(/\s+/g, " ")
    .trim();
}
