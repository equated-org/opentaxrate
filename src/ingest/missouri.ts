/**
 * Missouri, from the Department of Revenue's quarterly rate and boundary
 * files. The boundary file has the Streamlined layout (street ranges,
 * ZIP+4 and ZIP rows) and names each row's jurisdiction code: place FIPS,
 * county FIPS, then which combination of special districts (community
 * improvement, transportation development, fire, ambulance and others,
 * hundreds of them too small for any outline). The DOR publishes each code's
 * whole sales tax rate, which is used as one rate rather than added from its
 * parts, since the parts don't always add up to it.
 *
 * Rates come from the last eight quarters' files, back to the first one
 * missing; coverage starts with the oldest quarter loaded.
 */
import fs from "node:fs";
import path from "node:path";
import { parseBoundaryLine, type BoundaryRow } from "./sst-files.js";
import { fetchFile, readXlsx } from "./states/sources.js";
import { sstFileLines } from "./downloads.js";
import { WHOLE_CODE_TYPE } from "../coverage.js";
import type { StateFiles } from "./load.js";

const DOCUMENTS = "https://dor.mo.gov/taxation/business/tax-types/sales-use/documents";
const STATE_RATE = 0.04225;
const QUARTERS = 8;

const JURISDICTION = /\b(\d{5}-\d{3}-\d{3})\b/;

/** Cities the DOR numbers differently from the Census, which outlines them
 *  under its own place code (matched by name and county). Without the
 *  Census code a split ZIP holding one of these can't be settled on the map.
 *  The DOR's codes a few above a city's (31277, 31278 for Hazelwood) are
 *  parts of that city with their own districts and stay as they are. */
const CENSUS_PLACE: Record<string, string> = {
  "04240": "04248", // Bellerive Acres
  "16858": "16802", // Country Club
  "19342": "19378", // De Witt
  "24112": "24120", // Fidelity
  "24670": "24688", // Flint Hill
  "29098": "29116", // Green Castle
  "29944": "29962", // Halfway
  "35432": "35450", // Iron Mountain Lake
  "40178": "40043", // Lake St. Louis
  "41330": "41348", // Lee's Summit
  "53444": "53454", // Norwood
  "53606": "53650", // Oak Grove Village
  "64352": "64180", // Ste. Genevieve
  "64514": "64478", // St. John
  "65054": "65034", // St. Mary
  "73960": "73978", // Truesdale
  "80908": "80767", // Wood Heights
};

export async function missouriFiles(dir?: string): Promise<StateFiles> {
  const quarters = recentQuarters(new Date(), QUARTERS + 2);
  const rateLines: string[] = [];
  let oldest: string | null = null;
  let newestBoundary: string | null = null;
  const loaded: string[] = [];
  for (const q of quarters) {
    let bytes: Uint8Array;
    try {
      bytes = await fetchFile(`${DOCUMENTS}/dor-jurisdiction-total-rate-q${q.quarter}-${q.year}.xlsx`, dir);
    } catch (error) {
      // The next quarter may not be out yet; past that, a missing quarter
      // ends the history rather than leaving a gap with no local rates.
      if (!loaded.length && /answered 404/.test((error as Error).message)) continue;
      if (/answered 404/.test((error as Error).message)) break;
      throw error;
    }
    newestBoundary ??= `dor-boundary-database-q${q.quarter}-${q.year}.csv`;
    loaded.push(`q${q.quarter}-${q.year}`);
    oldest = q.start;
    const [rows] = [...readXlsx(bytes).values()];
    const header = rows.findIndex((r) => r.some((c) => /jurisdiction code/i.test(c)));
    const codeAt = header < 0 ? -1 : rows[header].findIndex((c) => /jurisdiction code/i.test(c));
    const salesAt = header < 0 ? -1 : rows[header].findIndex((c) => /^sales( tax rate)?$/i.test(c.trim()));
    if (header < 0 || codeAt < 0 || salesAt < 0)
      throw new Error(`Missouri rate file q${q.quarter}-${q.year} has no jurisdiction code or sales column`);
    for (const row of rows.slice(header + 1)) {
      const code = row[codeAt]?.trim();
      const total = rate(row[salesAt]);
      if (!code || !JURISDICTION.test(code) || total === null) continue;
      const local = Math.round((total - STATE_RATE) * 1e6) / 1e6;
      // The DOR publishes only the general total; Missouri's state food rate
      // is lower, so the food and interstate columns are left blank.
      rateLines.push(`29,${WHOLE_CODE_TYPE},${code},${local},,,,${q.start.replaceAll("-", "")},${q.end.replaceAll("-", "")}`);
    }
    if (loaded.length === QUARTERS) break;
  }
  if (!oldest || !newestBoundary) throw new Error("No Missouri rate file found");
  rateLines.push(`29,45,29,${STATE_RATE},,,,${oldest.replaceAll("-", "")},99991231`);
  // The newest quarter's rates run on until the next file says otherwise.
  const newest = quarters.find((q) => `q${q.quarter}-${q.year}` === loaded[0])!;
  for (let i = 0; i < rateLines.length; i++)
    rateLines[i] = rateLines[i].replace(new RegExp(`,${newest.end.replaceAll("-", "")}$`), ",99991231");

  return {
    state: "MO",
    rates: { name: `MO total rates ${loaded.at(-1)} to ${loaded[0]}`, lines: rateLines },
    boundaries: {
      name: newestBoundary.replace(/\.csv$/, ""),
      lines: sstFileLines({
        state: "MO",
        kind: "boundaries",
        name: newestBoundary,
        location:
          dir && fs.existsSync(path.join(dir, newestBoundary))
            ? path.join(dir, newestBoundary)
            : `${DOCUMENTS}/${newestBoundary}`,
      }),
    },
    parseBoundary: (line) => {
      const code = JURISDICTION.exec(line)?.[1];
      if (!code) return [];
      // The code's place and county let the map settle a split ZIP; its rate
      // is still the code's own, since neither has a rate row.
      const [place, county] = code.split("-");
      return parseBoundaryLine(line).map(
        (row): BoundaryRow => ({
          ...row,
          area: { county, place: place === "00000" ? null : (CENSUS_PLACE[place] ?? place), districts: `${WHOLE_CODE_TYPE}:${code}`, reportingCode: code },
        }),
      );
    },
  };
}

/** "9.6790%", 0.10679 and 8.97E-2 all read as a decimal rate. */
function rate(cell: string | undefined) {
  if (!cell?.trim()) return null;
  const text = cell.trim();
  const n = Number(text.replace("%", ""));
  if (!Number.isFinite(n)) return null;
  return text.endsWith("%") || n > 1 ? n / 100 : n;
}

function recentQuarters(today: Date, count: number) {
  const out: Array<{ year: number; quarter: number; start: string; end: string }> = [];
  let year = today.getUTCFullYear();
  let quarter = Math.floor(today.getUTCMonth() / 3) + 1;
  // A quarter's file is published before it starts.
  [year, quarter] = quarter === 4 ? [year + 1, 1] : [year, quarter + 1];
  for (let i = 0; i < count; i++) {
    const startMonth = (quarter - 1) * 3 + 1;
    const end = new Date(Date.UTC(year, startMonth + 2, 0)).toISOString().slice(0, 10);
    out.push({ year, quarter, start: `${year}-${String(startMonth).padStart(2, "0")}-01`, end });
    [year, quarter] = quarter === 1 ? [year - 1, 4] : [year, quarter - 1];
  }
  return out;
}
