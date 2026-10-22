/**
 * Names each part of a rate and gives its ids, as the state's own data
 * describes it (sales_tax_jurisdictions, keyed by the part's "type:code"):
 * the publisher's name and every identifying column it publishes, keyed by
 * its own column names and unchanged (Alabama's Locality Code, a Texas TAID).
 * A part with no row there takes the name an engine gave it, else the
 * outline loaded for its code (Census TIGER for counties and cities, a
 * state's own layer for its districts), and ids {}. The state is named by
 * its name; most Streamlined districts stay unnamed.
 */
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { salesTaxJurisdictions, salesTaxShapes } from "../db/schema.js";
import { STATES } from "../geocoding/providers/match.js";
import type { RatePart } from "./types.js";

/** The outline kinds a part's code may name, most specific first. */
const SHAPE_KINDS: Record<Exclude<RatePart["kind"], "state">, Array<"county" | "place" | "cousub" | "district">> = {
  county: ["county"],
  city: ["place", "cousub"],
  district: ["district", "place", "cousub"],
};

/** A part code's type and code, split at the first colon:
 *  "kx:2227016>3227999" is type kx, code 2227016>3227999. */
const keyOf = (p: RatePart) => {
  const at = p.code.indexOf(":");
  return at < 0 ? null : { type: p.code.slice(0, at), code: p.code.slice(at + 1) };
};

export async function describeParts(state: string, parts: RatePart[]): Promise<RatePart[]> {
  const keys = parts.flatMap((p) => keyOf(p) ?? []);
  const rows = keys.length
    ? await db
        .select({ type: salesTaxJurisdictions.type, code: salesTaxJurisdictions.code, name: salesTaxJurisdictions.name, ids: salesTaxJurisdictions.ids })
        .from(salesTaxJurisdictions)
        .where(
          and(
            eq(salesTaxJurisdictions.state, state),
            or(...keys.map((k) => and(eq(salesTaxJurisdictions.type, k.type), eq(salesTaxJurisdictions.code, k.code)))),
          ),
        )
    : [];
  const described = new Map(rows.map((r) => [`${r.type}:${r.code}`, r]));

  const codeOf = (p: RatePart) => p.code.split(":").pop()!;
  const unnamed = parts.filter((p) => p.kind !== "state" && p.name == null && !described.get(p.code)?.name);
  const shapes = unnamed.length
    ? await db
        .select({ kind: salesTaxShapes.kind, fips: salesTaxShapes.fips, name: salesTaxShapes.name })
        .from(salesTaxShapes)
        .where(and(eq(salesTaxShapes.state, state), inArray(salesTaxShapes.fips, [...new Set(unnamed.map(codeOf))])))
    : [];
  const outlined = new Map(shapes.map((s) => [`${s.kind}:${s.fips}`, s.name.trim()]));
  const nameOf = (p: RatePart): string | null => {
    const own = described.get(p.code)?.name;
    if (own) return own;
    if (p.name != null) return p.name;
    if (p.kind === "state") return STATES[state] ?? state;
    const name = SHAPE_KINDS[p.kind].map((k) => outlined.get(`${k}:${codeOf(p)}`)).find(Boolean) ?? null;
    return name && p.kind === "county" && !/county|parish|borough/i.test(name) ? `${name} County` : name;
  };
  // The name second, after the kind, where a reader looks for it.
  return parts.map((p) => {
    const { kind, name: _, ids: __, ...rest } = p;
    return { kind, name: nameOf(p), ...rest, ids: described.get(p.code)?.ids ?? {} };
  });
}
