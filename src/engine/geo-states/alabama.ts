/**
 * Alabama, from the Department of Revenue's rate file (every county and
 * city, state- and self-administered alike, with active and inactive
 * dates): 4% state, plus the county's rate, plus the city's inside its
 * limits.
 *
 * A county whose rate differs inside named cities is placed by those cities'
 * limits, where its codes name the cities (CITY_SPLITS): a "CL" code is the
 * county's rate inside them in place of its base rate, an "EXC" code its
 * added rate outside them. Two things the file
 * can't place without outlines it doesn't have are refused rather than
 * guessed:
 *   - a county whose rate also differs inside police jurisdictions or in
 *     cities its codes don't name;
 *   - an address outside a city but within three miles of it, where the
 *     city's police jurisdiction may tax at half its rate.
 * Codes for abated businesses ("unabated") don't apply to general sales.
 */
import type { LocalRate } from "./tables.js";
import { stateTable } from "./tables.js";
import { fetchText, isoDay, shiftDay } from "./sources.js";

const FILE = "https://www.revenue.alabama.gov/wp-content/uploads/2024/03/taxrates.csv";
const FROM = "2020-01-01";

/** County codes that apply inside (CL) or outside (EXC) the cities they
 *  name, often abbreviated, by code name. */
const CITY_SPLITS: Record<string, { inside: boolean; cities: string[] }> = {
  "MOBILE COUNTY CL PRICH & MOBIL": { inside: true, cities: ["Prichard", "Mobile"] },
  "LEE CO CL AUB & OPE & PHENIX": { inside: true, cities: ["Auburn", "Opelika", "Phenix City"] },
  "DALE CO CL DALEVILLE & OZARK": { inside: true, cities: ["Daleville", "Ozark"] },
  "ST CLAIR COUNTY CL PELL CITY": { inside: true, cities: ["Pell City"] },
  "MARION COUNTY CL WINFIELD": { inside: true, cities: ["Winfield"] },
  "PIKE COUNTY CL TROY": { inside: true, cities: ["Troy"] },
  "PIKE COUNTY EXC CL TROY": { inside: false, cities: ["Troy"] },
  "ELMORE COUNTY CL PRATTVILLE": { inside: true, cities: ["Prattville"] },
  "MADISON CO EXC CL HUNTSVILLE": { inside: false, cities: ["Huntsville"] },
  "LAUDERDALE COUNTY FLORENCE": { inside: true, cities: ["Florence"] },
};
/** A county police jurisdiction's own code; the police jurisdiction refusal
 *  already covers where it applies. */
const PJ_CODE = /\bPJ\b/;

export const alabama = stateTable("AL", async (dir) => {
  const csv = await fetchText(FILE, dir, "taxrates.csv");
  const locals: LocalRate[] = [];
  const split = new Set<string>();
  const inside: Split[] = [];
  const outsideOnly: Split[] = [];
  const excluded = new Set<LocalRate>();
  for (const line of csv.replace(/^﻿/, "").split(/\r?\n/).slice(1)) {
    const [code, name, , taxType, rateType, , active, inactive, rate, , pj, , pjRate] = line.split(",").map((c) => c.trim());
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
      const named = CITY_SPLITS[name];
      const rateOf = Number(rate) / 100;
      if (/^[A-Z .']+ COUNTY$/.test(name)) locals.push({ name: county, rate: rateOf, ...dated, type: "00" });
      else if (named) {
        if (named.inside) for (const city of named.cities) inside.push({ county, city, rate: rateOf, ...dated });
        else {
          const row: LocalRate = { name: county, rate: rateOf, ...dated, type: "00" };
          locals.push(row);
          excluded.add(row);
          for (const city of named.cities) outsideOnly.push({ county, city, rate: rateOf, ...dated });
        }
      } else if (PJ_CODE.test(name) && !/\bCL\b|UNINC|EXC|CITIES/.test(name)) continue;
      else if (/\bCL\b|\bEXC\b|UNINC|CITIES|\bCITY\b|&/.test(name)) split.add(county);
      else locals.push({ name: county, rate: rateOf, ...dated, type: "00" });
    } else if (code.startsWith("9")) {
      // A district inside a town is listed like a town but has no outline.
      if (/ DIST$/.test(name)) continue;
      // "TALLASSEE WITHIN ELMORE CO": the city's rate in one of its counties.
      const within = / WITHIN ([A-Z ]+) CO$/.exec(name)?.[1];
      const inCounty = within ? titleCase(within) : undefined;
      const city = name.replace(/ (?:WITHIN [A-Z ]+ CO|S&U|SALES & USE|SALES)$/, "");
      locals.push({ name: city, rate: Number(rate) / 100, ...dated, type: "01", inCounty });
      if (pj === "Y" && Number(pjRate) > 0)
        locals.push({ name: city, rate: Number(pjRate) / 100, ...dated, type: "pj", inCounty });
    }
  }
  // A countywide add-on and a base rate for one county are separate rows
  // under one code; they are summed by period.
  const merged = sumByCode(locals);
  merged.push(...cityDifferences(locals.filter((l) => !excluded.has(l)), inside, outsideOnly));
  for (const county of split) merged.push({ name: county, rate: 0, from: FROM, type: "no" });
  return {
    stateRates: [{ rate: 0.04, from: FROM }],
    locals: merged,
    source: "AL DOR local tax rates file",
    skipUnmatchedCities: true,
  };
});

interface Split {
  county: string;
  city: string;
  rate: number;
  from: string;
  to?: string;
}

/** Each named city's county rate less the county's rate outside it, as a
 *  0c row: inside, its CL rate (or the base rate) stands where the base rate
 *  and any EXC rate would. `base` is the county's rows other than EXC ones. */
function cityDifferences(locals: LocalRate[], inside: Split[], outsideOnly: Split[]): LocalRate[] {
  const out: LocalRate[] = [];
  const cities = new Map<string, string>();
  for (const s of [...inside, ...outsideOnly]) cities.set(s.city, s.county);
  for (const [city, county] of cities) {
    const base = locals.filter((l) => l.type === "00" && l.name === county);
    const exc = outsideOnly.filter((o) => o.county === county && o.city === city);
    const cl = inside.filter((i) => i.county === county && i.city === city);
    const days = [...new Set([...base, ...exc, ...cl].flatMap((r) => [r.from, r.to ? shiftDay(r.to, 1) : null]).filter(Boolean) as string[])].sort();
    days.forEach((day, i) => {
      const live = <T extends { from: string; to?: string }>(rows: T[]) => rows.filter((r) => r.from <= day && (!r.to || r.to >= day));
      const baseRate = live(base).reduce((sum, r) => sum + r.rate, 0);
      const excRate = live(exc).reduce((sum, r) => sum + r.rate, 0);
      const clRows = live(cl);
      const insideRate = clRows.length ? clRows.reduce((sum, r) => sum + r.rate, 0) : baseRate;
      const rate = Math.round((insideRate - baseRate - excRate) * 1e6) / 1e6;
      if (rate)
        out.push({ name: city, rate, from: day, to: days[i + 1] ? shiftDay(days[i + 1], -1) : undefined, type: "0c", inCounty: titleCase(county) });
    });
  }
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
      out.push({ ...group[0], rate: Math.round(rate * 1e6) / 1e6, from: day, to });
    });
  }
  return out;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const next = (iso: string) => shiftDay(iso, 1);
const prev = (iso: string) => shiftDay(iso, -1);
