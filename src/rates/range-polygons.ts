/** A range state's tax-specific polygons narrow its ZIP candidates. Unknown
 * district geometry remains unknown; rates always come from dated files. */
import { and, eq, gte, inArray, like, lte, sql } from "drizzle-orm";
import { PARAMS } from "../params.js";
import { db } from "../db/client.js";
import { salesTaxAreas, salesTaxJurisdictionRates, salesTaxJurisdictions, salesTaxShapes } from "../db/schema.js";
import { RANGE_POLYGON_SOURCES, rangePolygonPrefix, type RangePolygonState } from "../range-polygon-sources.js";
import { marginOf, type LocatedPoint } from "../geocoding/types.js";
import { traceOutline, type Trace } from "./types.js";
import { WHOLE_CODE_TYPE } from "../coverage.js";
import type { PlacedShape } from "./shapes.js";

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
): Promise<{ areas: number[] | "near_edge"; file: string } | null> {
  if (!(state in RANGE_POLYGON_SOURCES) || !areaIds.length) return null;
  const source = RANGE_POLYGON_SOURCES[state as RangePolygonState];
  // A boundary snapshot must not be projected backward onto earlier sales.
  if (date < source.from) return null;
  const prefix = rangePolygonPrefix(state);
  const indexed = await db.select({ fips: salesTaxShapes.fips, file: salesTaxShapes.file }).from(salesTaxShapes)
    .where(and(eq(salesTaxShapes.state, state), like(salesTaxShapes.fips, `${prefix}%`)));
  if (!indexed.length || indexed.some((s) => s.file !== source.file)) return null;
  const known = new Set(indexed.map((s) => s.fips));
  const margin = marginOf(point);
  const pad = Math.max(0.003, margin / (110_000 * Math.max(0.1, Math.cos(point.lat * Math.PI / 180))));
  const rows = await db.execute<{
    kind: PlacedShape["kind"]; fips: string; name: string; inside: boolean; edge: number; lon: number; lat: number;
  }>(sql`
    with p as (select st_setsrid(st_point(${point.lon}, ${point.lat}), 4326) as g)
    select s.kind, s.fips, s.name, st_covers(s.geom, p.g) as inside,
      st_distance(st_boundary(s.geom)::geography, p.g::geography) as edge,
      st_x(st_closestpoint(st_boundary(s.geom), p.g)) as lon,
      st_y(st_closestpoint(st_boundary(s.geom), p.g)) as lat
    from sales_tax_shapes s cross join p
    where s.state = ${state} and s.fips like ${`${prefix}%`}
      and st_dwithin(s.geom, p.g, ${pad})`);
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
    if (!selected.length && town && PARAMS.zoneBeyondZip && !(await townLevies(state, town, date)))
      selected = areas.filter((a) => a.county === county && a.place === null && !a.districts).map((a) => a.id);
  }
  if (!selected?.length) return null;
  if (trace) for (const s of rows) {
    const outline = traceOutline(trace, { kind: s.kind, fips: s.fips, name: s.name, inside: s.inside,
      edgeMetres: Number(s.edge), foot: { lon: Number(s.lon), lat: Number(s.lat) } });
    outline.levies = s.inside;
  }
  return { areas: rows.some((s) => Number(s.edge) < margin) ? "near_edge" : selected, file: source.file };
}

/** Whether the state's rate file has a rate of the town's own on the date. */
async function townLevies(state: string, town: string, date: string) {
  const [row] = await db.select({ code: salesTaxJurisdictionRates.code }).from(salesTaxJurisdictionRates)
    .where(and(eq(salesTaxJurisdictionRates.state, state), eq(salesTaxJurisdictionRates.code, town),
      lte(salesTaxJurisdictionRates.startsOn, date), gte(salesTaxJurisdictionRates.endsOn, date))).limit(1);
  return Boolean(row);
}
