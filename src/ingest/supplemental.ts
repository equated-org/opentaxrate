/**
 * Downloads the supplemental polygon layers (supplemental-sources.ts, plus
 * Washington's dated boundary ZIPs found on its DOR page) and stores each as
 * an immutable snapshot: tax_source_snapshots for the layer, with
 * tax_source_features for every polygon and its attributes as published.
 * An unchanged layer is the same snapshot; a changed one is a new one, and
 * a failed download keeps the last. Nothing here reaches a lookup:
 * verify-polygons.ts decides what does.
 */
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { taxSourceFeatures, taxSourceSnapshots } from "../db/schema.js";
import { geometryOf } from "./geometry.js";
import { fetchFile, fetchText } from "./states/sources.js";
import { readDbf, readPolygons, type Shape } from "./tiger.js";
import { MN_SERVICES, SUPPLEMENTAL_POLYGONS, type PolygonSource } from "./supplemental-sources.js";
import { HISTORY_FROM } from "../coverage.js";

/** "2020Q1" for the quarter holding a day. */
const quarterOf = (day: string) => `${day.slice(0, 4)}Q${Math.ceil(Number(day.slice(5, 7)) / 3)}`;

export interface EvidenceFeature { id: string; attributes: Record<string, unknown>; rings: Shape["rings"]; }
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function sourceJson(url: string, dir: string | undefined, name: string): Promise<any> {
  const body = JSON.parse(await fetchText(url, dir, name));
  if (body?.error) throw new Error(`${url}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body;
}

/** Explicit object IDs prevent service paging limits from silently cutting
 * off districts. ESRI JSON works on layers that do not support GeoJSON. */
export async function fetchEvidenceLayer(source: PolygonSource, dir?: string) {
  const read = (suffix: string, params: Record<string, string>, name: string) =>
    sourceJson(`${source.url}${suffix}?${new URLSearchParams({ f: "json", ...params })}`, dir, `${source.id}-${name}.json`);
  const metadata = await read("", {}, "metadata");
  if (metadata.geometryType !== "esriGeometryPolygon") throw new Error(`${source.id}: expected a polygon layer`);
  let where = source.where ?? "1=1";
  if (source.latestDateField) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(source.latestDateField)) throw new Error("Invalid source date field");
    const stats = await read("/query", { where, returnGeometry: "false", outStatistics: JSON.stringify([
      { statisticType: "max", onStatisticField: source.latestDateField, outStatisticFieldName: "latest_date" },
    ]) }, "latest-date");
    const epoch = stats.features?.[0]?.attributes?.latest_date;
    if (typeof epoch !== "number" || !Number.isFinite(epoch)) throw new Error(`${source.id}: missing latest edition date`);
    const stamp = new Date(epoch).toISOString().slice(0, 19).replace("T", " ");
    where = `(${where}) AND ${source.latestDateField} = TIMESTAMP '${stamp}'`;
  }
  const body = await read("/query", { where, returnIdsOnly: "true" }, `ids-${digest(where).slice(0, 12)}`);
  if (!Array.isArray(body.objectIds) || !body.objectIds.length || !body.objectIdFieldName)
    throw new Error(`${source.id}: missing polygon IDs`);
  const ids = [...new Set<number>(body.objectIds)].sort((a, b) => a - b);
  if (ids.length !== body.objectIds.length || ids.some((id) => !Number.isSafeInteger(id)))
    throw new Error(`${source.id}: invalid polygon IDs`);
  const features: EvidenceFeature[] = [];
  const recordsWithoutGeometry: Array<{ id: string; attributes: Record<string, unknown> }> = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const page = await read("/query", { objectIds: batch.join(","), outFields: "*", outSR: "4326", returnGeometry: "true" }, `features-${offset}`);
    if (!Array.isArray(page.features) || page.features.length !== batch.length || page.exceededTransferLimit)
      throw new Error(`${source.id}: incomplete polygon batch ${offset}`);
    const got = new Set<number>();
    for (const f of page.features) {
      const id = Number(f.attributes?.[body.objectIdFieldName]);
      if (!batch.includes(id) || got.has(id)) throw new Error(`${source.id}: unexpected polygon ID ${id}`);
      got.add(id);
      if (source.allowMissingGeometry && !f.geometry) {
        recordsWithoutGeometry.push({ id: String(id), attributes: f.attributes });
        continue;
      }
      validateRings(f.geometry?.rings, source.id);
      features.push({ id: String(id), attributes: f.attributes, rings: f.geometry.rings });
    }
  }
  features.sort((a, b) => Number(a.id) - Number(b.id));
  return { features, metadata: { role: source.role, note: source.note, layer: metadata, where,
    sourceRecords: ids.length, recordsWithoutGeometry } };
}

export function validateRings(rings: unknown, source: string): asserts rings is Shape["rings"] {
  if (!Array.isArray(rings) || !rings.length || rings.some((r) => !Array.isArray(r) || r.length < 4 ||
    r.some((p: unknown) => !Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90)))
    throw new Error(`${source}: missing or invalid WGS84 polygon`);
}

export async function loadEvidence(source: Pick<PolygonSource, "id" | "state" | "url">,
  features: EvidenceFeature[], metadata: Record<string, unknown>) {
  if (!features.length || new Set(features.map((f) => f.id)).size !== features.length)
    throw new Error(`${source.id}: empty or duplicate evidence features`);
  for (const f of features) validateRings(f.rings, source.id);
  const sha256 = digest({ metadata, features });
  const id = `${source.id}:${sha256}`;
  await db.transaction(async (tx) => {
    // Concurrent refreshes serialize on the snapshot's unique identifier.
    const inserted = await tx.insert(taxSourceSnapshots).values({ id, source: source.id, state: source.state,
      url: source.url, sha256, metadata, rows: features.length }).onConflictDoNothing().returning({ id: taxSourceSnapshots.id });
    if (!inserted.length) {
      await tx.update(taxSourceSnapshots).set({ observedAt: new Date() }).where(eq(taxSourceSnapshots.id, id));
      return;
    }
    for (let i = 0; i < features.length; i += 20)
      await tx.insert(taxSourceFeatures).values(features.slice(i, i + 20).map((f) => ({
        snapshotId: id, featureId: f.id, attributes: f.attributes, geom: geometryOf(f.rings),
      })));
    const [bad] = await tx.execute<{ count: string }>(sql`select count(*) as count from tax_source_features
      where snapshot_id = ${id} and (geom is null or st_isempty(geom) or not st_isvalid(geom))`);
    if (Number(bad.count)) throw new Error(`${source.id}: repaired geometry is empty or invalid`);
  });
  return { id, rows: features.length };
}

const WA_PAGE = "https://dor.wa.gov/taxes-rates/sales-tax-jurisdiction-boundaries";
/** Use the *published dated* ZIPs, rather than a live map which can still
 * show the preceding quarter; no guessed publication URL. The tax-area
 * family (LOCCODE_PUBLIC) is kept for every quarter from HISTORY_FROM, each
 * indexed for its own quarter, oldest first so the newest is observed last;
 * the validation families only for their newest. */
export async function washingtonSources(dir?: string) {
  const page = await fetchText(WA_PAGE, dir, "wa-sales-tax-boundaries.html");
  const latest = new Map<string, { url: string; quarter: string }>();
  const history = new Map<string, { url: string; quarter: string }>();
  const from = quarterOf(HISTORY_FROM).slice(2);
  for (const match of page.matchAll(/href=["']([^"']+\/(LOCCODE_PUBLIC|Cities|PTBA|RTA)_(\d{2}Q[1-4])(?:_\d+)?\.zip)["']/gi)) {
    const family = match[2].toUpperCase(), quarter = match[3].toUpperCase();
    const data = { url: new URL(match[1], WA_PAGE).href, quarter };
    const previous = latest.get(family);
    if (!previous || quarter > previous.quarter) latest.set(family, data);
    if (family === "LOCCODE_PUBLIC" && quarter >= from) history.set(quarter, data);
  }
  if (latest.size !== 4) throw new Error("WA: could not discover all four dated boundary ZIP families");
  return [
    ...[...history.values()].sort((a, b) => a.quarter.localeCompare(b.quarter))
      .map((data) => ({ id: "wa-loccode_public", state: "WA", ...data })),
    ...[...latest].filter(([family]) => family !== "LOCCODE_PUBLIC")
      .map(([family, data]) => ({ id: `wa-${family.toLowerCase()}`, state: "WA", ...data })),
  ];
}

/** Every quarterly Minnesota layer from HISTORY_FROM's quarter, oldest
 *  first: each is indexed for its own quarter. */
export async function minnesotaSources(dir?: string): Promise<Array<PolygonSource & { quarter: string }>> {
  const listing = await sourceJson(`${MN_SERVICES}?f=json`, dir, "mn-services.json");
  const from = quarterOf(HISTORY_FROM);
  const quarters = (listing.services as Array<{ name: string }>)
    .map((s) => /^locgnrl_sales_usetax_areas_(\d{4}Q[1-4])$/.exec(s.name)?.[1])
    .filter((q): q is string => !!q && q >= from)
    .sort();
  if (!quarters.length) throw new Error("MN: no quarterly sales tax area layers listed");
  // Most services publish the areas as layer 0, not all (2025Q3's isn't).
  const sources = [];
  for (const quarter of quarters) {
    const service = `${MN_SERVICES}/locgnrl_sales_usetax_areas_${quarter}/FeatureServer`;
    const layers = (await sourceJson(`${service}?f=json`, dir, `mn-${quarter}-service.json`)).layers as Array<{ id: number }> | undefined;
    if (!layers?.length) throw new Error(`MN: ${quarter} lists no layer`);
    sources.push({
      id: "mn-tax-areas", state: "MN", role: "tax-area" as const, quarter, url: `${service}/${layers[0].id}`,
      note: `${quarter} combined areas; crosswalk sst_code and component codes before promotion.`,
    });
  }
  return sources;
}

export async function fetchWashingtonZip(source: { id: string; url: string; quarter: string }, dir?: string) {
  const files = unzipSync(await fetchFile(source.url, dir));
  const get = (extension: string) => Object.entries(files).find(([name]) => name.toLowerCase().endsWith(extension))?.[1];
  const shp = get(".shp"), dbf = get(".dbf"), prj = get(".prj");
  if (!shp || !dbf || !prj) throw new Error(`${source.id}: missing shapefile components`);
  const view = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  for (let at = 100; at + 12 <= shp.byteLength;) {
    const type = view.getInt32(at + 8, true);
    if (type !== 0 && type !== 5) throw new Error(`${source.id}: unsupported shapefile geometry type ${type}`);
    const length = view.getInt32(at + 4, false) * 2;
    if (length < 4 || at + 8 + length > shp.byteLength) throw new Error(`${source.id}: truncated shapefile record`);
    at += 8 + length;
  }
  // This is the verified DOR projection. Fail on a publication change,
  // rather than treating projected feet as longitude/latitude.
  const projection = strFromU8(prj);
  if (!projection.includes('PROJCS["NAD_1983_HARN_StatePlane_Washington_South_FIPS_4602_Feet"'))
    throw new Error(`${source.id}: unrecognized projection: ${projection.slice(0, 100)}`);
  const records = readDbf(dbf), polygons = readPolygons(shp);
  if (!records.length || records.length !== polygons.length) throw new Error(`${source.id}: mismatched shapefile records`);
  const features: EvidenceFeature[] = [];
  const recordsWithoutGeometry: Array<{ id: string; attributes: Record<string, unknown> }> = [];
  for (let i = 0; i < records.length; i++) {
    const rings = polygons[i];
    if (!rings?.length) {
      // DOR's PTBA export includes a genuine ESRI null-shape record.
      // Keep its attributes; it must not become a zero-tax mapped region.
      recordsWithoutGeometry.push({ id: String(i + 1), attributes: records[i] });
      continue;
    }
    const lines = JSON.stringify({ type: "MultiLineString", coordinates: rings });
    const [row] = await db.execute<{ geometry: { coordinates: Shape["rings"] } }>(sql`select
      st_asgeojson(st_transform(st_setsrid(st_geomfromgeojson(${lines}), 2927), 4326))::json as geometry`);
    validateRings(row.geometry.coordinates, source.id);
    features.push({ id: String(i + 1), attributes: records[i], rings: row.geometry.coordinates });
  }
  return { features, metadata: { quarter: `20${source.quarter}`, projection, sourceRecords: records.length, recordsWithoutGeometry,
    role: source.id === "wa-loccode_public" ? "tax-area" : "validation",
    note: "Dated DOR boundary export; join LOCCODE to dated SST reporting codes. PTBA/RTA may already be included in those rates." } };
}

export async function refreshSupplemental({ states = [], dir, sources = [], log = console.log }:
  { states?: string[]; dir?: string; sources?: string[]; log?: (line: string) => void } = {}) {
  const wanted = (s: { state: string; id: string }) => (!states.length || states.includes(s.state)) && (!sources.length || sources.includes(s.id));
  const failures: string[] = [];
  // An older quarter that fails is logged and left out; only a source's
  // newest edition failing fails the run.
  const run = async (source: { id: string; state: string; url: string }, fetch: () => Promise<{ features: EvidenceFeature[]; metadata: Record<string, unknown> }>, newest = true) => {
    try {
      const data = await fetch();
      const result = await loadEvidence(source, data.features, data.metadata);
      log(`${source.state}: ${source.id} → ${result.rows} supplemental outlines (pending verification)`);
    } catch (error) {
      if (newest) failures.push(source.id);
      log(`${source.state}: ${source.id}${"quarter" in source ? ` ${source.quarter}` : ""} FAILED: ${error instanceof Error ? error.message : error}; previous snapshots retained`);
    }
  };
  for (const source of SUPPLEMENTAL_POLYGONS.filter(wanted)) await run(source, () => fetchEvidenceLayer(source, dir));
  if (wanted({ state: "MN", id: "mn-tax-areas" })) {
    try {
      const sources = await minnesotaSources(dir);
      for (const source of sources)
        await run(source, async () => {
          const data = await fetchEvidenceLayer(source, dir);
          return { ...data, metadata: { ...data.metadata, quarter: source.quarter } };
        }, source === sources.at(-1));
    } catch (error) { failures.push("mn-discovery"); log(`MN: ${String(error)}`); }
  }
  if ((!states.length || states.includes("WA")) && (!sources.length || sources.some((s) => s.startsWith("wa-")))) {
    try {
      const sources = (await washingtonSources(dir)).filter(wanted);
      for (const source of sources)
        await run(source, () => fetchWashingtonZip(source, dir), !sources.some((o) => o.id === source.id && o.quarter > source.quarter));
    }
    catch (error) { failures.push("wa-discovery"); log(`WA: ${String(error)}`); }
  }
  if (failures.length) throw new Error(`Supplemental ingestion incomplete: ${failures.join(", ")}`);
}
