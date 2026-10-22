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
 *
 * Each rate's jurisdiction keeps its name and ids from the boundary layer
 * that outlines it (TAID, and the layer's SPD_Type, Transit_Type,
 * CMPTRL_CNTY_NBR or FIPS_ST_CNTY_CD), else its name from the newest EDI
 * file; a kept rate inside a city takes the kept authority's.
 */
import type { GeoRateRow, GeoState, GeoStateData, JurisdictionRow } from "./index.js";
import { bboxOf, fetchFile, fetchLayer, fetchText, readXlsx, shiftDay } from "./sources.js";
import { contains, type Point } from "../tiger.js";

const COMPTROLLER = "https://comptroller.texas.gov";
const LAYERS =
  "https://services.arcgis.com/8BKVd7DzccTE7TwW/arcgis/rest/services/Sales_Tax_Boundaries/FeatureServer";
const FIRST_QUARTER = { year: 2022, quarter: 3 };

const TAID = /^\d{7}$/;

export const texas: GeoState = {
  state: "TX",
  async fetch(dir) {
    const { quarters, leadByName, nameById } = await quarterLines(dir);
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
    const names: string[] = [];
    for (const row of rows.slice(1)) {
      names.push(row[0].trim());
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
    /** Each TAID's name and ids, as its layer gives them. */
    const about = new Map<string, Omit<JurisdictionRow, "type" | "code">>();
    const add = (
      features: Awaited<ReturnType<typeof layer>>,
      kind: "county" | "place" | "district",
      type: string,
      name: (a: Record<string, unknown>) => string,
      nameField: string,
      idFields: string[] = [],
    ) => {
      for (const f of features) {
        const id = String(f.attributes.TAID ?? "");
        if (!TAID.test(id) || f.attributes.Collects_Tax === "No") continue;
        typeOf.set(id, type);
        shapes.push({ kind, fips: id, name: name(f.attributes).trim(), rings: f.rings, bbox: bboxOf(f.rings) });
        const ids: Record<string, string> = { TAID: id };
        for (const field of idFields) {
          const value = f.attributes[field];
          if (value != null && String(value).trim()) ids[field] = String(value).trim();
        }
        about.set(id, { name: String(f.attributes[nameField] ?? "").trim() || null, ids });
      }
    };
    add(counties, "county", "00", (a) => `${a.CNTY_NM} County`, "CNTY_NM", ["CMPTRL_CNTY_NBR", "FIPS_ST_CNTY_CD"]);
    add(cities, "place", "x", (a) => String(a.City_Name), "City_Name");
    add(combos, "district", "x", (a) => String(a.Name), "Name");
    add(transits, "district", "transit", (a) => String(a.Transit_Name), "Transit_Name", ["Transit_Type"]);
    add(spds, "district", "spd", (a) => String(a.SPD_Name), "SPD_Name", ["SPD_Type"]);

    // A sheet row whose city's TAID has no outline is mistyped where the
    // newest EDI file has a line of the same name under a TAID that has one
    // (the Q4 2026 sheet gives Pine Island 2237067; its outline, its EDI
    // lines and the Comptroller's lookup all have 2237069).
    lines.forEach((line, i) => {
      const lead = line[0]?.[0];
      if (!lead || !/^[26]/.test(lead) || typeOf.has(lead) || !names[i]) return;
      const known = leadByName.get(names[i].toLowerCase());
      if (!known || !typeOf.has(known)) return;
      console.warn(`TX: ${names[i]} is ${lead} in the city rate sheet but ${known} in its outline and the EDI file; ${known} used`);
      line[0] = [known, line[0][1]];
    });

    const rates = spans(quarters, typeOf);
    const all: GeoRateRow[] = [
      // Coverage starts with the first quarter's file.
      { type: "45", code: "48", rate: 0.0625, startsOn: quarterStart(FIRST_QUARTER.year, FIRST_QUARTER.quarter), endsOn: "9999-12-31" },
      ...rates,
      ...districtsInCities(rates, shapes),
    ];
    const jurisdictions = new Map<string, JurisdictionRow>();
    for (const r of all) {
      if (r.type === "45") continue;
      // A kept rate inside a city is the kept authority's.
      const id = r.code.split(">").pop()!;
      const known = about.get(id) ?? { name: nameById.get(id) ?? null, ids: { TAID: id } };
      jurisdictions.set(`${r.type}:${r.code}`, { type: r.type, code: r.code, ...known });
    }
    return {
      rates: all,
      jurisdictions: [...jurisdictions.values()],
      shapes,
      files: {
        rates: `TX ${sheetName} city rates + SPD list + EDI rates from ${FIRST_QUARTER.year} Q${FIRST_QUARTER.quarter}`,
        boundaries: `TX Sales_Tax_Boundaries ${current.label}`,
      },
      boundariesFrom: current.start,
      // Districts outside cities come from the current quarter's list only.
      ratesFirstListed: current.start,
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
  // Each city's or combined area's TAID by the name its line leads with,
  // and every TAID's name: a line is (name, TAID, rate) triples.
  const leadByName = new Map<string, string>();
  const nameById = new Map<string, string>();
  for (const line of latest.split(/\r?\n/)) {
    const c = line.split("\t");
    const id = c[1]?.trim();
    if (id && TAID.test(id) && /^[26]/.test(id)) leadByName.set(c[0].trim().toLowerCase(), id);
    for (let i = 1; i + 1 < c.length; i += 3) {
      const taid = c[i]?.trim();
      if (TAID.test(taid) && c[i - 1]?.trim()) nameById.set(taid, c[i - 1].trim());
    }
  }
  return { quarters, leadByName, nameById };
}

/** The local tax cap: a city's, county's, transit authority's and
 *  districts' rates together. */
const CAP = 0.02;
/** Points a side of the grid that looks for where a city and a district
 *  overlap. */
const GRID = 16;
/** The least overlap, in square kilometres, taken as a district inside a
 *  city rather than outlines that disagree along an edge. */
const MIN_KM2 = 1;

/**
 * Kept rows for districts drawn inside a city that its rate file line
 * doesn't list. Each city has one line, so a district covering only part of
 * it is in none (El Paso County ESD 2 across Fort Bliss, inside El Paso but
 * outside its transit authority), yet the Comptroller's lookup adds every
 * TAID whose outline holds the point. A row is added, at the district's rate
 * outside cities, where a grid over the two outlines finds them overlapping
 * across at least a square kilometre, and at every point of it the city's rate, the kept
 * rates whose outlines hold it and the district's stay within the cap. Past
 * the cap the Comptroller would have drawn a combined area, and its lookup
 * gives no rate, so none is added. The row counts only inside the district's
 * outline (see rates/map.ts).
 */
function districtsInCities(rates: GeoRateRow[], shapes: GeoStateData["shapes"]): GeoRateRow[] {
  const byId = new Map<string, GeoStateData["shapes"]>();
  for (const s of shapes) byId.set(s.fips, [...(byId.get(s.fips) ?? []), s]);
  const boxOf = (id: string) => {
    const all = byId.get(id) ?? [];
    if (!all.length) return null;
    return all.reduce<[number, number, number, number]>(
      (b, s) => [Math.min(b[0], s.bbox[0]), Math.min(b[1], s.bbox[1]), Math.max(b[2], s.bbox[2]), Math.max(b[3], s.bbox[3])],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
  };
  const holds = (id: string, p: Point) =>
    (byId.get(id) ?? []).some((s) => p.lon >= s.bbox[0] && p.lon <= s.bbox[2] && p.lat >= s.bbox[1] && p.lat <= s.bbox[3] && contains(s, p));
  const kept = new Map<string, GeoRateRow[]>();
  for (const r of rates) if (r.type === "kx") kept.set(r.code.split(">")[0], [...(kept.get(r.code.split(">")[0]) ?? []), r]);
  const overlap = (a: GeoRateRow, b: GeoRateRow) => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;
  const rows: GeoRateRow[] = [];
  const cities = rates.filter((r) => r.type === "x" && r.code.startsWith("2"));
  const districts = rates.filter((r) => r.type === "spd");
  for (const city of cities) {
    const c = boxOf(city.code);
    if (!c) continue;
    for (const spd of districts) {
      const d = boxOf(spd.code);
      if (!d || !overlap(city, spd) || c[0] > d[2] || d[0] > c[2] || c[1] > d[3] || d[1] > c[3]) continue;
      const own = (kept.get(city.code) ?? []).filter((k) => overlap(k, city) && overlap(k, spd));
      if (own.some((k) => k.code.endsWith(`>${spd.code}`))) continue;
      if (city.rate + spd.rate > CAP + 1e-9) continue;
      const [w, s, e, n] = [Math.max(c[0], d[0]), Math.max(c[1], d[1]), Math.min(c[2], d[2]), Math.min(c[3], d[3])];
      let shared = 0;
      let overCap = false;
      for (let i = 0; i < GRID && !overCap; i++)
        for (let j = 0; j < GRID && !overCap; j++) {
          const p = { lon: w + ((i + 0.5) * (e - w)) / GRID, lat: s + ((j + 0.5) * (n - s)) / GRID };
          if (!holds(spd.code, p) || !holds(city.code, p)) continue;
          shared++;
          const local = city.rate + spd.rate + own.filter((k) => holds(k.code.split(">")[1], p)).reduce((sum, k) => sum + k.rate, 0);
          if (local > CAP + 1e-9) overCap = true;
        }
      // A sliver where two outlines' edges disagree isn't a district inside
      // the city; the Comptroller's lookup adds nothing there.
      const km2 = ((e - w) * 111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180) * (n - s) * 110.54 * shared) / GRID ** 2;
      if (overCap || shared < 2 || km2 < MIN_KM2) continue;
      rows.push({
        type: "kx",
        code: `${city.code}>${spd.code}`,
        rate: spd.rate,
        startsOn: city.startsOn > spd.startsOn ? city.startsOn : spd.startsOn,
        endsOn: city.endsOn < spd.endsOn ? city.endsOn : spd.endsOn,
      });
    }
  }
  return rows;
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
