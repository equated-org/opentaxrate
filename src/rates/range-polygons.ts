/** A range state's tax-specific polygons narrow its ZIP candidates. Unknown
 * district geometry remains unknown; rates always come from dated files. */
import { and, eq, gte, inArray, like, lte } from "drizzle-orm";
import { PARAMS } from "../params.js";
import { db } from "../db/client.js";
import { salesTaxAreas, salesTaxJurisdictionRates, salesTaxJurisdictions, salesTaxShapes } from "../db/schema.js";
import { RANGE_POLYGON_SOURCES, rangePolygonPrefix, type RangePolygonState } from "../range-polygon-sources.js";
import { marginOf, type LocatedPoint } from "../geocoding/types.js";
import { traceOutline, type Trace } from "./types.js";
import { WHOLE_CODE_TYPE } from "../coverage.js";
import { isHeld, outlinesAt, padAround, type NearbyOutline } from "./shapes.js";

type Area = typeof salesTaxAreas.$inferSelect;

/** A known non-containing requirement excludes a candidate. An unindexed
 * requirement cannot exclude it, even if the layer has no shapes nearby. */
export function missouriPolygonCandidates(
  areas: Area[], ids: Map<string, Record<string, string>>, known: Set<string>, inside: Set<string>,
): number[] | null {
  const prefix = rangePolygonPrefix("MO");
  const activeDistricts = [...inside].filter((k) => !k.startsWith(`${prefix}COU:`) && !k.startsWith(`${prefix}MUN:`));
  const towns = [...inside].filter((k) => k.startsWith(`${prefix}MUN:`));
  const workbookDistricts = new Set([...ids.values()].flatMap((j) => Object.entries(j)
    .filter(([k, v]) => /^District Code \d$/.test(k) && v.trim()).map(([, v]) => `${prefix}${v.slice(0, 3)}:${v}`)));
  const relevant = activeDistricts.filter((key) => workbookDistricts.has(key));
  const candidates: number[] = [];
  for (const a of areas) {
    const code = a.districts.split(" ").find((d) => d.startsWith(`${WHOLE_CODE_TYPE}:`))?.slice(WHOLE_CODE_TYPE.length + 1);
    const columns = code ? ids.get(code) : undefined;
    if (!code || !columns || columns["Jurisdiction Code"] !== code) return null;
    const [place, county] = code.split("-");
    const districts = Object.entries(columns).filter(([k]) => /^District Code \d$/.test(k)).map(([, v]) => v.trim()).filter(Boolean);
    const requirements = [`${prefix}COU:${county}`, ...(place !== "00000" ? [`${prefix}MUN:${place}`] : []),
      ...districts.map((d) => `${prefix}${d.slice(0, 3)}:${d}`)];
    if (requirements.some((k) => known.has(k) && !inside.has(k))) continue;
    if (place === "00000" && towns.length) continue;
    // A polygon for another special district is a contradiction only when
    // that id occurs in a candidate's current workbook. TIF, for example,
    // need not be an additional sales tax.
    if (relevant.some((key) => !requirements.includes(key))) continue;
    if (requirements.some((key) => !known.has(key))) return null;
    candidates.push(a.id);
  }
  return candidates.length ? candidates : null;
}

export async function rangePolygonAreas(
  state: string, areaIds: number[], point: LocatedPoint, date: string, trace?: Trace,
): Promise<{ areas: number[] | "near_edge" | "unresolved"; file: string; held?: boolean } | null> {
  if (!areaIds.length) return null;
  const indexed = await indexedTaxAreas(state, areaIds, point, date, trace);
  if (indexed?.status === "verified") return { areas: indexed.areas, file: indexed.file };
  if (indexed?.status === "near_edge") return { areas: "near_edge", file: indexed.file, held: indexed.held };
  if (indexed) return { areas: "unresolved", file: indexed.file, held: true };
  if (!(state in RANGE_POLYGON_SOURCES)) return null;
  const source = RANGE_POLYGON_SOURCES[state as RangePolygonState];
  // A boundary snapshot must not be projected backward onto earlier sales.
  if (date < source.from) return null;
  const prefix = rangePolygonPrefix(state);
  const legacy = await db.select({ fips: salesTaxShapes.fips, file: salesTaxShapes.file }).from(salesTaxShapes)
    .where(and(eq(salesTaxShapes.state, state), like(salesTaxShapes.fips, `${prefix}%`)));
  if (!legacy.length || legacy.some((s) => s.file !== source.file)) return null;
  const known = new Set(legacy.map((s) => s.fips));
  const margin = marginOf(point);
  const rows = await outlinesAt(state, point, date, "zones", padAround(point));
  if (!rows.some((s) => s.inside)) return null;
  const areas = await db.select().from(salesTaxAreas).where(and(eq(salesTaxAreas.state, state), inArray(salesTaxAreas.id, areaIds)));
  let selected: number[] | null;
  if (state === "MO") {
    const jurisdictions = await db.select({ code: salesTaxJurisdictions.code, ids: salesTaxJurisdictions.ids })
      .from(salesTaxJurisdictions).where(and(eq(salesTaxJurisdictions.state, state), eq(salesTaxJurisdictions.type, WHOLE_CODE_TYPE)));
    selected = missouriPolygonCandidates(areas, new Map(jurisdictions.map((j) => [j.code, j.ids])), known,
      new Set(rows.filter((s) => s.inside).map((s) => s.fips)));
  } else {
    const zones = rows.filter((s) => s.inside);
    if (zones.length !== 1) return null;
    const [county, place] = zones[0].fips.slice(prefix.length).split(":");
    // Utah's 99xxx zones are unincorporated county areas. Other pseudo-FIPS
    // are retained verbatim; no name-based guesses about special districts.
    const town = place.startsWith("99") ? null : place;
    selected = areas.filter((a) => a.county === county && a.place === town && !a.districts).map((a) => a.id);
    // A town that levies nothing of its own has no row in the rate file,
    // so its addresses are filed with the county's, without a town.
    if (!selected.length && town && PARAMS.zoneBeyondZip && !(await mayLevy(state, town, date)))
      selected = areas.filter((a) => a.county === county && a.place === null && !a.districts).map((a) => a.id);
  }
  if (!selected?.length) return null;
  if (trace) for (const s of rows) traceOutline(trace, s).levies = s.inside;
  return { areas: rows.some((s) => s.edgeMetres < margin) ? "near_edge" : selected, file: source.file };
}

/** Whether the town may have a rate of its own on the date: a row in the
 *  state's rate file for it, or for a code beside it (Utah codes the part of
 *  a town in another county next to the town's: Park City East 58071 beside
 *  Park City 58070), or a special zone's code (97xxx), whose taxes the file
 *  keeps under neighbouring codes. Only a town that plainly levies nothing
 *  is read as the county without a town. */
async function mayLevy(state: string, town: string, date: string) {
  if (town.startsWith("97")) return true;
  const rows = await db.select({ code: salesTaxJurisdictionRates.code }).from(salesTaxJurisdictionRates)
    .where(and(eq(salesTaxJurisdictionRates.state, state), like(salesTaxJurisdictionRates.code, `${town.slice(0, 4)}%`),
      lte(salesTaxJurisdictionRates.startsOn, date), gte(salesTaxJurisdictionRates.endsOn, date)));
  return rows.some((r) => /^\d{5}$/.test(r.code));
}

/** Verification builds a tax area the boundary files don't list (its
 *  complete components dated in the state's rate file) under ids from
 *  state FIPS × 1,000,000 + 900,001; the loader's own count from + 1. No
 *  ZIP's ranges name such an area, so a ZIP's candidates can't exclude it. */
export const BUILT_AREA_BASE = 900_000;
export const isBuiltArea = (id: number) => id % 1_000_000 > BUILT_AREA_BASE;

/** What the indexed supplemental outlines say at a point:
 *   - verified: the complete tax areas holding it (none when they and the
 *     ZIP's candidates disagree);
 *   - near_edge: its margin reaches an outline's edge; `held` when that
 *     outline is coverage ingestion couldn't verify;
 *   - unresolved: it is inside such coverage, which outranks any verified
 *     outline there. A smaller total from other data is never the answer.
 *  Null where no indexed coverage applies, for the ordinary paths. */
export type IndexedAreas =
  | { status: "verified"; areas: number[]; file: string }
  | { status: "near_edge"; held: boolean; file: string }
  | { status: "unresolved"; file: string };

/** Complete, verified tax areas and unverified coverage use the existing
 * shapes/area tables. No source snapshots, feature attributes or mapping
 * blobs are read at lookup. */
export async function indexedTaxAreas(
  state: string, candidates: number[], point: LocatedPoint, date: string, trace?: Trace,
): Promise<IndexedAreas | null> {
  const margin = marginOf(point);
  const rows = await outlinesAt(state, point, date, "indexed", padAround(point));
  const result = indexedOutcome(rows, candidates, margin);
  if (trace) for (const r of rows)
    traceOutline(trace, r).levies = result?.status === "verified" && r.inside && r.areaId !== null && result.areas.includes(r.areaId);
  return result;
}

type IndexedRow = Pick<NearbyOutline, "fips" | "areaId" | "file" | "inside" | "edgeMetres">;

/** indexedTaxAreas' decision from the outlines near the point. */
export function indexedOutcome(rows: IndexedRow[], candidates: number[], margin: number): IndexedAreas | null {
  const held = rows.filter(r => isHeld(r.fips)), verified = rows.filter(r => r.areaId !== null);
  const file = (of: IndexedRow[]) => [...new Set(of.map(r => r.file))].join(" + ");
  if (held.some(r => r.inside && r.edgeMetres > margin)) return { status: "unresolved", file: file(held) };
  if (held.some(r => r.edgeMetres <= margin)) return { status: "near_edge", held: true, file: file(held) };
  const inside = verified.filter(r => r.inside);
  if (!inside.length) return null;
  if (verified.some(r => r.edgeMetres <= margin)) return { status: "near_edge", held: false, file: file(inside) };
  return { status: "verified", file: file(inside), areas: [...new Set(inside.map(r => r.areaId!))]
    .filter(id => candidates.includes(id) || isBuiltArea(id)) };
}
