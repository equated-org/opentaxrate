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
import { parseStreet, type StreetParts } from "../../address.js";
import { normalizeCity } from "../places.js";
import { betweenAreas } from "./between.js";
import { correctedStreet } from "./correct.js";
import { exactAreas } from "./exact.js";

export interface StreetQuery {
  state: string;
  /** The street line as typed. */
  street: string;
  city: string;
  zip5: string | null;
  date: string;
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

  const corrected = await correctedStreet(q.state, q.street, parsed, q.zip5, q.date);
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
