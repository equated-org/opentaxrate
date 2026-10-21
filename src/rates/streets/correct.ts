/**
 * A street the file doesn't know by its typed name ("Coffee Rd", "N Hihg
 * St"), read as one of the streets the file has in that ZIP:
 *   1. by spelling: the street whose name shares the most three-letter runs
 *      with the typed one, when it stands clearly above the next;
 *   2. otherwise, when TYPESAFE_API_KEY is set, by Jev choosing among the
 *      ZIP's streets (or none) from the whole typed line, at a confidence of
 *      at least MIN_CONFIDENCE.
 * A pick is only a reading of the name: the caller must still find the
 * house number on that street before any rate comes of it.
 */
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../../db/client.js";
import { salesTaxStreetRanges } from "../../db/schema.js";
import { parseStreet, type StreetParts } from "../../address.js";
import { jevChoice } from "./jev.js";

/** How alike two names must be, and how far ahead of the next, for the
 *  spelling alone to pick a street. */
const MIN_SIMILARITY = 0.45;
const MIN_LEAD = 0.08;
const MIN_CONFIDENCE = 0.5;
/** A ZIP with more streets than this is too long a list to put to Jev. */
const MAX_CHOICES = 1500;

export interface Correction {
  street: string;
  by: "spelling" | "jev";
  confidence: number;
}

export async function correctedStreet(
  state: string,
  line: string,
  typed: StreetParts,
  zip5: string,
  date: string,
): Promise<Correction | null> {
  const rows = await db
    .selectDistinct({ street: salesTaxStreetRanges.street })
    .from(salesTaxStreetRanges)
    .where(
      and(
        eq(salesTaxStreetRanges.state, state),
        eq(salesTaxStreetRanges.zip5, zip5),
        lte(salesTaxStreetRanges.startsOn, date),
        gte(salesTaxStreetRanges.endsOn, date),
      ),
    );
  const streets = rows.map((r) => r.street).filter(Boolean);
  if (!streets.length) return null;
  const typedName = nameOf(typed);
  // The typed street is in the file already; its house number isn't, and
  // no other street's name will change that.
  if (streets.some((s) => nameOf(parseStreet(`1 ${s}`)) === typedName)) return null;

  const scored = streets
    .map((street) => ({ street, score: similarity(typedName, nameOf(parseStreet(`1 ${street}`))) }))
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  if (best.score >= MIN_SIMILARITY && best.score - (next?.score ?? 0) >= MIN_LEAD)
    return { street: best.street, by: "spelling", confidence: best.score };

  if (streets.length > MAX_CHOICES) return null;
  const picked = await jevChoice(
    line,
    `The \`state\` is a typed US street address line in ZIP ${zip5}. Which of these streets, as the state's tax file spells them, is it on? Allow typos, missing or spelled-out types and directions, and nicknames. If it could be on more than one (for example no direction given where both E and W exist), or on none, choose NONE.`,
    streets,
    "Not one of these streets, or more than one could fit.",
  );
  if (!picked || picked.choice === "NONE" || picked.confidence < MIN_CONFIDENCE) return null;
  return { street: picked.choice, by: "jev", confidence: picked.confidence };
}

const nameOf = (p: StreetParts | null) =>
  p ? [p.preDirectional, p.streetKey, p.suffix, p.postDirectional].filter(Boolean).join(" ") : "";

/** Shared three-letter runs over all runs in either name (Jaccard). */
function similarity(a: string, b: string) {
  const runs = (s: string) => {
    const padded = `  ${s} `;
    const out = new Set<string>();
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
    return out;
  };
  const x = runs(a);
  const y = runs(b);
  let shared = 0;
  for (const r of x) if (y.has(r)) shared++;
  return shared / (x.size + y.size - shared);
}
