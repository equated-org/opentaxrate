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
 */
import type { GeoRateRow, GeoState, GeoStateData } from "./index.js";
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
      for (const line of csv.replace(/^﻿/, "").split(/\r?\n/).slice(1)) {
        const c = splitCsv(line);
        if (c[2] !== "017") continue;
        const from = isoDay(c[6]);
        const to = isoDay(c[7]);
        if (!from || !to) continue;
        const row = { code: c[0], rate: Number(c[4]) / 100, from, to: to >= "9999-01-01" ? "9999-12-31" : to };
        found.set(`${row.code}|${row.from}|${row.rate}`, row);
      }
    }
    if (!latest) throw new Error("No Arizona rate table found");

    // A rate ends the day before the region's next one starts.
    const byRegion = new Map<string, Array<{ rate: number; from: string; to: string }>>();
    for (const r of found.values()) byRegion.set(r.code, [...(byRegion.get(r.code) ?? []), r]);
    const [counties, cities] = await Promise.all([
      fetchLayer(`${LAYERS}/Arizona_County_Region_Codes/FeatureServer/0`),
      fetchLayer(`${LAYERS}/Incorporated_Places_Boundaries/FeatureServer/0`),
    ]);
    const shapes: GeoStateData["shapes"] = [];
    const regions = new Map<string, "county" | "place">();
    for (const [features, kind] of [[counties, "county"], [cities, "place"]] as const)
      for (const f of features) {
        const raw = String(f.attributes.Region_Code ?? "").trim();
        const code = PLACE_CODES[raw] ?? raw;
        if (!code) continue;
        regions.set(code, kind);
        shapes.push({ kind, fips: code, name: String(f.attributes.Name ?? f.attributes.Description ?? code), rings: f.rings, bbox: bboxOf(f.rings) });
      }

    const rates: GeoRateRow[] = [
      { type: "45", code: "04", rate: STATE, startsOn: FIRST_TABLE, endsOn: "9999-12-31" },
    ];
    for (const [code, rows] of byRegion) {
      const kind = regions.get(code);
      if (!kind) continue;
      rows.sort((a, b) => a.from.localeCompare(b.from));
      rows.forEach((r, i) => {
        const next = rows[i + 1]?.from;
        const to = next && next <= r.to ? shiftDay(next, -1) : r.to;
        rates.push({
          type: kind === "county" ? "00" : "01",
          code,
          rate: Math.round((kind === "county" ? r.rate - STATE : r.rate) * 1e6) / 1e6,
          startsOn: r.from,
          endsOn: to,
        });
      });
    }
    return {
      rates,
      shapes,
      files: { rates: `AZ ${latest.replace(".csv", "")} and earlier from ${FIRST_TABLE}`, boundaries: "AZGeo county regions and incorporated places" },
    };
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

