/**
 * A house a file leaves out, placed by its neighbours. Missouri's file lists
 * many streets address by address ("213", "312"), so a house between two
 * listed ones has no range. When the nearest listed houses below and above
 * it, on the same street, side and ZIP, all fall in one area, a line between
 * them would have to cross the street twice, so the house is taken to be in
 * that area too. Neighbours far apart, or in different areas, place nothing.
 */
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "../../db/client.js";
import { salesTaxStreetRanges } from "../../db/schema.js";
import { streetVariantsOf, type StreetParts } from "../../address.js";
import { citiesInZip } from "../places.js";
import { bestRows, suffixesOf } from "./exact.js";

/** The widest gap between neighbours that still places a house: about two
 *  blocks of house numbers. */
const MAX_GAP = 200;

export async function betweenAreas(
  state: string,
  street: StreetParts,
  zip5: string,
  city: string,
  date: string,
): Promise<{ areaIds: number[]; below: number; above: number } | null> {
  const house = street.house;
  if (house === null) return null;
  const side = house % 2 ? "O" : "E";
  const zipCities = await citiesInZip(state, zip5, date);
  for (const variant of streetVariantsOf(street)) {
    const rows = await db
      .select()
      .from(salesTaxStreetRanges)
      .where(
        and(
          eq(salesTaxStreetRanges.state, state),
          eq(salesTaxStreetRanges.streetKey, variant.streetKey),
          eq(salesTaxStreetRanges.zip5, zip5),
          isNull(salesTaxStreetRanges.houseText),
          lte(salesTaxStreetRanges.startsOn, date),
          gte(salesTaxStreetRanges.endsOn, date),
        ),
      );
    if (!rows.length) continue;
    const suffixes = variant.suffix ? await suffixesOf(state, variant.streetKey, zip5, city, date) : [];
    const onSide = bestRows(rows, variant, zip5, city, zipCities, suffixes).filter(
      (r) => r.parity === "B" || r.parity === side,
    );
    const below = onSide.filter((r) => r.houseHigh! < house);
    const above = onSide.filter((r) => r.houseLow! > house);
    if (!below.length || !above.length) return null;
    const low = Math.max(...below.map((r) => r.houseHigh!));
    const high = Math.min(...above.map((r) => r.houseLow!));
    if (high - low > MAX_GAP) return null;
    const areas = new Set(
      [...below.filter((r) => r.houseHigh === low), ...above.filter((r) => r.houseLow === high)].map((r) => r.areaId),
    );
    return areas.size === 1 ? { areaIds: [...areas], below: low, above: high } : null;
  }
  return null;
}
