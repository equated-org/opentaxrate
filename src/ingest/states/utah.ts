/**
 * Utah's restaurant tax as a class rate. Utah is a Streamlined member, so
 * its general rates come from the Streamlined files (sst-files.ts); the
 * county restaurant tax isn't in them. The Tax Commission's quarterly rate
 * chart (<yy>q<n>simple.xlsx, sheet "Simplified") gives each location's
 * combined rate and its "Prepared Food (Restaurant)" rate, and says the
 * restaurant tax is "in addition to the combined rate". So, for the
 * chart's quarter, each part's restaurant rate is its general rate, and a
 * county's part also carries the difference between the two columns: the
 * county's restaurant tax, which must be the same at every location in the
 * county (else the county gets none, and its restaurant sales go
 * unresearched). The chart read is the one for the quarter of the
 * Streamlined rate file loaded, and its rows end with that quarter.
 */
import type { ClassRateRow, ClassRateSource } from "../class-rates.js";
import { fetchFile, readXlsx, shiftDay } from "./sources.js";

const CHARTS = "https://files.tax.utah.gov/tax/salestax/rate";

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export const utahClasses: ClassRateSource = {
  state: "UT",
  async fetch(dir, loaded) {
    const quarter = /^UTR(\d{2})(\d{2})Q(\d)/.exec(loaded.ratesFile ?? "");
    if (!quarter) throw new Error(`UT: no Streamlined rate file loaded to read the rate chart for (${loaded.ratesFile})`);
    const name = `${quarter[2]}q${quarter[3]}simple.xlsx`;
    const sheet = readXlsx(await fetchFile(`${CHARTS}/${name}`, dir)).get("Simplified");
    if (!sheet) throw new Error(`UT: ${name} has no Simplified sheet`);
    const header = sheet.flat().find((c) => /^Rates In effect as of /i.test(c)) ?? "";
    const day = /as of (\w+) (\d{1,2}), (\d{4})/i.exec(header);
    const month = day ? MONTHS.indexOf(day[1].toLowerCase()) : -1;
    if (!day || month < 0) throw new Error(`UT: ${name} doesn't say when its rates are in effect`);
    const from = `${day[3]}-${String(month + 1).padStart(2, "0")}-${day[2].padStart(2, "0")}`;
    const year = Number(`${quarter[1]}${quarter[2]}`);
    const q = Number(quarter[3]);
    const quarterStart = `${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
    if (from !== quarterStart) throw new Error(`UT: ${name} is in effect from ${from}, not its quarter's ${quarterStart}`);
    const to = shiftDay(q === 4 ? `${year + 1}-01-01` : `${year}-${String(q * 3 + 1).padStart(2, "0")}-01`, -1);

    // Each county's restaurant tax: restaurant less combined, everywhere in it.
    const header9 = sheet.findIndex((r) => r[0] === "Location" && r.some((c) => /Restaurant/.test(c)));
    const columns = sheet[header9 - 1] ?? [];
    const combinedAt = columns.findIndex((c) => /Combined/i.test(c));
    const restaurantAt = sheet[header9].findIndex((c) => /Restaurant/.test(c));
    if (header9 < 0 || combinedAt < 0 || restaurantAt < 0) throw new Error(`UT: ${name}'s Simplified sheet has no combined and restaurant columns`);
    const deltas = new Map<number, Set<number>>();
    for (const r of sheet) {
      const at = /^(\d\d)-\d\d\d$/.exec(r[2] ?? "");
      const combined = Number(r[combinedAt]);
      const restaurant = Number(r[restaurantAt]);
      if (!at || r[combinedAt] === "" || r[restaurantAt] === "" || !Number.isFinite(combined) || !Number.isFinite(restaurant)) continue;
      const county = Number(at[1]);
      deltas.set(county, new Set([...(deltas.get(county) ?? []), Math.round((restaurant - combined) * 1e6) / 1e6]));
    }
    // The county rows ("18-000 Salt Lake County"), numbered in name order.
    const countyNames = sheet.filter((r) => /^\d\d-000$/.test(r[2] ?? "") && /County$/.test(r[0])).map((r) => [Number(r[2].slice(0, 2)), r[0]] as const);
    const named = [...new Map(countyNames)].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
    if (named.join("|") !== [...named].sort().join("|")) throw new Error(`UT: ${name}'s county numbers aren't in name order`);
    const restaurantTax = new Map<string, number>();
    for (const [county, found] of deltas) {
      // Utah numbers its counties alphabetically, as their FIPS codes run: 2n - 1.
      const fips = String(county * 2 - 1).padStart(3, "0");
      if (found.size === 1) restaurantTax.set(fips, [...found][0]);
      else console.warn(`UT: county ${county} has restaurant taxes ${[...found].join(", ")} at different locations; no restaurant rate there`);
    }

    const rows: ClassRateRow[] = [];
    const source = `UT ${name.replace(".xlsx", "")} Prepared Food (Restaurant) less Combined Sales and Use, on the county`;
    for (const r of loaded.rates) {
      if (r.endsOn < from || r.startsOn > to) continue;
      const extra = r.type === "00" ? restaurantTax.get(r.code) : 0;
      if (extra === undefined) continue;
      rows.push({ type: r.type, code: r.code, class: "restaurant", rate: Math.round((r.rate + extra) * 1e6) / 1e6, startsOn: r.startsOn < from ? from : r.startsOn, endsOn: r.endsOn > to ? to : r.endsOn, source });
    }
    const counties = loaded.rates.filter((r) => r.type === "00").map((r) => r.code);
    const missing = [...new Set(counties)].filter((c) => !restaurantTax.has(c));
    if (missing.length) console.warn(`UT: no restaurant tax read for counties ${missing.join(", ")}`);
    return { rows, file: `UT ${name} (Prepared Food (Restaurant))` };
  },
};
