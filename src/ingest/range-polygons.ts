/** Extra tax outlines for range states. Rates still come from their dated
 * workbooks/SST files; the layers' undated rate attributes are never loaded. */
import { and, eq, like } from "drizzle-orm";
import { db } from "../db/client.js";
import { salesTaxShapes } from "../db/schema.js";
import { geometryOf } from "./geometry.js";
import { fetchFile, ringsOf } from "./states/sources.js";
import type { Shape } from "./tiger.js";

import { RANGE_POLYGON_SOURCES, rangePolygonPrefix, type RangePolygonState } from "../range-polygon-sources.js";

export interface RangePolygon {
  kind: "county" | "place" | "district";
  fips: string;
  name: string;
  rings: Shape["rings"];
}

interface Feature {
  properties: Record<string, unknown>;
  geometry: { type: string; coordinates: unknown } | null;
}

export function readRangePolygons(state: RangePolygonState, features: Feature[]): RangePolygon[] {
  const merged = new Map<string, RangePolygon>();
  const prefix = rangePolygonPrefix(state);
  for (const f of features) {
    const a = f.properties;
    let key: string;
    let name: string;
    let kind: RangePolygon["kind"];
    if (state === "MO") {
      const type = String(a.JURISDICTION_TYPE ?? "");
      const code = String(a.JURISDICTION_ID ?? "").trim();
      if (type === "STAT") continue;
      if (!type || !code) throw new Error("MO polygon missing its jurisdiction type/id");
      key = `${type}:${code}`;
      kind = type === "COU" ? "county" : type === "MUN" ? "place" : "district";
      name = String(a.JURISDICTION_NAME ?? code);
    } else {
      const county = String(a.FIPSCONUM ?? "").trim();
      const place = String(a.FIPS ?? "").trim();
      const zone = String(a.TAXDIST ?? "").trim();
      if (!/^\d{3}$/.test(county) || !/^\d{5}$/.test(place) || !/^\d{5}$/.test(zone))
        throw new Error("UT polygon missing its county/place/tax-area code");
      key = `${county}:${place}:${zone}`;
      kind = "district";
      name = `${String(a.SHORTDESC ?? place)} tax area ${zone}`;
    }
    const rings = ringsOf(f.geometry);
    if (!rings.length || rings.some((r) => r.length < 4 || r.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))))
      throw new Error(`${state} polygon ${key} has no usable geometry`);
    const fips = `${prefix}${key}`;
    const prior = merged.get(fips);
    if (prior) prior.rings.push(...rings);
    else merged.set(fips, { kind, fips, name, rings });
  }
  return [...merged.values()];
}

/** Enumerate ids first, then fetch explicit batches, verifying none went
 * missing. A truncated ArcGIS response must never imply no district exists. */
export async function fetchRangePolygons(state: RangePolygonState, dir?: string): Promise<RangePolygon[]> {
  const layer = RANGE_POLYGON_SOURCES[state].layer;
  const query = (params: Record<string, string>) => `${layer}/query?${new URLSearchParams(params)}`;
  const read = async (url: string, name: string) => JSON.parse(new TextDecoder().decode(await fetchFile(url, dir, name)));
  const idsBody = await read(query({ where: "1=1", returnIdsOnly: "true", f: "json" }), `${state.toLowerCase()}-tax-polygon-ids.json`);
  if (idsBody.error || !Array.isArray(idsBody.objectIds) || !idsBody.objectIds.length)
    throw new Error(`${state}: no complete polygon id list: ${idsBody.error?.message ?? "empty response"}`);
  const ids: number[] = [...new Set<number>(idsBody.objectIds)].sort((a, b) => a - b);
  const features: Feature[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const body = await read(query({ objectIds: batch.join(","), outFields: "*", outSR: "4326", f: "geojson", geometryPrecision: "6" }),
      `${state.toLowerCase()}-tax-polygons-${i}.geojson`);
    if (body.error || !Array.isArray(body.features) || body.features.length !== batch.length)
      throw new Error(`${state}: incomplete polygon batch ${i}: ${body.error?.message ?? "missing features"}`);
    const got = new Set(body.features.map((f: Feature) => Number(f.properties[idsBody.objectIdFieldName])));
    if (got.size !== batch.length || batch.some((id) => !got.has(id)))
      throw new Error(`${state}: polygon batch ${i} returned the wrong ids`);
    features.push(...body.features);
  }
  return readRangePolygons(state, features);
}

/** Only this source's outlines are replaced. Range rates, TIGER and other
 * states stay intact, and a failed load rolls back to the previous snapshot. */
export async function loadRangePolygons(state: RangePolygonState, polygons: RangePolygon[]) {
  if (!polygons.length) throw new Error(`${state}: refusing an empty polygon load`);
  await db.transaction(async (tx) => {
    await tx.delete(salesTaxShapes).where(and(eq(salesTaxShapes.state, state), like(salesTaxShapes.fips, `${rangePolygonPrefix(state)}%`)));
    for (let i = 0; i < polygons.length; i += 20)
      await tx.insert(salesTaxShapes).values(polygons.slice(i, i + 20).map((p) => ({
        state, kind: p.kind, fips: p.fips, name: p.name, geom: geometryOf(p.rings), file: RANGE_POLYGON_SOURCES[state].file,
      })));
  });
  return polygons.length;
}
