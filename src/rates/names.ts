/**
 * Names each part of a rate for display and for a return's lines: the state
 * by its name, a county, city or district by the outline loaded for its code
 * (Census TIGER for counties and cities, a state's own layer for its
 * districts). A part an engine already named keeps its name; one no loaded
 * outline names stays null, as most Streamlined districts do.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { salesTaxShapes } from "../db/schema.js";
import { STATES } from "../geocoding/providers/match.js";
import type { RatePart } from "./types.js";

/** The outline kinds a part's code may name, most specific first. */
const SHAPE_KINDS: Record<Exclude<RatePart["kind"], "state">, Array<"county" | "place" | "cousub" | "district">> = {
  county: ["county"],
  city: ["place", "cousub"],
  district: ["district", "place", "cousub"],
};

export async function nameParts(state: string, parts: RatePart[]): Promise<RatePart[]> {
  const codeOf = (p: RatePart) => p.code.split(":").pop()!;
  const unnamed = parts.filter((p) => p.kind !== "state" && p.name == null);
  const shapes = unnamed.length
    ? await db
        .select({ kind: salesTaxShapes.kind, fips: salesTaxShapes.fips, name: salesTaxShapes.name })
        .from(salesTaxShapes)
        .where(and(eq(salesTaxShapes.state, state), inArray(salesTaxShapes.fips, [...new Set(unnamed.map(codeOf))])))
    : [];
  const named = new Map(shapes.map((s) => [`${s.kind}:${s.fips}`, s.name.trim()]));
  const nameOf = (p: RatePart): string | null => {
    if (p.name != null) return p.name;
    if (p.kind === "state") return STATES[state] ?? state;
    const name = SHAPE_KINDS[p.kind].map((k) => named.get(`${k}:${codeOf(p)}`)).find(Boolean) ?? null;
    return name && p.kind === "county" && !/county|parish|borough/i.test(name) ? `${name} County` : name;
  };
  // The name second, after the kind, where a reader looks for it.
  return parts.map((p) => {
    const { kind, name: _, ...rest } = p;
    return { kind, name: nameOf(p), ...rest };
  });
}
