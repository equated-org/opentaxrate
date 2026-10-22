/**
 * Virginia: 4.3% state plus each county's or independent city's local rate
 * (1%, a 0.7% regional tax in Northern Virginia, Hampton Roads and Central
 * Virginia, and the Historic Triangle's and some localities' added 1%), from
 * the Department of Taxation's workbook of rates by locality, one sheet per
 * period since 2005. Localities are keyed by FIPS, so independent cities
 * match the Census county outlines they have, and named as the workbook
 * names them.
 */
import type { LocalRate } from "./tables.js";
import { stateTable } from "./tables.js";
import { fetchFile, readXlsx } from "./sources.js";

const WORKBOOK =
  "https://www.tax.virginia.gov/sites/default/files/inline-files/sales-and-use-tax-rates-by-locality-by-date.xlsx";
const STATE = 0.043;

export const virginia = stateTable("VA", async (dir) => {
  const locals: LocalRate[] = [];
  let first = "9999-12-31";
  for (const [name, rows] of readXlsx(await fetchFile(WORKBOOK, dir))) {
    // The period is in the sheet's second row; sheet names have typos.
    const period = periodOf(rows[1]?.[1] ?? "");
    if (!period) throw new Error(`VA sheet "${name}" names no period`);
    if (period.from < first) first = period.from;
    for (const row of rows) {
      const [, title, code, general] = row;
      if (!/^51\d{3}$/.test(code?.trim() ?? "")) continue;
      locals.push({
        name: code.trim(),
        rate: Math.round((Number(general) - STATE) * 1e6) / 1e6,
        from: period.from,
        to: period.to,
        type: "00",
        title: title?.trim() || undefined,
      });
    }
  }
  return {
    stateRates: [{ rate: STATE, from: first }],
    locals,
    source: "VA Tax sales and use tax rates by locality",
  };
});

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "July 1, 2018 - September 30, 2020" or "January 1, 2026 - Present". */
function periodOf(text: string) {
  const day = (s: string) => {
    const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
    if (!m) return null;
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    return month ? `${m[3]}-${String(month).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
  };
  const [start, end] = text.split(/\s+-\s+/);
  const from = day(start ?? "");
  if (!from) return null;
  return { from, to: /present/i.test(end ?? "") ? undefined : (day(end ?? "") ?? undefined) };
}
