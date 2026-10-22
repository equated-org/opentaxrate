/**
 * Verifies each supplemental tax-area polygon against the state's dated rate
 * and boundary files, and indexes the result into the lookup tables: a
 * verified feature as its area's outline (building the area when the files
 * lack it and every component is published), an unverified one as a held
 * coverage marker. Run at the end of refresh and ingest.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { salesTaxAreas, salesTaxJurisdictionRates, salesTaxJurisdictions, salesTaxShapes, taxSourceFeatures, taxSourceSnapshots } from "../db/schema.js";
import { rateAreas } from "../rates/ranges.js";
import { isBuiltArea, BUILT_AREA_BASE } from "../rates/range-polygons.js";
import { HELD_PREFIX } from "../rates/shapes.js";
import { STATE_FIPS } from "../coverage.js";
const CALCULATION_SOURCES: Record<string, string> = {
  CA: "ca-tax-history", WA: "wa-loccode_public", MN: "mn-tax-areas",
  VT: "vt-local-option", SD: "sd-cities", NE: "ne-tax-areas",
};
/** A feature's verdict for one period: the existing areas it is, a CA rate,
 * a combination to build, or why it is held. A held feature becomes a
 * coverage marker unless `excluded`: a program outside the general rate. */
interface VerifiedPeriod { from: string; to: string; areas?: number[]; rate?: number; code?: string; construct?: Combination; reason?: string; ignore?: boolean; excluded?: boolean }
interface Combination { county: string | null; place: string | null; districts: string }
const approvedEntry = (e: VerifiedPeriod) => Boolean(e.areas?.length || e.rate !== undefined || e.construct);
type FeatureChecks = Record<string, VerifiedPeriod[]>;
import { isoDay, shiftDay } from "./states/sources.js";
import { latestSstFiles, sstFileLines } from "./downloads.js";
import { loadSstState } from "./load.js";

type Snapshot = typeof taxSourceSnapshots.$inferSelect;
type Attributes = Record<string, unknown>;
const field = (a: Attributes, key: string) => a[key] === null || a[key] === undefined ? "" : String(a[key]).trim();
const fips = (s: string, width: number) => /^\d+$/.test(s) && s.length <= width ? s.padStart(width, "0") : "";
const percent = (value: unknown) => {
  const s = String(value ?? "").trim();
  return /^\d+(\.\d+)?%?$/.test(s) ? Number(s.replace(/%$/, "")) / 100 : null;
};
const close = (a: number, b: number) => Math.abs(a - b) < 0.0000005;

export function quarterWindow(edition: string): { from: string; to: string } | null {
  const m = /^(\d{4})Q([1-4])$/.exec(edition);
  if (!m) return null;
  return { from: `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1).padStart(2, "0")}-01`,
    to: new Date(Date.UTC(Number(m[1]), Number(m[2]) * 3, 0)).toISOString().slice(0, 10) };
}

function windowOf(s: Snapshot) {
  const stamp = /DateStamp = TIMESTAMP '(\d{4})-(\d{2})-01 /.exec(String(s.metadata.where ?? ""));
  const edition = String(s.metadata.quarter ?? /_(\d{4}Q[1-4])\//.exec(s.url)?.[1] ?? "");
  return quarterWindow(edition) ?? (stamp ? quarterWindow(`${stamp[1]}Q${Math.ceil(Number(stamp[2]) / 3)}`) : null);
}

/** Match complete components and their published amounts, never just a
 * total rate or a similarly named jurisdiction. */
export function minnesotaComponents(a: Attributes): Map<string, number> | null {
  const result = new Map<string, number>();
  const fields = [["taxst", "StFrmal", "45", 2], ["taxcty", "CtyFrmal", "00", 3], ["taxcity", "CityFrmal", "01", 5],
    ...[1, 2, 3, 4].map(i => [`taxsp0${i}`, `Spec0${i}Frmal`, "63", 5])] as Array<[string, string, string, number]>;
  for (const [codeField, rateField, type, width] of fields) {
    const raw = field(a, codeField), amount = percent(a[rateField]);
    if (!raw && (amount === null || amount === 0)) continue;
    const code = fips(raw, width);
    if (!code || amount === null) return null;
    if (amount > 0) result.set(`${type}:${code}`, amount);
  }
  const total = percent(a.TotalFrmal);
  return total !== null && close([...result.values()].reduce((s, v) => s + v, 0), total) ? result : null;
}

/** Nebraska tiles some tax areas and overlaps others. Every feature carries
 * the full state/county/city breakdown in percent-valued summary fields. */
export function nebraskaComponents(a: Attributes): Map<string, number> | null {
  const desired = new Map<string, number>();
  for (const [codeField, amountField, type, width] of [
    ["StateFIPS", "StateRate", "45", 2], ["CountyFIPS", "CountyRate", "00", 3], ["CityFIPS", "CityRate", "01", 5],
  ] as Array<[string,string,string,number]>) {
    const value = a[amountField];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
    if (value === 0) continue;
    const code = fips(field(a, codeField), width);
    if (!code) return null;
    desired.set(`${type}:${code}`, value / 100);
  }
  const total = a.TotalRate;
  return typeof total === "number" && close([...desired.values()].reduce((sum,v) => sum+v,0), total/100) ? desired : null;
}

/** The tax area a feature's complete published components describe, when
 * each is a jurisdiction with that same rate in the dated rate file. Never
 * from a total or a name: every code and its amount are the publisher's. */
export function combination(desired: Map<string, number>, rates: Map<string, number>, stateFips: string): Combination | null {
  if (!desired.has(`45:${stateFips}`)) return null;
  let county: string | null = null, place: string | null = null;
  const districts: string[] = [];
  for (const [key, amount] of desired) {
    if (!rates.has(key) || !close(rates.get(key)!, amount)) return null;
    const [type, code] = key.split(":");
    if (type === "45") { if (code !== stateFips) return null; }
    else if (type === "00") { if (county) return null; county = code; }
    else if (type === "01") { if (place) return null; place = code; }
    else districts.push(key);
  }
  return { county, place, districts: districts.sort().join(" ") };
}

const positiveParts = (parts: Array<{ code: string; rate: number }>) => new Map(parts.filter(p => p.rate > 0).map(p => [p.code, p.rate]));
const sameParts = (a: Map<string, number>, b: Map<string, number>) => a.size === b.size && [...a].every(([k, v]) => b.has(k) && close(v, b.get(k)!));

async function activeAreas(state: string, date: string) {
  return db.execute<{ id: number }>(sql`select area_id as id from sales_tax_zip_ranges
    where state=${state} and ${date} between starts_on and ends_on
    union select area_id from sales_tax_street_ranges where state=${state} and ${date} between starts_on and ends_on`);
}

/** Reload legacy area rows that predate retention of Washington SER codes.
 * Reusing a file name must not hide a required parser/schema upgrade. */
async function ensureWashingtonIds(log: (line: string) => void) {
  const [{ count }] = await db.execute<{ count: string }>(sql`select count(*) as count from sales_tax_areas where state='WA' and ids ? 'Composite SER Code'`);
  if (Number(count)) return;
  const files = (await latestSstFiles()).filter(f => f.state === "WA");
  const r = files.find(f => f.kind === "rates"), b = files.find(f => f.kind === "boundaries");
  if (!r || !b) throw new Error("WA: missing official SST files needed to retain location-code identifiers");
  const counts = await loadSstState({ state: "WA", rates: { name: r.name, lines: sstFileLines(r) }, boundaries: { name: b.name, lines: sstFileLines(b) } });
  log(`WA: rebuilt ${counts.areas} areas with publisher location-code identifiers`);
}

async function ratePeriods(state: string, from: string, to: string) {
  const rows = await db.execute<{ day: string }>(sql`select distinct day::text from (
    select starts_on as day from sales_tax_jurisdiction_rates where state=${state}
    union select ends_on+1 from sales_tax_jurisdiction_rates where state=${state}
    union select starts_on from sales_tax_zip_ranges where state=${state}
    union select ends_on+1 from sales_tax_zip_ranges where state=${state}
    union select starts_on from sales_tax_street_ranges where state=${state}
    union select ends_on+1 from sales_tax_street_ranges where state=${state}
    ) dates where day>${from}::date and day<=${to}::date order by day`);
  const cuts = [from, ...rows.map(r => r.day), shiftDay(to, 1)];
  return cuts.slice(0, -1).map((day, i) => ({ from: day, to: shiftDay(cuts[i + 1], -1) }));
}

/** Both independent CDTFA layers must date the same edition and agree over
 * the complete TAC geometry. A few metres allows the stored simplification;
 * runtime uncertainty buffers are larger and still checked in metres. */
async function californiaBindings(s: Snapshot, dependency: Snapshot, window: { from: string; to: string }) {
  const rows = await db.execute<{ feature_id: string; attributes: Attributes; agrees: boolean }>(sql`
    select h.feature_id,h.attributes,coalesce(st_covers(st_buffer(st_unaryunion(st_collect(c.geom)),0.00002),h.geom),false) as agrees
    from tax_source_features h left join tax_source_features c on c.snapshot_id=${dependency.id}
      and c.geom && h.geom and abs((c.attributes->>'RATE')::numeric-(h.attributes->>'RATE')::numeric)<0.0000005
      and to_char(to_timestamp((c.attributes->>'DateStamp')::double precision/1000),'YYYY-MM')=${window.from.slice(0, 7)}
    where h.snapshot_id=${s.id} group by h.feature_id,h.attributes,h.geom`);
  const features: FeatureChecks = {};
  for (const r of rows) {
    const a = r.attributes, rate = Number(a.RATE), code = field(a, "TAC_txt");
    const stamp = isoDay(a.DateStamp), start = isoDay(a.START_DATE);
    const reason = !r.agrees ? "CDTFA current layer does not cover the complete TAC polygon at the same rate" :
      (start && start > window.to) ? "Native rate starts after the geometry quarter" :
      !code || !Number.isFinite(rate) || rate < .0725 || rate >= .2 ? "Invalid TAC/rate" :
      stamp?.slice(0, 7) !== window.from.slice(0, 7) ? "Geometry edition differs from selected quarter" : null;
    features[r.feature_id] = [{ ...window, ...(reason ? { reason } : { rate, code, from: start && start > window.from ? start : window.from }) }];
  }
  return { features };
}

export async function indexVerifiedPolygons({ states = [], log = console.log }:
  { states?: string[]; log?: (line: string) => void } = {}) {
  const snapshots = await db.select().from(taxSourceSnapshots).orderBy(desc(taxSourceSnapshots.observedAt), desc(taxSourceSnapshots.id));
  const latest = new Map<string, Snapshot>();
  for (const s of snapshots) if (!latest.has(s.source)) latest.set(s.source, s);
  if ((!states.length || states.includes("WA")) && latest.has("wa-loccode_public")) await ensureWashingtonIds(log);
  const results: Array<Record<string, unknown>> = [];
  for (const s of latest.values()) {
    if (states.length && !states.includes(s.state)) continue;
    const eligible = CALCULATION_SOURCES[s.state] === s.source;
    const dependency = s.source === "ca-tax-history" ? latest.get("ca-tax-areas") : undefined;
    const window = windowOf(s) ?? { from: s.observedAt.toISOString().slice(0, 10), to: s.observedAt.toISOString().slice(0, 10) };
    const releaseKey = eligible && s.state !== "CA" ? await releaseKeyOf(s.state) : null;
    let status: "active" | "held" | "validation_only" | "excluded" = "validation_only";
    let checks: FeatureChecks = {};
    let reason = "Validation/civil geometry only; no independently additive general tax";
    if (["tn-cbid-2026", "tn-cbid-2027", "sd-special-districts", "al-montgomery-pj"].includes(s.source)) {
      status = "excluded"; reason = "Requires transaction/levy/customer conditions; policy support is disabled";
    } else if (s.source === "ia-local-option") {
      status = "held"; reason = "Layer lacks jurisdiction identifiers and contains stale/geometry-less records; needs a dated DOR LOST-status crosswalk";
    } else if (eligible) {
      status = "held";
      if (s.state === "CA") {
        if (!windowOf(s) || !dependency) reason = "Missing dated quarter or independent current CDTFA layer";
        else { checks = (await californiaBindings(s, dependency, window)).features; }
      } else if (!releaseKey) reason = "No dated rate/boundary release loaded";
      else {
        const features = await db.select({ id: taxSourceFeatures.featureId, a: taxSourceFeatures.attributes }).from(taxSourceFeatures).where(eq(taxSourceFeatures.snapshotId, s.id));
        const areas = await db.select().from(salesTaxAreas).where(eq(salesTaxAreas.state, s.state));
        const byId = new Map(areas.map(a => [a.id, a]));
        for (const period of await ratePeriods(s.state, window.from, window.to)) {
          const ids = (await activeAreas(s.state, period.from)).map(a => a.id);
          const rated = ids.length ? await rateAreas(s.state, STATE_FIPS[s.state], ids, period.from) : [];
          const statePart = rated[0]?.parts.find(p => p.kind === "state");
          const rateRows = await db.select().from(salesTaxJurisdictionRates).where(and(eq(salesTaxJurisdictionRates.state, s.state), sql`${period.from} between starts_on and ends_on`));
          const rates = new Map(rateRows.map(r => [`${r.type}:${r.code}`, Number(r.rate)]));
          for (const f of features) {
            const a = f.a;
            let entry: VerifiedPeriod = { ...period, reason: "No exact code/component/rate agreement with active boundary areas" };
            if (s.state === "WA") {
              const code = fips(field(a, "LOCCODE"), 4);
              const matches = rated.filter(r => r.locationIds["Composite SER Code"] === code.padStart(5, "0") &&
                byId.get(r.areaId)!.districts.split(" ").filter(Boolean).every(d => {
                  const district = d.split(":")[1];
                  return /^0+$/.test(district) || r.parts.some(p => p.code.split(":")[1] === district);
                }));
              if (code && matches.length) entry = { ...period, areas: matches.map(r => r.areaId), code };
            } else if (s.state === "MN") {
              const desired = minnesotaComponents(a);
              const matches = desired ? rated.filter(r => sameParts(desired, positiveParts(r.parts))) : [];
              const built = desired && !matches.length ? combination(desired, rates, STATE_FIPS[s.state]) : null;
              if (matches.length) entry = { ...period, areas: matches.map(r => r.areaId) };
              else if (built) entry = { ...period, construct: built };
              else if (!desired) entry.reason = "Malformed/missing native components or total does not equal component sum";
            } else if (s.state === "VT") {
              const geo = field(a, "TOWNGEOID"), sales = Number(a.Sales);
              if (/^50\d{8}$/.test(geo) && statePart && Number.isFinite(sales) && sales >= statePart.rate) {
                const desired = new Map([[statePart.code, statePart.rate]]);
                if (sales > statePart.rate) desired.set(`01:${geo.slice(-5)}`, sales - statePart.rate);
                const matches = rated.filter(r => {
                  const area = byId.get(r.areaId)!;
                  return (!area.county || area.county === geo.slice(2, 5)) && (!area.place || area.place === geo.slice(-5)) && sameParts(desired, positiveParts(r.parts));
                });
                const start = isoDay(a.Start_Sales), end = isoDay(a.End_Sales);
                const inactiveLocal = field(a, "LOT_Sales") === "N" && close(sales, statePart.rate) && (!end || end < period.from);
                if ((inactiveLocal || ((!start || start <= period.from) && (!end || end >= period.to))) && matches.length)
                  entry = { ...period, areas: matches.map(r => r.areaId), code: geo };
              }
            } else if (s.state === "SD") {
              const start = isoDay(a.activefrom), end = isoDay(a.activeto) ?? isoDay(a.retireddate);
              if ((start && start > period.to) || (end && end < period.from) || field(a, "ratecategory").toLowerCase() !== "general") entry = { ...period, ignore: true };
              else if (Number(a.specialjurisdiction) !== 0) entry.reason = "Special jurisdiction requires conditional treatment";
              else if (statePart && typeof a.rate === "number" && a.rate >= 0) {
                const code = fips(field(a, "cityfips"), 5), county = fips(field(a, "cnty_fips"), 3);
                const desired = new Map([[statePart.code, statePart.rate]]);
                if (a.rate > 0) desired.set(`01:${code}`, a.rate);
                const matches = rated.filter(r => {
                  const area = byId.get(r.areaId)!;
                  return (!area.county || area.county === county) && (!area.place || area.place === code) && sameParts(desired, positiveParts(r.parts));
                });
                if (code && matches.length) entry = { ...period, areas: matches.map(r => r.areaId), code };
              }
            } else if (s.state === "NE") {
              const gld = field(a, "GLDCode");
              const key = `${field(a, "JurisdictionType")}:${field(a, "JurisdictionFIPSCode")}`;
              const value = Number(a.GeneralTaxRateIntrastate);
              const start = isoDay(a.EffectiveBeginDate), end = isoDay(a.EffectiveEndDate);
              if (gld && gld !== "N/A") entry = { ...period, excluded: true, reason: "Good Life District depends on retailer election/product scope; excluded from general calculation" };
              else if ((start && start > period.from) || (end && end < period.to)) entry.reason = "Native rate period does not cover the requested date";
              else {
                const desired = nebraskaComponents(a);
                if (desired && rates.has(key) && Number.isFinite(value) && close(rates.get(key)!, value) &&
                    (value === 0 || close(desired.get(key) ?? -1, value)) &&
                    [...desired].every(([k,v]) => rates.has(k) && close(rates.get(k)!, v)))
                  {
                  const matches = rated.filter(r => sameParts(desired, positiveParts(r.parts)));
                  const built = matches.length ? null : combination(desired, rates, STATE_FIPS[s.state]);
                  if (matches.length) entry = { ...period, areas: matches.map(r => r.areaId) };
                  else if (built) entry = { ...period, construct: built };
                }
              }
            }
            (checks[f.id] ??= []).push(entry);
          }
        }
      }
      const entries = Object.values(checks).flat();
      if (entries.some(approvedEntry)) { status = "active"; reason = "Exact dated code/rate validation; unresolved features are indexed as coverage markers"; }
      if (releaseKey && await releaseKeyOf(s.state) !== releaseKey) { status = "held"; reason = "Rate/boundary release changed during verification; rerun required"; checks = {}; }
    }
    const entries = Object.values(checks).flat();
    // A source that can't be validated now leaves what was indexed before,
    // held coverage included: its failure is no reason for a weaker fallback.
    const store = eligible && entries.length > 0;
    if (eligible && !store) reason += "; previously indexed data retained";
    const summary = { reason, sourceFeatures: s.rows, approvedPeriods: entries.filter(approvedEntry).length,
      heldPeriods: entries.filter(e => e.reason).length, ignoredPeriods: entries.filter(e => e.ignore).length,
      issues: Object.entries(checks).flatMap(([feature, periods]) => periods.filter(p => p.reason).map(p => ({ feature, from: p.from, reason: p.reason }))).slice(0, 30) };
    // Checks are transient ingestion work. Only approved geometry/rates enter
    // the existing lookup tables; diagnostics are returned for the ingest log.
    const stored = store ? await storeVerifiedPolygons(s, checks, window, releaseKey) : null;
    results.push({ source: s.source, status, ...summary, ...stored });
    log(`${s.state}: ${s.source} → ${status}, ${summary.approvedPeriods} approved / ${summary.heldPeriods} held periods`
      + (stored ? `; ${stored.builtAreas} areas built, ${stored.heldMarkers} coverage markers` : ""));
  }
  return results;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Replaces the source's verified shapes and coverage markers for the
 * window in one transaction: approved features as their areas' outlines,
 * held ones as markers (never cut out of approved outlines, which would
 * read as no coverage), and combinations built where evidence is complete. */
async function storeVerifiedPolygons(s: Snapshot, checks: FeatureChecks, window: {from: string; to: string}, releaseKey: string | null) {
  const file = `${s.source} (${s.url})`;
  const prefix = s.state === "CA" ? "tac:" : "area:";
  const markers = `${HELD_PREFIX}${s.source}:`;
  const counts = { builtAreas: 0, heldMarkers: 0, unreachable: 0 };
  await db.transaction(async tx => {
    // Prevent source replacement racing an SST rebuild: the existing area
    // FK cascades deletions and this lock keeps validation/promotion ordered.
    if (s.state !== "CA") {
      await tx.execute(sql`lock table sales_tax_areas in share row exclusive mode`);
      const [release] = await tx.execute<{key:string|null}>(sql`select md5(string_agg(kind||':'||file||':'||loaded_at::text,'|' order by kind)) as key from sales_tax_data_releases where state=${s.state}`);
      if (release.key !== releaseKey) throw new Error(`${s.state}: source rates changed during indexing; retry ingestion`);
    }
    const inWindow = sql`${salesTaxShapes.startsOn} <= ${window.to} and ${salesTaxShapes.endsOn} >= ${window.from}`;
    await tx.delete(salesTaxShapes).where(and(eq(salesTaxShapes.state,s.state),sql`(${salesTaxShapes.fips} like ${prefix+'%'} or ${salesTaxShapes.fips} like ${markers+'%'}) and ${inWindow}`));
    if (s.state === "CA") await tx.delete(salesTaxJurisdictionRates).where(and(eq(salesTaxJurisdictionRates.state,"CA"),eq(salesTaxJurisdictionRates.type,"tac"),sql`starts_on <= ${window.to} and ends_on >= ${window.from}`));
    const periods = [...new Set(Object.values(checks).flat().map(p => `${p.from}|${p.to}`))];
    for (const span of periods) {
      const [from,to] = span.split('|');
      const entries = Object.entries(checks).map(([feature,ps]) => ({feature,p:ps.find(p => p.from===from && p.to===to)}));
      const blocked = entries.filter(e => e.p?.reason && !e.p.excluded).map(e=>e.feature);
      const approved = entries.filter(e => e.p && !e.p.reason && !e.p.ignore);
      if (s.state === "CA") {
        for (const {feature,p} of approved) {
          if (p!.rate === undefined || !p!.code) continue;
          const code=p!.code;
          await tx.insert(salesTaxJurisdictionRates).values({state:"CA",type:"tac",code,rate:String(p!.rate),startsOn:from,endsOn:to});
          await tx.insert(salesTaxJurisdictions).values({state:"CA",type:"tac",code,name:`CDTFA tax area ${code}`,ids:{TAC_txt:code},file})
            .onConflictDoUpdate({target:[salesTaxJurisdictions.state,salesTaxJurisdictions.type,salesTaxJurisdictions.code],set:{file}});
          await tx.execute(sql`insert into sales_tax_shapes(state,kind,fips,name,geom,file,starts_on,ends_on)
            select 'CA','district',${`tac:${code}:${from}`},${`CDTFA tax area ${code}`},geom,${file},${from},${to}
            from tax_source_features where snapshot_id=${s.id} and feature_id=${feature}`);
        }
      } else {
        const byArea = new Map<number,string[]>();
        for (const {feature,p} of approved) {
          let ids = p!.areas ?? [];
          if (p!.construct) {
            const built = await builtArea(tx, s.state, p!.construct);
            if (built === null) { counts.unreachable++; blocked.push(feature); continue; }
            if (built.created) counts.builtAreas++;
            ids = [built.id];
          }
          for (const id of ids) byArea.set(id, [...(byArea.get(id) ?? []), feature]);
        }
        for (const [id,features] of byArea)
          await tx.execute(sql`insert into sales_tax_shapes(state,kind,fips,name,geom,file,area_id,starts_on,ends_on)
            select ${s.state},'district',${`area:${id}:${from}`},${`${s.state} tax area ${id}`},st_multi(st_collectionextract(st_unaryunion(st_collect(geom)),3)),${file},${id},${from},${to}
            from tax_source_features where snapshot_id=${s.id} and feature_id in (select jsonb_array_elements_text(${JSON.stringify(features)}::jsonb))
            having not st_isempty(st_collectionextract(st_unaryunion(st_collect(geom)),3))`);
      }
      if (blocked.length) {
        const inserted = await tx.execute(sql`insert into sales_tax_shapes(state,kind,fips,name,geom,file,starts_on,ends_on)
          select ${s.state},'district',${markers}||feature_id||${`:${from}`},${`${s.source} feature `}||feature_id||' (tax not verified)',geom,${file},${from},${to}
          from tax_source_features where snapshot_id=${s.id} and feature_id in (select jsonb_array_elements_text(${JSON.stringify(blocked)}::jsonb))
          returning fips`);
        counts.heldMarkers += inserted.length;
      }
    }
    // A built combination no outline holds any longer is gone with it.
    if (s.state !== "CA")
      await tx.execute(sql`delete from sales_tax_areas a where a.state=${s.state} and a.id % 1000000 > ${BUILT_AREA_BASE}
        and not exists (select 1 from sales_tax_shapes x where x.area_id=a.id)`);
  });
  return counts;
}

/** The area for a complete combination: the one built before, or a new one.
 * An equivalent area the boundary files list but no ZIP names on the date
 * couldn't be reached from a ZIP's candidates, so the feature stays held. */
async function builtArea(tx: Tx, state: string, c: Combination): Promise<{ id: number; created: boolean } | null> {
  const [same] = await tx.execute<{id:number}>(sql`select id from sales_tax_areas where state=${state}
    and county is not distinct from ${c.county} and place is not distinct from ${c.place} and districts=${c.districts} order by id limit 1`);
  if (same) return isBuiltArea(Number(same.id)) ? { id: Number(same.id), created: false } : null;
  const base = Number(STATE_FIPS[state]) * 1_000_000;
  const [{ id }] = await tx.execute<{id:number}>(sql`select coalesce(max(id), ${base + BUILT_AREA_BASE}) + 1 as id
    from sales_tax_areas where id > ${base + BUILT_AREA_BASE} and id < ${base + 1_000_000}`);
  await tx.insert(salesTaxAreas).values({ id: Number(id), state, county: c.county, place: c.place, districts: c.districts });
  return { id: Number(id), created: true };
}

async function releaseKeyOf(state: string) {
  const [row] = await db.execute<{key:string|null}>(sql`select md5(string_agg(kind||':'||file||':'||loaded_at::text,'|' order by kind)) as key from sales_tax_data_releases where state=${state}`);
  return row.key;
}
