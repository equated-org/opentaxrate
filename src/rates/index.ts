/**
 * The general sales tax rate at a US street address on a date, from the
 * states' own published data, loaded into Postgres. Covers:
 *   - states with one rate everywhere, or no sales tax (statewide.ts);
 *   - the 24 Streamlined Sales Tax member states, and Missouri, from their
 *     published rate and address-range files (ingest/sst-files.ts,
 *     ingest/missouri.ts, loaded by ingest/load.ts, read by ranges.ts), with
 *     Census county and city outlines (ingest/tiger.ts) to settle a ZIP the
 *     files split;
 *   - states whose local taxes follow county, city and district lines, from
 *     each state's own rate table (ingest/states) and the address's place
 *     on the map (map.ts, geocoding);
 *   - California, from the CDTFA's live address lookup (today's rate only;
 *     it publishes no files to load).
 * Any other state is refused as unsupported. An address the data can't place
 * in one rate is refused with the rates it could be; it never gets a guess,
 * and missing data is never read as no tax.
 *
 * This is the rate on a general sale. Whether an item is taxable, which
 * address a sale is sourced to, and the filing codes a return needs are the
 * caller's.
 */
import { RateError } from "../errors.js";
import { statewideRate, STATEWIDE_STATES } from "./statewide.js";
import { MAP_STATES, RANGE_FIPS } from "../coverage.js";
import { sstRateAt } from "./ranges.js";
import { generalOnly, type RatePart, type RatesByType, type Trace } from "./types.js";
import { type LocatedPoint, type Locate } from "../geocoding/types.js";
import type { StandardAddress } from "../standardize/index.js";
import type { StreetPicker } from "./streets/jev.js";
import { districtNamed, geoRateAt } from "./map.js";
import { californiaSalesTaxService } from "./california.js";
import { marginProbes, stateLookup, stateLookupAt } from "./state-lookups.js";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { salesTaxJurisdictionRates } from "../db/schema.js";

export type { LocatedPoint, RatePart, RatesByType, Trace };
export { emptyTrace } from "./types.js";
export { STATEWIDE_STATES };

export interface AddressRateQuery {
  /** Two-letter state code. */
  state: string;
  street: string;
  city: string;
  /** Five digits, or ZIP+4. */
  zip?: string | null;
  /** Places the address on a map, for a ZIP the state's files split. Asked
   *  again only to refine a point near a deciding boundary. */
  locate?: Locate;
  /** The address in the Postal Service's form with its ZIP+4, for a range
   *  state's address its typed street doesn't place. Asked at most once. */
  standardize?: () => Promise<StandardAddress | null>;
  /** Reads a street a range state's file doesn't know as one of the ZIP's
   *  when spelling can't: Jev by default, null for spelling only. */
  pickStreet?: StreetPicker | null;
  /** Collects how the address was placed (geocoder points, the outlines
   *  tested, the deciding street range), for display. Never changes the
   *  answer. */
  trace?: Trace;
}

export interface AddressRate {
  state: string;
  /** Combined rate as a decimal: 0.0725 is 7.25%. */
  rate: number;
  stateRate: number;
  localRate: number;
  /** The combined rate for each kind of sale the state's files rate apart
   *  (general from in or out of state, food and drugs from in or out of
   *  state); only `general` outside the Streamlined states. */
  byType: RatesByType;
  parts: RatePart[];
  /** How precisely the address was placed: one rate for the whole state, a
   *  street range, a ZIP+4 range, a ZIP whose ranges all share one rate, or
   *  the county and city outlines its map point falls in. */
  match: "statewide" | "street" | "zip4" | "zip5" | "map" | "authority";
  locationCode: string | null;
  /** Where the rate came from, for a tax line's note. */
  source: string;
}

const MATCH_NAMES = {
  street: "street match",
  zip4: "ZIP+4 match",
  zip5: "one rate across the ZIP",
  map: "Census county and city outlines",
};

export const ADDRESS_RATE_STATES = [...new Set([
  ...STATEWIDE_STATES,
  ...Object.keys(RANGE_FIPS),
  ...MAP_STATES,
  "CA",
])].sort();

/** California's state rate, the part every address shares. */
const CA_STATE_RATE = 0.0725;

export const addressRates = {
  covers: (state: string) => ADDRESS_RATE_STATES.includes(state.toUpperCase()),
  /** How a state's addresses are placed: one rate statewide, by address
   *  ranges (where a ZIP helps), or on the map. */
  method: (state: string): "statewide" | "ranges" | "map" | "authority" | null => {
    const s = state.toUpperCase();
    if (s === "CA") return "authority";
    if (STATEWIDE_STATES.includes(s)) return "statewide";
    if (RANGE_FIPS[s]) return "ranges";
    return MAP_STATES.includes(s) ? "map" : null;
  },

  /** The rate at `query` on `date` (YYYY-MM-DD). Throws RateError: 422
   *  for an address that needs confirming or an unsupported state, 502 when
   *  the state's files aren't loaded. */
  async at(query: AddressRateQuery, date: string): Promise<AddressRate> {
    const state = query.state.toUpperCase();
    const statewide = statewideRate(state, date, query.city);
    if (statewide && "refused" in statewide) throw new RateError(statewide.refused, 422);
    // A statewide state whose local taxes are read from the map (Montana's
    // resort areas): placed, its outlines decide; not placed, it takes the
    // statewide rate unless its city is named for one of those areas.
    const local = statewide && MAP_STATES.includes(state);
    const placed = local && query.locate ? await query.locate() : null;
    if (local) {
      const area = await districtNamed(state, query.city, date);
      if (area === "unloaded") throw new RateError(`This service hasn't loaded ${state}'s local tax areas.`, 502);
      // Named for an area with no outline, the map can't say whether the
      // address is in it; named for one with an outline, only the map can.
      if (area && (!area.outlined || !placed))
        throw new RateError(
          area.outlined
            ? `${query.city} levies its own local tax, and this address couldn't be placed on the map to tell whether it is inside it. Confirm the rate with ${query.city}.`
            : `${query.city} levies its own local tax and publishes no outline of where it applies. Confirm the rate with ${query.city}.`,
          422,
        );
    }
    if (statewide && !placed) {
      return {
        state,
        rate: statewide.rate,
        stateRate: statewide.rate,
        localRate: 0,
        byType: generalOnly(statewide.rate),
        parts: [{ kind: "state", code: state, rate: statewide.rate }],
        match: "statewide",
        locationCode: state,
        source: `${state} statewide rate from ${statewide.from}`,
      };
    }
    if (state === "CA") return california(query, date);
    // A state whose own lookup STATE_LOOKUPS turns on answers from it, at
    // the address's map point, when it gives one rate across the point's
    // margin; otherwise the loaded data answers.
    const lookup = stateLookup(state);
    const point = lookup && query.locate ? await query.locate() : null;
    const looked = lookup && point ? await stateLookupAt(lookup, point, date) : null;
    if (lookup && point && looked !== null) {
      const stateRate = await loadedStateRate(state, date);
      const localRate = Math.round((looked - stateRate) * 1e6) / 1e6;
      return {
        state,
        rate: looked,
        stateRate,
        localRate,
        byType: generalOnly(looked),
        parts: [
          { kind: "state", code: state, rate: stateRate },
          ...(localRate ? [{ kind: "district" as const, code: `${state}:lookup`, rate: localRate }] : []),
        ],
        match: "authority",
        locationCode: null,
        source: `${lookup.name}, at the address's map point on ${date}${point.placedBy?.length ? `; placed by ${point.placedBy.join(", ")}` : ""}`,
      };
    }
    if (MAP_STATES.includes(state)) {
      const found = await geoRateAt(
        state,
        query.locate ?? null,
        date,
        query.street,
        query.trace,
      );
      const stateRate = found.parts.find((p) => p.kind === "state")!.rate;
      return {
        state,
        rate: found.rate,
        stateRate,
        localRate: Math.round((found.rate - stateRate) * 1e6) / 1e6,
        byType: generalOnly(found.rate),
        parts: found.parts,
        match: "map",
        locationCode: found.locationCode,
        source: `${state} rate table ${found.files.join(" + ")}, by the address's place on the map on ${date}${found.placedBy?.length ? `; placed by ${found.placedBy.join(", ")}` : ""}`,
      };
    }
    if (!RANGE_FIPS[state])
      throw new RateError(
        `OpenTaxRate has no address rates for ${state} yet.`,
        422,
        undefined,
        "UNSUPPORTED_STATE",
      );
    const found = await sstRateAt({ ...query, state }, date);
    const stateRate = found.parts.find((p) => p.kind === "state")!.rate;
    return {
      state,
      rate: found.rate,
      stateRate,
      localRate: Math.round((found.rate - stateRate) * 1e6) / 1e6,
      byType: found.byType,
      parts: found.parts,
      match: found.match,
      locationCode: found.locationCode,
      source: `${state === "MO" ? "Missouri DOR" : "Streamlined Sales Tax"} files ${found.files.join(" + ")}, ${MATCH_NAMES[found.match]} on ${date}${found.note ? `; ${found.note}` : ""}`,
    };
  },
};

/** California's rate from its tax office's live lookup, which knows only
 *  today's; the source says so when the sale is dated otherwise. */
async function california(query: AddressRateQuery, date: string): Promise<AddressRate> {
  if (!query.zip)
    throw new RateError("California's lookup needs the address's ZIP code.", 422);
  const found = await californiaSalesTaxService
    .lookup({ street: query.street, city: query.city, zip: query.zip })
    .catch(async (error) => {
      // CDTFA's own address match wasn't confident: ask it at the address's
      // map point instead, and at the edges of that point's margin past its
      // 50 m buffer, answering only if every one is the same single area.
      if (!(error instanceof RateError) || error.status !== 422 || !query.locate) throw error;
      const point = await query.locate();
      if (!point) throw error;
      const areas = await Promise.all(marginProbes(point, 50).map((p) => californiaSalesTaxService.atPoint(p.lon, p.lat)));
      const tacs = new Set(areas.flatMap((a) => (a && a.length === 1 ? [a[0].tac] : ["?"])));
      if (tacs.size !== 1 || tacs.has("?")) throw error;
      return {
        rate: areas[0]![0].rate,
        locationCode: areas[0]![0].tac,
        locationCodeType: "ca_cdtfa_tax_area" as const,
        lookedUpAt: new Date().toISOString(),
        source: `the address's map point${point.placedBy?.length ? `, placed by ${point.placedBy.join(", ")}` : ""}`,
      };
    });
  const today = found.lookedUpAt.slice(0, 10);
  return {
    state: "CA",
    rate: found.rate,
    stateRate: CA_STATE_RATE,
    localRate: Math.round((found.rate - CA_STATE_RATE) * 1e6) / 1e6,
    byType: generalOnly(found.rate),
    parts: [
      { kind: "state", code: "CA", rate: CA_STATE_RATE },
      { kind: "district", code: `tac:${found.locationCode}`, rate: Math.round((found.rate - CA_STATE_RATE) * 1e6) / 1e6 },
    ],
    match: "authority",
    locationCode: found.locationCode,
    source: `CDTFA lookup for tax area ${found.locationCode} on ${today}${date === today ? "" : `, today's rate, not dated to ${date}`}`,
  };
}

/** The state's own rate on the date, from its loaded rate table (Alaska: 0). */
async function loadedStateRate(state: string, date: string): Promise<number> {
  const [row] = await db
    .select({ rate: salesTaxJurisdictionRates.rate })
    .from(salesTaxJurisdictionRates)
    .where(
      and(
        eq(salesTaxJurisdictionRates.state, state),
        eq(salesTaxJurisdictionRates.type, "45"),
        lte(salesTaxJurisdictionRates.startsOn, date),
        gte(salesTaxJurisdictionRates.endsOn, date),
      ),
    )
    .orderBy(desc(salesTaxJurisdictionRates.startsOn))
    .limit(1);
  if (!row) throw new RateError(`This service hasn't loaded ${state}'s state rate.`, 502);
  return Number(row.rate);
}
