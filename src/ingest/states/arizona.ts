/**
 * Arizona's transaction privilege tax on retail sales (business code 017),
 * from the Department of Revenue: a county's or reservation's rate, which
 * already includes the 5.6% state rate, plus the city's. A special district
 * only changes the code a return reports under, not the rate.
 *
 *   - Rates: the monthly rate tables, merged from August 2025 (the first in
 *     a file format), each row dated; coverage starts there.
 *   - Outlines: ADOR's county and reservation regions and its city limits,
 *     which track annexations ahead of the Census.
 *
 * Some cities tax part of a single item over a set price at another rate;
 * that tier is the caller's to apply.
 *
 * Each region keeps the table's RegionName and RegionCode, and its
 * outline's County or FIPS where the layer gives one.
 */
import type { ClassRateRow, ClassRateSource } from "../class-rates.js";
import type { RateClass } from "../../rates/types.js";
import type { GeoRateRow, GeoState, GeoStateData, JurisdictionRow } from "./index.js";
import { bboxOf, fetchLayer, fetchText, isoDay, shiftDay } from "./sources.js";

const TABLES = "https://azdor.gov/sites/default/files/document";
const LAYERS = "https://services6.arcgis.com/clPWQMwZfdWn4MQZ/ArcGIS/rest/services";
const FIRST_TABLE = "2025-08-01";
const STATE = 0.056;
/** City limits coded differently from the rate table. */
const PLACE_CODES: Record<string, string> = { TV: "SZ" };

export const arizona: GeoState = {
  state: "AZ",
  async fetch(dir) {
    const found = new Map<string, { code: string; rate: number; from: string; to: string }>();
    /** Each region's name, from the newest table that lists it. */
    const regionNames = new Map<string, string>();
    const latest = await readTables(dir, (c, row) => {
      if (c[2] !== "017") return;
      found.set(`${row.code}|${row.from}|${row.rate}`, row);
      if (c[1]) regionNames.set(c[0], c[1]);
    });

    const byRegion = spansByRegion(found.values());
    const [counties, cities] = await Promise.all([
      fetchLayer(`${LAYERS}/Arizona_County_Region_Codes/FeatureServer/0`),
      fetchLayer(`${LAYERS}/Incorporated_Places_Boundaries/FeatureServer/0`),
    ]);
    const shapes: GeoStateData["shapes"] = [];
    const regions = new Map<string, "county" | "place">();
    const layerIds = new Map<string, Record<string, string>>();
    for (const [features, kind] of [[counties, "county"], [cities, "place"]] as const)
      for (const f of features) {
        const raw = String(f.attributes.Region_Code ?? "").trim();
        const code = PLACE_CODES[raw] ?? raw;
        if (!code) continue;
        regions.set(code, kind);
        const field = kind === "county" ? "County" : "FIPS";
        const value = String(f.attributes[field] ?? "").trim();
        if (value) layerIds.set(code, { ...layerIds.get(code), [field]: value });
        shapes.push({ kind, fips: code, name: String(f.attributes.Name ?? f.attributes.Description ?? code), rings: f.rings, bbox: bboxOf(f.rings) });
      }

    const rates: GeoRateRow[] = [
      { type: "45", code: "04", rate: STATE, startsOn: FIRST_TABLE, endsOn: "9999-12-31" },
    ];
    for (const [code, rows] of byRegion) {
      const kind = regions.get(code);
      if (!kind) continue;
      for (const r of rows)
        rates.push({
          type: kind === "county" ? "00" : "01",
          code,
          rate: Math.round((kind === "county" ? r.rate - STATE : r.rate) * 1e6) / 1e6,
          startsOn: r.from,
          endsOn: r.to,
        });
    }
    const jurisdictions: JurisdictionRow[] = [...new Set(rates.filter((r) => r.type !== "45").map((r) => `${r.type}:${r.code}`))].map((key) => {
      const [type, code] = key.split(":");
      return { type, code, name: regionNames.get(code) ?? null, ids: { RegionCode: code, ...layerIds.get(code) } };
    });
    return {
      rates,
      jurisdictions,
      shapes,
      files: { rates: `AZ ${latest.replace(".csv", "")} and earlier from ${FIRST_TABLE}`, boundaries: "AZGeo county regions and incorporated places" },
    };
  },
};

/** A rate table row's region, rate and dates. */
interface TableRow {
  code: string;
  rate: number;
  from: string;
  to: string;
}

/** Every monthly table from FIRST_TABLE, each row's cells and dated rate
 *  passed to `onRow`, through `last` (a table's file name) where given,
 *  else until a month isn't yet published. Returns the newest table's name. */
async function readTables(dir: string | undefined, onRow: (cells: string[], row: TableRow) => void, last?: string): Promise<string> {
  let latest = "";
  const lastMonth = new Date();
  lastMonth.setUTCMonth(lastMonth.getUTCMonth() + 2);
  for (let month = new Date(`${FIRST_TABLE}T00:00:00Z`); month <= lastMonth; month.setUTCMonth(month.getUTCMonth() + 1)) {
    const mm = String(month.getUTCMonth() + 1).padStart(2, "0");
    const name = `TPT_RATETABLE_ALL_${mm}01${month.getUTCFullYear()}.csv`;
    let csv: string;
    try {
      csv = await fetchText(`${TABLES}/${name}`, dir);
    } catch (error) {
      // A month not yet published ends the run; other failures stop it.
      if (!/answered 404/.test((error as Error).message)) throw error;
      if (latest) break;
      continue;
    }
    latest = name;
    for (const line of csv.replace(/^\uFEFF/, "").split(/\r?\n/).slice(1)) {
      const c = splitCsv(line);
      const from = isoDay(c[6]);
      const to = isoDay(c[7]);
      if (!from || !to) continue;
      onRow(c, { code: c[0], rate: Number(c[4]) / 100, from, to: to >= "9999-01-01" ? "9999-12-31" : to });
    }
    if (name === last) break;
  }
  if (!latest) throw new Error("No Arizona rate table found");
  return latest;
}

/** Each region's rows in date order, a rate ending the day before the
 *  region's next one starts. */
function spansByRegion(rows: Iterable<TableRow>): Map<string, TableRow[]> {
  const byRegion = new Map<string, TableRow[]>();
  for (const r of rows) byRegion.set(r.code, [...(byRegion.get(r.code) ?? []), r]);
  for (const list of byRegion.values()) {
    list.sort((a, b) => a.from.localeCompare(b.from));
    list.forEach((r, i) => {
      const next = list[i + 1]?.from;
      list[i] = { ...r, to: next && next <= r.to ? shiftDay(next, -1) : r.to };
    });
  }
  return byRegion;
}

/** Two regions' dated rates added where both are in force; `base` alone
 *  where `extra` isn't. Both lists are in date order and don't overlap. */
function addSpans(base: TableRow[], extra: TableRow[]): TableRow[] {
  if (!extra.length) return base;
  const days = [...new Set([...base, ...extra].flatMap((r) => [r.from, r.to >= "9999-12-31" ? null : shiftDay(r.to, 1)]).filter(Boolean) as string[])].sort();
  const on = (list: TableRow[], day: string) => list.find((r) => r.from <= day && day <= r.to);
  const out: TableRow[] = [];
  days.forEach((day, i) => {
    const b = on(base, day);
    if (!b) return;
    const to = days[i + 1] ? shiftDay(days[i + 1], -1) : "9999-12-31";
    const rate = Math.round((b.rate + (on(extra, day)?.rate ?? 0)) * 1e6) / 1e6;
    const prev = out.at(-1);
    if (prev && prev.rate === rate && shiftDay(prev.to, 1) === day) prev.to = to;
    else out.push({ code: b.code, rate, from: day, to });
  });
  return out;
}

/** The rates ADOR's tables give each region for two classes of sale, from
 *  the same tables the retail rates were loaded from:
 *    restaurant  restaurants and bars (business code 011), plus the
 *                "additional tax" a few cities levy on it (111; the
 *                table's note: "Additional Tax" means in addition to
 *                Restaurant Tax); a county's, like its retail rate, less
 *                the state's 5.6%;
 *    grocery     food for home consumption (062), which only cities that
 *                tax it list; a county or city with no 062 row has none,
 *                rather than a zero read into the gap.
 *  A region's kind (county or city) is its loaded retail rate's. */
export const arizonaClasses: ClassRateSource = {
  state: "AZ",
  async fetch(dir, loaded) {
    const last = /TPT_RATETABLE_ALL_\d{8}/.exec(loaded.ratesFile ?? "")?.[0];
    const found = { "011": new Map<string, TableRow>(), "111": new Map<string, TableRow>(), "062": new Map<string, TableRow>() };
    const latest = await readTables(
      dir,
      (c, row) => {
        if (c[2] === "011" || c[2] === "111" || c[2] === "062") found[c[2]].set(`${row.code}|${row.from}|${row.rate}`, row);
      },
      last && `${last}.csv`,
    );
    const kinds = new Map(loaded.rates.filter((r) => r.type === "00" || r.type === "01").map((r) => [r.code, r.type]));
    const [restaurant, additional, food] = [found["011"], found["111"], found["062"]].map((m) => spansByRegion(m.values()));
    const rows: ClassRateRow[] = [];
    const push = (rateClass: RateClass, code: string, spans: TableRow[], source: string) => {
      const type = kinds.get(code);
      if (!type) return;
      for (const r of spans)
        rows.push({ type, code, class: rateClass, rate: Math.round((type === "00" ? r.rate - STATE : r.rate) * 1e6) / 1e6, startsOn: r.from, endsOn: r.to, source: `AZ ${latest.replace(".csv", "")} and earlier, ${source}` });
    };
    for (const [code, spans] of restaurant) push("restaurant", code, addSpans(spans, additional.get(code) ?? []), additional.has(code) ? "business codes 011 + 111" : "business code 011");
    for (const [code, spans] of food) push("grocery", code, spans, "business code 062");
    return { rows, file: `AZ ${latest.replace(".csv", "")} (business codes 011, 111, 062)` };
  },
};

function splitCsv(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

