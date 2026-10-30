/**
 * One rate lookup as the API and the CLI ask it: the address placed on the
 * map by a staged locator only when the engine needs it. Given a trace, the
 * engine records how it placed the address, and the outlines it tested are
 * drawn near the point for display.
 */
import { addressRates, type AddressRate, type Trace } from "./rates/index.js";
import { outlineGeometry } from "./rates/shapes.js";
import { createLocator } from "./geocoding/index.js";
import { addressStandardizer } from "./standardize/index.js";
import { geocoderProviders } from "./geocoding/registry.js";
import { EVERY_PROVIDER, type ProviderPolicy } from "./access.js";
import { JEV_PRICE, toMicros, type AccountBudget } from "./credits.js";
import { jevChoice, type StreetPicker } from "./rates/streets/jev.js";
import { regionsAt, type Regions } from "./regions.js";
import type { LocatedPoint, Locate } from "./geocoding/types.js";
import { loadRules, taxabilityByCode, type Taxability, type TaxCode } from "./taxability/index.js";

export type LookupResult = AddressRate & { taxability?: Record<string, Taxability>; regions?: Regions };

export interface RateQuery {
  state: string;
  street: string;
  city: string;
  zip?: string;
  /** YYYY-MM-DD; today when absent. */
  date?: string;
  /** What was sold, one or more codes; adds how each is taxed there
   *  (taxability/). */
  codes?: TaxCode[];
}

/** How far around the point a traced outline is drawn: at least 3 km, and
 *  far enough to include the nearest edge of an outline that levies, so the
 *  line that settled the rate is on the map, up to 20 km. */
const TRACE_CLIP_METRES = { min: 3_000, max: 20_000 };

export interface LookupOptions {
  trace?: Trace;
  regions?: boolean;
  /** The outside services this lookup may use (access.ts); every one when
   *  absent, as for the CLI. */
  policy?: ProviderPolicy;
  /** Pays for paid providers and records what they cost: an account's
   *  allowance (credits.ts). The vendors' shared caps alone when absent. */
  budget?: AccountBudget;
}

export async function lookUpRate(q: RateQuery, options: LookupOptions = {}): Promise<LookupResult> {
  const { trace, policy = EVERY_PROVIDER, budget } = options;
  const state = q.state.toUpperCase();
  const date = q.date ?? new Date().toISOString().slice(0, 10);
  const locator = createLocator({ street: q.street, city: q.city, state, zip: q.zip }, { trace, providers: geocoderProviders(policy), budget });
  let lastPoint: LocatedPoint | null = null;
  const locate: Locate = async need => {
    const point = await locator(need);
    lastPoint = point;
    return point;
  };
  const standardizer = addressStandardizer(policy, budget);
  const found = addressRates.at(
    {
      state,
      street: q.street,
      city: q.city,
      zip: q.zip,
      locate,
      standardize: standardizer && (() => standardizer({ street: q.street, city: q.city, state, zip: q.zip })),
      pickStreet: !policy.allows("jev") ? null : budget ? paidPicker(budget) : undefined,
      trace,
    },
    date,
  );
  try {
    const general = await found;
    const rate: LookupResult = q.codes?.length ? { ...general, taxability: taxabilityByCode(general, q.codes, date, await loadRules()) } : general;
    if (!options.regions) return rate;
    const regions = await regionsAt(state, date, () => lastPoint ? Promise.resolve(lastPoint) : locate());
    return { ...rate, regions };
  } finally {
    if (trace) await drawOutlines(state, trace, date);
  }
}

/** Jev, asked only when the budget pays for the pick. */
function paidPicker(budget: AccountBudget): StreetPicker | null {
  if (!process.env.TYPESAFE_API_KEY) return null;
  return async (...args) => ((await budget.spend("jev", toMicros(JEV_PRICE))) ? jevChoice(...args) : null);
}

/** Adds each traced outline's shape near the point. A failure here only
 *  leaves the shapes out; it never changes the answer. */
async function drawOutlines(state: string, trace: Trace, date: string) {
  if (!trace.point || !trace.outlines.length) return;
  try {
    const nearest = Math.min(...trace.outlines.filter((o) => o.levies).map((o) => o.edgeMetres));
    const metres = Math.min(TRACE_CLIP_METRES.max, Math.max(TRACE_CLIP_METRES.min, nearest * 1.25 + 500));
    const shapes = await outlineGeometry(state, trace.outlines, trace.point, metres, date);
    for (const o of trace.outlines) {
      const geometry = shapes.get(`${o.kind}:${o.fips}`);
      if (geometry) o.geometry = geometry;
    }
  } catch (error) {
    console.error(error);
  }
}
