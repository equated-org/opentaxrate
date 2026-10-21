/**
 * Texas, from the Comptroller: state 6.25% plus the local taxes of the city,
 * county, transit authorities and special purpose districts (SPDs) the
 * address falls in, every one keyed by its taxing authority ID (TAID).
 *
 *   - Rates: each quarter's EDI rate file (from 2022 Q3), and the current
 *     quarter's city rate spreadsheet, which is newer than the EDI file.
 *   - Outlines: the Comptroller's sales tax boundary layers, which follow
 *     annexation dates rather than the Census's city limits.
 *
 * Local tax is capped at 2%, so a district's rate can be lower inside a city
 * than outside it, and where a city and a district would pass the cap the
 * Comptroller draws a combined area with its own TAID and rate. So each city
 * and combined area is an exclusive area: the rate files' lines for it list
 * every county, district and transit authority that still applies inside
 * it, at the rate it applies there (its "kx" rows). Outside every city, each
 * jurisdiction has its own rate, from the unincorporated lines and the
 * Comptroller's special district list.
 */
import type { GeoRateRow, GeoState, GeoStateData } from "./index.js";
import { bboxOf, fetchFile, fetchLayer, fetchText, readXlsx, shiftDay } from "./sources.js";

const COMPTROLLER = "https://comptroller.texas.gov";
const LAYERS =
  "https://services.arcgis.com/8BKVd7DzccTE7TwW/arcgis/rest/services/Sales_Tax_Boundaries/FeatureServer";
const FIRST_QUARTER = { year: 2022, quarter: 3 };

const TAID = /^\d{7}$/;

export const texas: GeoState = {
  state: "TX",
  async fetch(dir) {
    const quarters = await quarterLines(dir);
    const sheet = readXlsx(
      await fetchFile(`${COMPTROLLER}/taxes/sales/docs/city-rates.xlsx`, dir),
    );
    const [sheetName, rows] = [...sheet][0];
    const current = currentQuarterOf(sheetName);
    // A row whose rates don't add up to its own total has a typo somewhere:
    // in a rate (the Q4 2026 sheet gives unincorporated Winkler County 5%
    // for 0.5%) or in the total (Sandy Point's). Its rates are taken from the
    // last quarter's file where that file has them.
    const previous = [...quarters.values()].at(-1) ?? [];
    const before = new Map<string, number>();
    for (const line of previous) {
      const lead = line[0] && /^[26]/.test(line[0][0]) ? line[0][0] : "";
      for (const [id, rate] of line) before.set(`${lead}>${id}`, rate);
    }
    const lines: Line[] = [];
    for (const row of rows.slice(1)) {
      let ids: Line = [];
      for (let i = 1; i + 1 < row.length && i < 21; i += 3) {
        const id = row[i].trim();
        if (TAID.test(id)) ids.push([id, round(Number(row[i + 1]))]);
      }
      const total = round(0.0625 + ids.reduce((sum, [, r]) => sum + r, 0));
      if (Math.abs(total - round(Number(row[21]))) > 1e-6) {
        const lead = ids[0] && /^[26]/.test(ids[0][0]) ? ids[0][0] : "";
        ids = ids.map(([id, rate]) => [id, before.get(`${lead}>${id}`) ?? rate]);
        console.warn(`TX: ${row[0].trim() || row[3].trim()} adds to ${total}, not its ${Number(row[21])}; last quarter's rates used`);
      }
      lines.push(ids);
    }
    // Districts outside cities, at their full rate this quarter.
    const spdPage = await fetchText(`${COMPTROLLER}/taxes/sales/spd.php`, dir, "spd.php");
    for (const [, id, rate] of spdPage.matchAll(
      /<td[^>]*>\s*(5\d{6})\s*<\/td>\s*<td[^>]*>\s*([\d.]+)\s*<\/td>/g,
    ))
      lines.push([[id, round(Number(rate))]]);
    quarters.set(current.start, lines);

    const layer = async (n: number) => fetchLayer(`${LAYERS}/${n}`, { pageSize: 500 });
    const [cities, combos, transits, spds, counties] = await Promise.all([1, 2, 3, 4, 5].map(layer));
    const shapes: GeoStateData["shapes"] = [];
    const typeOf = new Map<string, string>();
    const add = (
      features: Awaited<ReturnType<typeof layer>>,
      kind: "county" | "place" | "district",
      type: string,
      name: (a: Record<string, unknown>) => string,
    ) => {
      for (const f of features) {
        const id = String(f.attributes.TAID ?? "");
        if (!TAID.test(id) || f.attributes.Collects_Tax === "No") continue;
        typeOf.set(id, type);
        shapes.push({ kind, fips: id, name: name(f.attributes).trim(), rings: f.rings, bbox: bboxOf(f.rings) });
      }
    };
    add(counties, "county", "00", (a) => `${a.CNTY_NM} County`);
    add(cities, "place", "x", (a) => String(a.City_Name));
    add(combos, "district", "x", (a) => String(a.Name));
    add(transits, "district", "transit", (a) => String(a.Transit_Name));
    add(spds, "district", "spd", (a) => String(a.SPD_Name));

    return {
      rates: [
        // Coverage starts with the first quarter's file.
        { type: "45", code: "48", rate: 0.0625, startsOn: quarterStart(FIRST_QUARTER.year, FIRST_QUARTER.quarter), endsOn: "9999-12-31" },
        ...spans(quarters, typeOf),
      ],
      shapes,
      files: {
        rates: `TX ${sheetName} city rates + SPD list + EDI rates from ${FIRST_QUARTER.year} Q${FIRST_QUARTER.quarter}`,
        boundaries: `TX Sales_Tax_Boundaries ${current.label}`,
      },
    };
  },
};

/** One rate file line: the TAIDs in force at one locality, with their rates
 *  there. A line led by a city or combined area (2… or 6…) is inside it. */
type Line = Array<[string, number]>;

/** Each quarter's lines from the EDI files, by the quarter's first day. */
async function quarterLines(dir?: string) {
  const quarters = new Map<string, Line[]>();
  for (let { year, quarter } = FIRST_QUARTER; ; ) {
    const name = `taxrates${String(year).slice(2)}${quarter}.txt`;
    let text: string;
    try {
      text = await fetchText(`${COMPTROLLER}/data/edi/sales-tax/${name}`, dir);
    } catch (error) {
      // The quarter after the newest file isn't published; anything else is
      // a failure, not the end of the history.
      if (/answered 404/.test((error as Error).message)) break;
      throw error;
    }
    quarters.set(quarterStart(year, quarter), ediLines(text));
    [year, quarter] = quarter === 4 ? [year + 1, 1] : [year, quarter + 1];
  }
  // The undated file is the newest quarter the EDI service has published.
  const latest = await fetchText(`${COMPTROLLER}/data/edi/sales-tax/taxrates.txt`, dir);
  const header = /^\d+\t(\d{4})(\d)\t/.exec(latest);
  if (header) quarters.set(quarterStart(Number(header[1]), Number(header[2])), ediLines(latest));
  return quarters;
}

function ediLines(text: string): Line[] {
  return text.split(/\r?\n/).map((line) => {
    const c = line.split("\t");
    const ids: Line = [];
    for (let i = 1; i + 1 < c.length; i += 3) {
      const id = c[i]?.trim();
      if (TAID.test(id) && !id.startsWith("1")) ids.push([id, round(Number(c[i + 1]))]);
    }
    return ids;
  });
}

/** Every rate the quarters' lines give, as spans of the quarters it held:
 *  a jurisdiction's own rate from lines outside any city, and each city's or
 *  combined area's kept rates from its own lines. The newest is open-ended. */
function spans(quarters: Map<string, Line[]>, typeOf: Map<string, string>): GeoRateRow[] {
  const byQuarter = new Map<string, Map<string, { type: string; code: string; rate: number }>>();
  for (const [start, lines] of quarters) {
    const rates = new Map<string, { type: string; code: string; rate: number }>();
    const put = (type: string, code: string, rate: number) => {
      const key = `${type}:${code}`;
      if (!rates.has(key)) rates.set(key, { type, code, rate });
    };
    for (const line of lines) {
      const [lead, ...rest] = line;
      if (lead && /^[26]/.test(lead[0])) {
        put("x", lead[0], lead[1]);
        for (const [id, rate] of rest) put("kx", `${lead[0]}>${id}`, rate);
      } else for (const [id, rate] of line) put(typeOf.get(id) ?? defaultType(id), id, rate);
    }
    // A county or transit authority has the same rate wherever it applies,
    // and rarely a line of its own outside cities; its rate there is the one
    // most lines give it, which also outvotes a typo in any one line.
    const seen = new Map<string, Map<number, number>>();
    for (const r of rates.values()) {
      const id = r.type === "kx" ? r.code.split(">")[1] : r.code;
      if (!/^[34]/.test(id)) continue;
      const counts = seen.get(id) ?? new Map<number, number>();
      counts.set(r.rate, (counts.get(r.rate) ?? 0) + 1);
      seen.set(id, counts);
    }
    for (const [id, counts] of seen) {
      const [rate] = [...counts].sort((a, b) => b[1] - a[1])[0];
      const type = typeOf.get(id) ?? defaultType(id);
      rates.set(`${type}:${id}`, { type, code: id, rate });
    }
    byQuarter.set(start, rates);
  }
  const starts = [...byQuarter.keys()].sort();
  const keys = new Set([...byQuarter.values()].flatMap((q) => [...q.keys()]));
  const rows: GeoRateRow[] = [];
  for (const key of keys) {
    let open: { type: string; code: string; rate: number; start: string } | null = null;
    starts.forEach((start, i) => {
      const found = byQuarter.get(start)!.get(key);
      if (open && found?.rate !== open.rate) {
        rows.push({ type: open.type, code: open.code, rate: open.rate, startsOn: open.start, endsOn: shiftDay(start, -1) });
        open = null;
      }
      if (found && !open) open = { ...found, start };
      if (open && i === starts.length - 1)
        rows.push({ type: open.type, code: open.code, rate: open.rate, startsOn: open.start, endsOn: "9999-12-31" });
    });
  }
  return rows;
}

const defaultType = (id: string) =>
  id.startsWith("4") ? "00" : id.startsWith("3") ? "transit" : "spd";

/** The spreadsheet's sheet is named for its quarter's first month, "Oct26". */
function currentQuarterOf(sheetName: string) {
  const m = /^([A-Za-z]{3})(\d{2})$/.exec(sheetName.trim());
  if (!m) throw new Error(`Texas city rates sheet "${sheetName}" names no quarter`);
  const month = ["jan", "apr", "jul", "oct"].indexOf(m[1].toLowerCase());
  if (month < 0) throw new Error(`Texas city rates sheet "${sheetName}" isn't a quarter`);
  const year = 2000 + Number(m[2]);
  return { start: quarterStart(year, month + 1), label: `${year} Q${month + 1}` };
}

const quarterStart = (year: number, quarter: number) =>
  `${year}-${String((quarter - 1) * 3 + 1).padStart(2, "0")}-01`;


const round = (n: number) => Math.round(n * 1e6) / 1e6;
