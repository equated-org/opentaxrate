/**
 * Alabama, from the Department of Revenue's rate file (every county and
 * city, state- and self-administered alike, with active and inactive
 * dates): 4% state, plus the county's rate, plus the city's inside its
 * limits.
 *
 * A county with more than one general code taxes differently inside named
 * cities, outside them, and in their police jurisdictions. Where each code
 * applies is from ALDOR's "City and County Rate and Code Explanations" page
 * (COUNTY_RULES, by locality code): the county's rate outside every named
 * city is its base (00) row; inside a named city, the difference from it
 * (0c); and where a police jurisdiction's county rate differs, the city
 * gets a police jurisdiction (pj) row, so an address within its reach is
 * refused. A county with a code no rule names is refused outright ("no"),
 * as is anything else the file can't place without outlines it doesn't
 * have:
 *   - an address outside a city but within three miles of it, where the
 *     city's police jurisdiction may tax at half its rate.
 * Codes for abated businesses ("unabated") don't apply to general sales.
 *
 * Each rate keeps the file's Locality Code, County Number and Administered
 * (who collects it: STATE, SELF or a private collector) as its ids, and its
 * Locality Name as its name; a county rate summed from several codes lists
 * each.
 */
import type { LocalRate } from "./tables.js";
import { stateTable } from "./tables.js";
import { fetchText, isoDay, shiftDay } from "./sources.js";

const FILE = "https://www.revenue.alabama.gov/wp-content/uploads/2024/03/taxrates.csv";
const FROM = "2020-01-01";

/** Cities named by a rule: a list, every city in the file ("any"), or every
 *  city with a sales tax of its own ("levying"). For police jurisdictions,
 *  "any" and "levying" mean the cities ALDOR files under the county. */
type Cities = string[] | "any" | "levying";
interface CountyRule {
  /** Codes summed outside every named city and police jurisdiction. */
  outside: string[];
  /** Codes summed inside the corporate limits of each group's cities. */
  inside: Array<{ cities: Cities; codes: string[] }>;
  /** Codes summed outside the cities but inside their police jurisdiction. */
  pj?: Array<{ cities: Cities; codes: string[] }>;
  /** The outside codes are for unincorporated land, so a city ALDOR files
   *  under the county that no rule names (one incorporated since the
   *  explanations were written) is refused rather than given them. */
  uninc?: boolean;
}

/** ALDOR's county code explanations, as read on 2026-10-21. */
const COUNTY_RULES: Record<string, CountyRule> = {
  CALHOUN: {
    uninc: true,
    outside: ["7008"],
    inside: [{ cities: ["Oxford", "Anniston", "Ohatchee", "Jacksonville", "Piedmont", "Weaver", "Hobson City", "Glencoe", "Southside"], codes: ["7408"] }],
    pj: [
      { cities: ["Oxford", "Southside"], codes: ["7008"] },
      { cities: ["Glencoe", "Hobson City", "Weaver"], codes: ["7108"] },
      { cities: ["Anniston", "Jacksonville", "Piedmont"], codes: ["7208"] },
      { cities: ["Ohatchee"], codes: ["7308"] },
    ],
  },
  CHAMBERS: {
    uninc: true,
    outside: ["7109"],
    inside: [{ cities: ["LaFayette", "Valley", "Lanett", "Waverly", "Five Points"], codes: ["7009"] }],
    pj: [
      { cities: ["Lanett"], codes: ["7209"] },
      { cities: ["Valley"], codes: ["7309"] },
      { cities: ["LaFayette"], codes: ["7409"] },
      { cities: ["Waverly"], codes: ["7609"] },
      { cities: ["Five Points"], codes: ["7070"] },
      { cities: ["Wadley"], codes: ["7170"] },
    ],
  },
  CHILTON: { outside: ["7011"], inside: [{ cities: ["Clanton", "Jemison", "Maplesville", "Thorsby"], codes: ["7711"] }] },
  CULLMAN: { outside: ["7022"], inside: [{ cities: ["Arab"], codes: ["7122"] }], pj: [{ cities: ["Arab"], codes: ["7122"] }] },
  DALE: { outside: ["7023"], inside: [{ cities: ["Daleville", "Ozark"], codes: ["7723"] }] },
  ELMORE: {
    uninc: true,
    outside: ["7026", "7470"],
    inside: [
      { cities: ["Prattville"], codes: ["7726"] },
      { cities: ["Wetumpka"], codes: ["7026", "7471"] },
      { cities: ["Elmore"], codes: ["7026", "7478"] },
      { cities: ["Deatsville"], codes: ["7026", "7480"] },
      { cities: ["Eclectic", "Millbrook", "Tallassee", "Coosada"], codes: ["7026"] },
    ],
    pj: [
      { cities: ["Eclectic"], codes: ["7026", "7473"] },
      { cities: ["Elmore"], codes: ["7026", "7479"] },
      { cities: ["Millbrook"], codes: ["7026", "7475"] },
      { cities: ["Tallassee"], codes: ["7026", "7477"] },
    ],
  },
  ESCAMBIA: {
    outside: ["7727"],
    inside: [{ cities: ["Atmore", "Brewton", "East Brewton", "Flomaton", "Pollard", "Riverview"], codes: ["7027"] }],
    pj: [
      { cities: ["Atmore", "Brewton", "East Brewton", "Flomaton"], codes: ["7127"] },
      { cities: ["Riverview"], codes: ["7227"] },
    ],
  },
  LAUDERDALE: { outside: ["7039"], inside: [{ cities: ["Florence"], codes: ["7739"] }] },
  LEE: {
    outside: ["7041"],
    inside: [{ cities: ["Auburn", "Opelika", "Phenix City"], codes: ["7741"] }],
    pj: [
      { cities: ["Opelika"], codes: ["7141"] },
      { cities: ["Phenix City"], codes: ["7241"] },
    ],
  },
  MADISON: { outside: ["7045", "7745"], inside: [{ cities: ["Huntsville"], codes: ["7745"] }] },
  MARION: { outside: ["7047"], inside: [{ cities: ["Winfield"], codes: ["7747"] }] },
  MARSHALL: { outside: ["7048"], inside: [{ cities: ["Albertville", "Arab", "Boaz", "Guntersville"], codes: ["7748"] }] },
  MOBILE: { outside: ["7049"], inside: [{ cities: ["Prichard", "Mobile"], codes: ["7749"] }] },
  MORGAN: {
    uninc: true,
    outside: ["7052"],
    inside: [
      { cities: ["Priceville"], codes: ["7252"] },
      { cities: ["Somerville"], codes: ["7352"] },
      { cities: ["Eva"], codes: ["7452"] },
      { cities: ["Decatur", "Hartselle", "Falkville", "Trinity"], codes: ["7752"] },
    ],
  },
  PIKE: { outside: ["7055"], inside: [{ cities: ["Troy"], codes: ["7755"] }] },
  RUSSELL: {
    outside: ["7057"],
    inside: [{ cities: ["Hurtsboro", "Phenix City"], codes: ["7757"] }],
    pj: [{ cities: ["Hurtsboro", "Phenix City"], codes: ["7157"] }],
  },
  "ST CLAIR": { outside: ["7059"], inside: [{ cities: ["Pell City"], codes: ["7759"] }] },
  TALLADEGA: { outside: ["7061"], inside: [{ cities: "any", codes: ["7761"] }], pj: [{ cities: "any", codes: ["7161"] }] },
  TUSCALOOSA: { outside: ["7063"], inside: [{ cities: "levying", codes: ["7763"] }], pj: [{ cities: "levying", codes: ["7163"] }] },
};

/** A county code that applies across the whole county, beside its base. */
const COUNTYWIDE = /^[A-Z .']+ (?:COUNTY|CO)(?: SPECIAL REVENUE| EDUCATION| COUNTY-WIDE TAX)?$/;

interface CountyCode {
  name: string;
  /** The file's County Number. */
  countyNo: string;
  periods: Period[];
}

interface Period {
  rate: number;
  from: string;
  to?: string;
  /** The row's Administered column. */
  administered: string;
}

/** A row's ids, by the file's column names. */
const idsOf = (code: string, countyNo: string, administered: string) => ({
  "Locality Code": code,
  "County Number": countyNo,
  Administered: administered,
});

export const alabama = stateTable("AL", async (dir) => {
  const csv = await fetchText(FILE, dir, "taxrates.csv");
  const locals: LocalRate[] = [];
  /** County codes by county, then by locality code. */
  const countyCodes = new Map<string, Map<string, CountyCode>>();
  /** Each city's name as its rows give it, with ALDOR's county number. */
  const cities = new Map<string, { county: number; levies: boolean }>();
  const countyNames = new Map<number, string>();
  for (const line of csv.replace(/^﻿/, "").split(/\r?\n/).slice(1)) {
    const [code, name, countyNo, taxType, rateType, administered, active, inactive, rate, , pj, , pjRate] = line.split(",").map((c) => c.trim());
    if (taxType !== "ST" || rateType !== "GENER" || !code || !name) continue;
    const from = isoDay(active);
    if (!from) continue;
    const to = inactive ? (isoDay(inactive) ?? undefined) : undefined;
    if (to && to < FROM) continue;
    const dated = { from: from < FROM ? FROM : from, to };
    if (/^UNABA/.test(name)) continue;
    if (code.startsWith("7")) {
      const county = /^([A-Z .']+?) (?:COUNTY|CO)\b/.exec(name)?.[1];
      if (!county) continue;
      countyNames.set(Number(countyNo), county);
      const codes = countyCodes.get(county) ?? new Map();
      countyCodes.set(county, codes);
      const known = codes.get(code) ?? { name, countyNo, periods: [] };
      known.periods.push({ rate: Number(rate) / 100, ...dated, administered });
      codes.set(code, known);
    } else if (code.startsWith("9")) {
      // A district inside a town is listed like a town but has no outline.
      if (/ DIST$/.test(name)) continue;
      // "TALLASSEE WITHIN ELMORE CO": the city's rate in one of its counties.
      const within = / WITHIN ([A-Z ]+) CO$/.exec(name)?.[1];
      const inCounty = within ? titleCase(within) : undefined;
      const city = name.replace(/ (?:WITHIN [A-Z ]+ CO|S&U|SALES & USE|SALES)$/, "");
      const seen = cities.get(city);
      const levies = Number(rate) > 0 && (!to || to >= "2026-01-01");
      cities.set(city, { county: Number(countyNo), levies: Boolean(seen?.levies) || levies });
      const source = { title: name, ids: idsOf(code, countyNo, administered) };
      locals.push({ name: city, rate: Number(rate) / 100, ...dated, type: "01", inCounty, ...source });
      if (pj === "Y" && Number(pjRate) > 0)
        locals.push({ name: city, rate: Number(pjRate) / 100, ...dated, type: "pj", inCounty, ...source });
    }
  }

  const counties: LocalRate[] = [];
  for (const [county, codes] of countyCodes) {
    const rule = COUNTY_RULES[county];
    if (rule) {
      const named = new Set([...rule.outside, ...rule.inside.flatMap((g) => g.codes), ...(rule.pj ?? []).flatMap((g) => g.codes)]);
      const unnamed = [...codes].filter(([code, c]) => !named.has(code) && c.periods.some((p) => p.rate));
      if (unnamed.length) {
        console.warn(`AL: ${county} County has codes no rule names (${unnamed.map(([c]) => c).join(", ")}); refusing it`);
        counties.push({ name: county, rate: 0, from: FROM, type: "no" });
        continue;
      }
      counties.push(...ruleRows(county, rule, codes, cities, countyNames));
      continue;
    }
    // Without a rule, every code must apply countywide; they add up.
    if ([...codes.values()].every((c) => COUNTYWIDE.test(c.name)))
      counties.push(
        ...sumByCode(
          [...codes].flatMap(([code, c]) =>
            c.periods.map(({ administered, ...p }) => ({
              name: county,
              ...p,
              type: "00" as const,
              title: c.name,
              ids: idsOf(code, c.countyNo, administered),
            })),
          ),
        ),
      );
    else counties.push({ name: county, rate: 0, from: FROM, type: "no" });
  }
  return {
    stateRates: [{ rate: 0.04, from: FROM }],
    // A city listed once per county it spans has one rate.
    locals: sumByCode([...locals, ...counties]),
    source: "AL DOR local tax rates file",
    skipUnmatchedCities: true,
  };
});

/** A county's rows from its rule: its base outside every named city, each
 *  named city's difference from it, and a police jurisdiction row for each
 *  city whose police jurisdiction changes the county's rate. */
function ruleRows(
  county: string,
  rule: CountyRule,
  codes: Map<string, CountyCode>,
  cities: Map<string, { county: number; levies: boolean }>,
  countyNames: Map<number, string>,
): LocalRate[] {
  const days = [
    ...new Set([...codes.values()].flatMap((c) => c.periods.flatMap((p) => [p.from, p.to ? shiftDay(p.to, 1) : null])).filter(Boolean) as string[]),
  ].sort();
  /** The codes' summed rate on a day, or null when none is in effect. */
  const rateOn = (list: string[], day: string) => {
    const live = list.flatMap((code) => (codes.get(code)?.periods ?? []).filter((p) => p.from <= day && (!p.to || p.to >= day)));
    return live.length ? Math.round(live.reduce((sum, p) => sum + p.rate, 0) * 1e6) / 1e6 : null;
  };
  /** The names and ids of the codes in effect on a day, as a row's source. */
  const sourceOn = (list: string[], day: string) =>
    mergeSources(
      list.flatMap((code) => {
        const c = codes.get(code);
        const p = c?.periods.find((p) => p.from <= day && (!p.to || p.to >= day));
        return c && p ? [{ title: c.name, ids: idsOf(code, c.countyNo, p.administered) }] : [];
      }),
    );
  const countyNo = [...countyNames].find(([, name]) => name === county)?.[0];
  const named = (which: Cities, pj: boolean) =>
    Array.isArray(which)
      ? which
      : [...cities]
          .filter(([, c]) => (which === "any" || c.levies) && (!pj || c.county === countyNo))
          .map(([name]) => name);
  const out: LocalRate[] = [];
  const span = (i: number) => (days[i + 1] ? shiftDay(days[i + 1], -1) : undefined);
  days.forEach((day, i) => {
    const outside = rateOn(rule.outside, day);
    if (outside === null) return;
    out.push({ name: county, rate: outside, from: day, to: span(i), type: "00", ...sourceOn(rule.outside, day) });
    for (const group of rule.inside) {
      const inside = rateOn(group.codes, day) ?? outside;
      const rate = Math.round((inside - outside) * 1e6) / 1e6;
      if (rate)
        for (const city of named(group.cities, false))
          out.push({ name: city, rate, from: day, to: span(i), type: "0c", inCounty: titleCase(county), ...sourceOn(group.codes, day) });
    }
    // An unnamed city in an "unincorporated areas" county: its rate could be
    // the outside one or the first named group's.
    if (rule.uninc && rule.inside.length) {
      const listed = new Set(rule.inside.flatMap((g) => named(g.cities, false)));
      const first = rateOn(rule.inside[0].codes, day) ?? outside;
      for (const [city, c] of cities)
        if (c.county === countyNo && !listed.has(city) && ![...listed].some((l) => l.toUpperCase() === city))
          out.push({ name: city, rate: Math.round((first - outside) * 1e6) / 1e6 || 0, from: day, to: span(i), type: "maybe", ...sourceOn(rule.inside[0].codes, day) });
    }
    for (const group of rule.pj ?? []) {
      // A police jurisdiction code no longer in effect leaves the county's
      // outside rate there.
      const rate = Math.round(((rateOn(group.codes, day) ?? outside) - outside) * 1e6) / 1e6;
      if (rate)
        for (const city of named(group.cities, true))
          out.push({ name: city, rate, from: day, to: span(i), type: "pj", ...sourceOn(group.codes, day) });
    }
  });
  return out;
}

/** Rows sharing a name and type, summed over each span where they overlap. */
function sumByCode(rows: LocalRate[]): LocalRate[] {
  const groups = new Map<string, LocalRate[]>();
  for (const r of rows) {
    const key = `${r.type}|${r.name}|${r.inCounty ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: LocalRate[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const days = [...new Set(group.flatMap((r) => [r.from, r.to ? next(r.to) : null]).filter(Boolean) as string[])].sort();
    days.forEach((day, i) => {
      const live = group.filter((r) => r.from <= day && (!r.to || r.to >= day));
      if (!live.length) return;
      // A county's base and countywide codes add up; a city listed once per
      // county it spans has one rate.
      const rate =
        group[0].type === "00"
          ? live.reduce((sum, r) => sum + r.rate, 0)
          : Math.max(...live.map((r) => r.rate));
      const to = days[i + 1] ? prev(days[i + 1]) : undefined;
      out.push({ ...group[0], ...mergeSources(live), rate: Math.round(rate * 1e6) / 1e6, from: day, to });
    });
  }
  return out;
}

/** Several rows' names and ids as one: each distinct value, comma-separated. */
function mergeSources(rows: Array<Pick<LocalRate, "title" | "ids">>): Pick<LocalRate, "title" | "ids"> {
  const join = (values: Array<string | undefined>) => [...new Set(values.filter(Boolean))].join(", ") || undefined;
  if (!rows.some((r) => r.ids)) return { title: join(rows.map((r) => r.title)) };
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r.ids ?? {})))];
  return {
    title: join(rows.map((r) => r.title)),
    ids: Object.fromEntries(keys.map((k) => [k, join(rows.map((r) => r.ids?.[k]))!])),
  };
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const next = (iso: string) => shiftDay(iso, 1);
const prev = (iso: string) => shiftDay(iso, -1);
