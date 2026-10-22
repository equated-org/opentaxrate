/** Supplemental geography, exposed as published evidence rather than tax calculations. */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db/client.js";
import { taxSourceSnapshots } from "./db/schema.js";
import { marginOf, validPoint, type LocatedPoint, type Locate } from "./geocoding/types.js";
import { SUPPLEMENTAL_POLYGONS } from "./ingest/supplemental-sources.js";

type Kind = "transit" | "tax_area" | "special_district" | "civil" | "boundary_change" | "police_jurisdiction";
interface Definition { id: string; state: string; kind: Kind; type: string; names: string[]; ids: string[]; edition?: string }
const definition = (id: string, kind: Kind, type: string, names: string[], ids: string[] = [], edition?: string): Definition =>
  ({ id, state: id.slice(0, 2).toUpperCase(), kind, type, names, ids, edition });

export const REGION_SOURCES: readonly Definition[] = [
  definition("wa-rta", "transit", "regional_transit_authority", ["RTA_NAME"], ["GlobalID"]),
  definition("wa-ptba", "transit", "public_transportation_benefit_area", ["PTBA_NAME"], ["PTBA_LOC", "GlobalID"]),
  definition("wa-cities", "civil", "city", ["CITY_NAME"], ["CITY", "PLACE", "GNIS", "GlobalID"]),
  definition("wa-loccode_public", "tax_area", "location_code_area", [], ["LOCCODE"]),
  definition("ut-transit", "transit", "transit_special_tax_area", ["SHORTDESC"], ["TAXDIST", "ENTITYNBR", "COUNTYNBR"]),
  definition("tn-cbid-2026", "special_district", "central_business_improvement_district", ["Name"], ["GlobalID"], "2026"),
  definition("tn-cbid-2027", "special_district", "central_business_improvement_district", ["Name"], ["GlobalID"], "2027"),
  definition("tn-cities", "civil", "city", ["NAME"]),
  definition("tn-counties", "civil", "county", ["COUNTY_NAME"], ["FIPS_CODE_3", "FIPS_CODE_5"]),
  definition("ne-tax-areas", "tax_area", "sales_tax_area", ["NAME", "CityName"], ["GLDCode", "JurisdictionFIPSCode", "JurisdictionType"]),
  definition("sd-cities", "tax_area", "city_tax_area", ["cityname", "city"], ["code", "cityfips", "tax_code"]),
  definition("sd-special-districts", "special_district", "special_tax_district", ["cityname", "name"], ["code", "geoid", "fips_code"]),
  definition("vt-local-option", "tax_area", "local_option_area", ["TOWNNAMEMC", "TOWNNAME"], ["TOWNGEOID", "FIPS6"]),
  definition("al-montgomery-pj", "police_jurisdiction", "police_jurisdiction", [], ["GlobalID"]),
  definition("ca-tax-areas", "tax_area", "sales_use_tax_area", ["JURIS_NAME", "City_name"], ["TAC_txt"]),
  definition("ca-tax-history", "tax_area", "sales_use_tax_area", ["JURIS_NAME", "City_Name_Proper"], ["TAC_txt", "CountyCode"]),
  definition("mn-tax-areas", "tax_area", "sales_use_tax_area", ["NameLabel", "NameFrmal"], ["sst_code", "code_join"], "2026Q4"),
  definition("ia-local-option", "tax_area", "local_option_area", ["name"], ["taxtype"]),
  definition("ar-municipalities", "civil", "municipality", ["city_name"], ["city_fips", "globalid"]),
  definition("ar-municipal-changes", "boundary_change", "municipal_boundary_change", ["city_name"], ["city_fips", "globalid"]),
  definition("va-tax-crosscheck", "tax_area", "county_tax_area", ["NAMELSAD", "NAME"], ["STCOFIPS", "GNIS"]),
  definition("wv-communities", "civil", "community", ["Community_Name_Modified", "Name_Census"], ["ID_Census", "CID"]),
];

export interface RegionSource {
  id: string;
  url: string;
  snapshotId: string;
  edition: string | null;
  observedAt: string;
  startsOn: string | null;
  endsOn: string | null;
  dateBasis: "published_edition" | "latest_snapshot";
  note: string | null;
}
export interface RegionMatch {
  kind: Kind;
  type: string;
  name: string | null;
  ids: Record<string, string>;
  featureId: string;
  attributes: Record<string, unknown>;
  source: RegionSource;
}
export interface RegionCoverage {
  source: string;
  status: "evaluated" | "unavailable" | "date_uncovered" | "location_uncertain" | "incomplete" | "error";
  details?: RegionSource;
}
export interface Regions { matches: RegionMatch[]; coverage: RegionCoverage[] }
type Snapshot = typeof taxSourceSnapshots.$inferSelect;

/** Quarter/year editions are explicit coverage. An undated snapshot makes no historical claim. */
export function regionSource(d: Definition, s: Snapshot): RegionSource {
  const quarter = typeof s.metadata.quarter === "string" ? s.metadata.quarter : undefined;
  // California's acquisition filter explicitly selects a quarterly DateStamp edition.
  const stamp = d.id === "ca-tax-history" && typeof s.metadata.where === "string"
    ? /DateStamp = TIMESTAMP '(\d{4})-(\d{2})-01 /.exec(s.metadata.where) : null;
  const edition = quarter ?? (stamp ? `${stamp[1]}Q${Math.ceil(Number(stamp[2]) / 3)}` : d.edition) ?? null;
  const q = edition && /^(\d{4})Q([1-4])$/.exec(edition);
  const year = edition && /^(\d{4})$/.exec(edition);
  const startsOn = q ? `${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}-01` : year ? `${year[1]}-01-01` : null;
  const endsOn = q ? new Date(Date.UTC(Number(q[1]), Number(q[2]) * 3, 0)).toISOString().slice(0, 10) : year ? `${year[1]}-12-31` : null;
  return { id: d.id, url: s.url, snapshotId: s.id, edition, observedAt: s.observedAt.toISOString(), startsOn, endsOn,
    dateBasis: startsOn ? "published_edition" : "latest_snapshot", note: typeof s.metadata.note === "string" ? s.metadata.note : null };
}

function value(a: Record<string, unknown>, key: string): string | null {
  const v = a[key];
  return (typeof v === "string" && v.trim() && !["N/A", "NULL"].includes(v.trim().toUpperCase())) || typeof v === "number" ? String(v) : null;
}
export function regionMatch(d: Definition, source: RegionSource, featureId: string, attributes: Record<string, unknown>): RegionMatch {
  const ids: Record<string, string> = {};
  for (const key of d.ids) { const v = value(attributes, key); if (v !== null) ids[key] = v; }
  // Nebraska's source mixes general areas and Good Life districts in one layer.
  const goodLife = d.id === "ne-tax-areas" && value(attributes, "GLDCode") !== null;
  return { kind: goodLife ? "special_district" : d.kind, type: goodLife ? "good_life_district" : d.type,
    name: d.names.map(key => value(attributes, key)).find(v => v !== null) ?? null,
    ids, featureId, attributes, source };
}

/** Reuses the engine's final point, and requests one only when a source can be evaluated. */
export async function regionsAt(state: string, date: string, locate: Locate, now = new Date()): Promise<Regions> {
  const definitions = REGION_SOURCES.filter(s => s.state === state.toUpperCase());
  const result: Regions = { matches: [], coverage: [] };
  if (!definitions.length) return result;
  const today = now.toISOString().slice(0, 10);
  let snapshots: Snapshot[];
  try {
    snapshots = await db.select().from(taxSourceSnapshots)
      .where(and(eq(taxSourceSnapshots.state, state.toUpperCase()), inArray(taxSourceSnapshots.source, definitions.map(d => d.id))))
      .orderBy(desc(taxSourceSnapshots.observedAt), desc(taxSourceSnapshots.id));
  } catch (error) {
    console.error("Regional source query failed", error);
    return { matches: [], coverage: definitions.map(d => ({ source: d.id, status: "error" })) };
  }
  let point: LocatedPoint | null | undefined;
  for (const d of definitions) {
    const available = snapshots.filter(s => s.source === d.id);
    const applicable = available.map(snapshot => ({ snapshot, source: regionSource(d, snapshot) }))
      .filter(({ source }) => source.startsOn && source.endsOn ? date >= source.startsOn && date <= source.endsOn : date === today);
    // Later edition wins over older overlapping editions; observation time breaks ties.
    applicable.sort((a, b) => (b.source.startsOn ?? "").localeCompare(a.source.startsOn ?? ""));
    const selected = applicable[0];
    if (!selected) {
      result.coverage.push(available.length
        ? { source: d.id, status: "date_uncovered", details: regionSource(d, available[0]) }
        : { source: d.id, status: "unavailable" });
      continue;
    }
    const { source, snapshot } = selected;
    if (point === undefined) {
      try { point = await locate(); } catch { point = null; }
      if (point && !validPoint(point)) point = null;
    }
    if (!point) { result.coverage.push({ source: d.id, status: "location_uncertain", details: source }); continue; }
    try {
      const features = await nearbyRegions(snapshot.id, point);
      let uncertain = false;
      for (const feature of features) {
        if (feature.edge_metres <= marginOf(point)) { uncertain = true; continue; }
        if (feature.inside) result.matches.push(regionMatch(d, source, feature.feature_id, feature.attributes));
      }
      const missing = snapshot.metadata.recordsWithoutGeometry;
      const incomplete = Array.isArray(missing) && missing.length > 0;
      result.coverage.push({ source: d.id, status: uncertain ? "location_uncertain" : incomplete ? "incomplete" : "evaluated", details: source });
    } catch (error) {
      console.error(`Regional query failed for ${d.id}`, error);
      result.coverage.push({ source: d.id, status: "error", details: source });
    }
  }
  return result;
}

async function nearbyRegions(snapshotId: string, point: LocatedPoint) {
  const margin = marginOf(point);
  // Expand in degrees for the existing geometry GiST index, then check distances in metres.
  const pad = margin / (100_000 * Math.max(0.01, Math.cos(point.lat * Math.PI / 180)));
  return db.execute<{ feature_id: string; attributes: Record<string, unknown>; inside: boolean; edge_metres: number }>(sql`
    with p as (select st_setsrid(st_point(${point.lon}, ${point.lat}), 4326) as g)
    select f.feature_id, f.attributes, st_covers(f.geom, p.g) as inside,
      st_distance(st_boundary(f.geom)::geography, p.g::geography) as edge_metres
    from tax_source_features f cross join p
    where f.snapshot_id = ${snapshotId} and f.geom && st_expand(p.g, ${pad})
      and (st_covers(f.geom, p.g) or st_dwithin(f.geom::geography, p.g::geography, ${margin}))
    order by f.feature_id`);
}

/** Dataset coverage is discoverable even in states with no regional sources. */
export const regionSourcesFor = (state: string) => REGION_SOURCES.filter(s => s.state === state).map(s => ({
  id: s.id, kind: s.kind, type: s.type,
  note: SUPPLEMENTAL_POLYGONS.find(p => p.id === s.id)?.note ?? "Dated Washington DOR boundary export.",
}));
