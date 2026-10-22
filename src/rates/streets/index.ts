/**
 * A typed street line, found in a Streamlined state's address ranges. One
 * call, findStreet, tries each way in turn and stops at the first that finds
 * the address:
 *   1. exact: the street's own ranges, by its key and the other spellings a
 *      file may use (exact.ts);
 *   2. between: in a file that lists addresses one by one, the nearest
 *      listed houses on either side, when they share one area (between.ts);
 *   3. corrected: a street the file doesn't know by the typed name, read as
 *      the ZIP's street it is (by spelling, or by Jev when configured), then
 *      found by 1 or 2 (correct.ts).
 * Every answer is still checked by the range engine against the ZIP+4 and
 * the map; this only finds which ranges the address is on.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "../../db/client.js";
import { salesTaxStreetRanges } from "../../db/schema.js";
import { parseStreet, type StreetParts } from "../../address.js";
import { normalizeCity } from "../places.js";
import { betweenAreas } from "./between.js";
import { correctedStreet } from "./correct.js";
import { exactAreas } from "./exact.js";
import type { StreetPicker } from "./jev.js";

export interface StreetQuery {
  state: string;
  /** The street line as typed. */
  street: string;
  city: string;
  zip5: string | null;
  date: string;
  /** Picks the street a misspelled one is when spelling can't: Jev by
   *  default, null for spelling only. */
  pickStreet?: StreetPicker | null;
}

export interface StreetFound {
  areaIds: number[];
  how: "exact" | "between" | "corrected";
  /** How the address was found, when not by its own ranges, for the
   *  answer's source. */
  note?: string;
}

export async function findStreet(q: StreetQuery): Promise<StreetFound | null> {
  const parsed = parseStreet(q.street);
  if (!parsed) return null;
  const city = normalizeCity(q.city);
  const own = await onStreet(q, parsed, city);
  if (own) return own;
  if (!q.zip5) return null;

  const corrected = await correctedStreet(q.state, q.street, parsed, q.zip5, q.date, q.pickStreet);
  if (!corrected) return null;
  const filed = parseStreet(`1 ${corrected.street}`);
  if (!filed) return null;
  const parts: StreetParts = {
    ...parsed,
    preDirectional: filed.preDirectional,
    streetKey: filed.streetKey,
    suffix: filed.suffix,
    postDirectional: filed.postDirectional,
    alternates: [],
  };
  const found = await onStreet(q, parts, city);
  if (!found) return null;
  const why = corrected.by === "jev" ? `Jev, confidence ${corrected.confidence.toFixed(2)}` : "closest spelling in the ZIP";
  return {
    areaIds: found.areaIds,
    how: "corrected",
    note: [`street read as ${corrected.street} (${why})`, found.note].filter(Boolean).join("; "),
  };
}

/** Whether the ZIP's ranges list the typed street at all, by any of its
 *  spellings or as the street a correction reads it as. A street they list
 *  without the house is not an unlisted one. */
export async function listedInZip(q: StreetQuery & { zip5: string }): Promise<boolean> {
  const parsed = parseStreet(q.street);
  if (!parsed) return true;
  const r = salesTaxStreetRanges;
  const keys = [parsed.streetKey, ...(parsed.alternates ?? []).map((a) => a.streetKey)];
  const [row] = await db
    .select({ key: r.streetKey })
    .from(r)
    .where(and(eq(r.state, q.state), eq(r.zip5, q.zip5), inArray(r.streetKey, keys), lte(r.startsOn, q.date), gte(r.endsOn, q.date)))
    .limit(1);
  return !!row || (await correctedStreet(q.state, q.street, parsed, q.zip5, q.date, q.pickStreet)) !== null;
}

async function onStreet(q: StreetQuery, street: StreetParts, city: string): Promise<StreetFound | null> {
  const exact = await exactAreas(q.state, street, q.zip5, city, q.date);
  if (exact.length) return { areaIds: exact, how: "exact" };
  const between = q.zip5 ? await betweenAreas(q.state, street, q.zip5, city, q.date) : null;
  if (between)
    return {
      areaIds: between.areaIds,
      how: "between",
      note: `between listed houses ${between.below} and ${between.above}`,
    };
  return null;
}
