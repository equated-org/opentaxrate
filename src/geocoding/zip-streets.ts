/**
 * The streets in a ZIP, by street key: the Streamlined and Missouri range
 * files' streets, and TIGER's for the map-read states (ingest/street-names.ts).
 * Null when none are loaded, which leaves the matcher exact.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { salesTaxStreetRanges, zipStreetNames } from "../db/schema.js";
import type { AddressToLocate } from "./types.js";

export async function streetsInZip(a: AddressToLocate): Promise<ReadonlySet<string> | null> {
  const zip5 = /^\d{5}/.exec(a.zip ?? "")?.[0];
  if (!zip5) return null;
  const state = a.state.toUpperCase();
  const [ranges, names] = await Promise.all([
    db.selectDistinct({ key: salesTaxStreetRanges.streetKey }).from(salesTaxStreetRanges)
      .where(and(eq(salesTaxStreetRanges.state, state), eq(salesTaxStreetRanges.zip5, zip5), sql`${salesTaxStreetRanges.endsOn} >= current_date`)),
    db.select({ key: zipStreetNames.streetKey }).from(zipStreetNames)
      .where(and(eq(zipStreetNames.state, state), eq(zipStreetNames.zip5, zip5))),
  ]);
  const keys = new Set([...ranges, ...names].map((r) => r.key));
  return keys.size ? keys : null;
}

/** Every direction each street in a ZIP is written with, as "pre|post"
 *  ("N|", "|SE", "|" for none), from the range files' rows and TIGER's
 *  names. A street some source lists without its directions is left out,
 *  as its directions aren't known. Null when none are loaded. */
export async function streetDirectionsInZip(a: AddressToLocate): Promise<ReadonlyMap<string, ReadonlySet<string>> | null> {
  const zip5 = /^\d{5}/.exec(a.zip ?? "")?.[0];
  if (!zip5) return null;
  const state = a.state.toUpperCase();
  const [ranges, names] = await Promise.all([
    db.selectDistinct({ key: salesTaxStreetRanges.streetKey, pre: salesTaxStreetRanges.preDirectional, post: salesTaxStreetRanges.postDirectional })
      .from(salesTaxStreetRanges)
      .where(and(eq(salesTaxStreetRanges.state, state), eq(salesTaxStreetRanges.zip5, zip5), sql`${salesTaxStreetRanges.endsOn} >= current_date`)),
    db.select({ key: zipStreetNames.streetKey, directions: zipStreetNames.directions }).from(zipStreetNames)
      .where(and(eq(zipStreetNames.state, state), eq(zipStreetNames.zip5, zip5))),
  ]);
  const out = new Map<string, Set<string>>();
  const unknown = new Set<string>();
  for (const r of ranges) {
    const set = out.get(r.key) ?? new Set<string>();
    set.add(`${r.pre}|${r.post}`);
    out.set(r.key, set);
  }
  for (const r of names) {
    if (!r.directions.length) { unknown.add(r.key); continue; }
    const set = out.get(r.key) ?? new Set<string>();
    for (const d of r.directions) set.add(d);
    out.set(r.key, set);
  }
  for (const key of unknown) out.delete(key);
  return out.size ? out : null;
}
