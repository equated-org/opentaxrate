/**
 * Class rates: a part's rate on a class of sale its publisher rates apart
 * from the general sale (RATE_CLASSES in rates/types.ts), read from the
 * same published files as the general rates and stored beside them in
 * sales_tax_class_rates, keyed by the same "type:code", dated like them.
 * The lookup only reads them onto parts (rates/names.ts) for taxability
 * rules that name a class; the general rate never reads them.
 *
 *   AZ  ADOR's monthly rate tables: restaurants and bars (business code
 *       011, plus a city's additional tax, 111) for every county and city;
 *       food for home consumption (062) where a city lists it.
 *   AL  ALDOR's taxrates.csv: the GROC rows, each county's and city's rate
 *       on food, through the same county rules as its general rate.
 *   IL  IDOR's grocery rate files: each location's local rate on groceries
 *       from 2026-01-01, when the state's 1% ended.
 *   UT  the Tax Commission's quarterly rate chart: its prepared food
 *       (restaurant) rate, the county restaurant tax on top of the combined
 *       rate, on the county's part; every other part's restaurant rate is
 *       its general rate, which the chart says the tax is in addition to.
 *
 * Each state's rows replace its old ones in one transaction, after its
 * general rates are loaded: a row whose type:code no general rate of the
 * state has is left out, with a warning, since no part could carry it.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { salesTaxClassRates, salesTaxDataReleases, salesTaxJurisdictionRates } from "../db/schema.js";
import type { RateClass } from "../rates/types.js";
import { alabamaClasses } from "./states/alabama.js";
import { arizonaClasses } from "./states/arizona.js";
import { illinoisClasses } from "./states/illinois.js";
import { utahClasses } from "./states/utah.js";

export interface ClassRateRow {
  type: string;
  code: string;
  class: RateClass;
  rate: number;
  startsOn: string;
  endsOn: string;
  /** Where the rate applies only in one case, beside another case's row,
   *  that case as the publisher states it (sales_tax_class_rates.applies_when). */
  appliesWhen?: string;
  /** The file and the publisher's key for the class it was read from. */
  source: string;
}

/** The state's general rate rows as loaded, and the files they came from:
 *  what a reader keys its rows to and reads the same editions as. */
export interface LoadedRates {
  rates: Array<{ type: string; code: string; rate: number; startsOn: string; endsOn: string }>;
  /** sales_tax_data_releases' rates file, e.g. "UTR2026Q4AUG11". */
  ratesFile: string | null;
}

export interface ClassRateSource {
  state: string;
  /** Reads the class rates from the saved copies (or `dir`) of the files
   *  the state's general rates were loaded from. */
  fetch(dir: string | undefined, loaded: LoadedRates): Promise<{ rows: ClassRateRow[]; file: string }>;
}

export const CLASS_RATE_SOURCES: ClassRateSource[] = [arizonaClasses, alabamaClasses, illinoisClasses, utahClasses];

async function loadedRates(state: string): Promise<LoadedRates> {
  const rates = await db
    .select({
      type: salesTaxJurisdictionRates.type,
      code: salesTaxJurisdictionRates.code,
      rate: salesTaxJurisdictionRates.rate,
      startsOn: salesTaxJurisdictionRates.startsOn,
      endsOn: salesTaxJurisdictionRates.endsOn,
    })
    .from(salesTaxJurisdictionRates)
    .where(eq(salesTaxJurisdictionRates.state, state));
  const [release] = await db
    .select({ file: salesTaxDataReleases.file })
    .from(salesTaxDataReleases)
    .where(and(eq(salesTaxDataReleases.state, state), eq(salesTaxDataReleases.kind, "rates")));
  return { rates: rates.map((r) => ({ ...r, rate: Number(r.rate) })), ratesFile: release?.file ?? null };
}

/** Replaces `state`'s class rates with `rows`, keeping only those whose
 *  type:code a loaded general rate has. Returns the rows written. */
export async function loadClassRates(state: string, rows: ClassRateRow[], loaded: LoadedRates): Promise<number> {
  const known = new Set(loaded.rates.map((r) => `${r.type}:${r.code}`));
  const kept = rows.filter((r) => known.has(`${r.type}:${r.code}`));
  const dropped = [...new Set(rows.filter((r) => !known.has(`${r.type}:${r.code}`)).map((r) => `${r.type}:${r.code}`))];
  if (dropped.length) console.warn(`${state}: ${dropped.length} class-rate codes no general rate has, left out: ${dropped.slice(0, 12).join(", ")}${dropped.length > 12 ? ", …" : ""}`);
  // A difference row (Alabama's county rate inside a city, 0c) may be negative.
  for (const r of kept) if (!(r.rate > -1 && r.rate < 1) || r.endsOn < r.startsOn) throw new Error(`${state}: a bad class rate ${JSON.stringify(r)}`);
  await db.transaction(async (tx) => {
    await tx.delete(salesTaxClassRates).where(eq(salesTaxClassRates.state, state));
    for (let i = 0; i < kept.length; i += 500)
      await tx.insert(salesTaxClassRates).values(
        kept.slice(i, i + 500).map((r) => ({ state, type: r.type, code: r.code, class: r.class, rate: String(Math.round(r.rate * 1e6) / 1e6), startsOn: r.startsOn, endsOn: r.endsOn, appliesWhen: r.appliesWhen ?? "", source: r.source })),
      );
  });
  return kept.length;
}

/** Every class-rate state asked for (all when `states` is empty), from the
 *  saved files its general rates were loaded from. */
export async function refreshClassRates({ states = [], dir, log = console.log }: { states?: string[]; dir?: string; log?: (line: string) => void } = {}) {
  for (const source of CLASS_RATE_SOURCES) {
    if (states.length && !states.includes(source.state)) continue;
    const loaded = await loadedRates(source.state);
    if (!loaded.rates.length) {
      log(`${source.state}: no general rates loaded, so no class rates`);
      continue;
    }
    const { rows, file } = await source.fetch(dir, loaded);
    const count = await loadClassRates(source.state, rows, loaded);
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.class, (counts.get(r.class) ?? 0) + 1);
    const byClass = [...counts].map(([c, n]) => `${n} ${c}`).join(", ");
    log(`${source.state}: ${file} → ${count} class rates (${byClass})`);
  }
}
