/**
 * The engine's tunable settings: numbers and switches that decide how sure
 * an answer must be, kept in one place so they can be tuned on the dev
 * splits rather than rewritten as rules. Each default is the best value
 * found so far; OTR_PARAMS (JSON) overrides any of them for a run, e.g.
 * OTR_PARAMS='{"agreeFactor":3}'. A setting it doesn't name, or a value of
 * the wrong kind, stops the process at start rather than run on a guess.
 * scripts/tuning runs the trials; keep development logs privately.
 */
import { MAP_STATES } from "./coverage.js";

export interface Params {
  /** Geocoders never asked, whatever keys are set (geocoding/registry.ts).
   *  On the dev splits Mapbox, HERE and Google stood in for one another,
   *  so Mapbox, the cheapest, is kept. */
  disabledGeocoders: string[];
  /** Pelias may return one house from several of its datasets (OpenAddresses,
   *  NAD, Overture): exact matches all within this many metres of its first
   *  are one answer, its margin widened to reach them; farther apart, they
   *  are different places (geocoding/providers/pelias.ts). */
  peliasDuplicateMetres: number;
  /** Two geocodes agree when no farther apart than this many times the
   *  larger of their margins (geocoding/agreement.ts)... */
  agreeFactor: number;
  /** ...and never farther apart than this. */
  agreeCapMetres: number;
  /** The smallest margin each accuracy class gets (geocoding/types.ts). */
  minMarginMetres: { rooftop: number; parcel: number; point: number; interpolated: number };
  /** An interpolated point (a guess along the street's house-number range)
   *  widens a more precise group's margin to reach it, and two of them can
   *  stand as a second place against it (geocoding/agreement.ts). Off, they
   *  only support a placement. Measured off on 2026-10-23 (dev, against a
   *  same-day baseline): one address more right, one more wrong (an
   *  unincorporated King County address the interpolated point kept out of
   *  Renton). Kept on. */
  interpolatedWidens: boolean;
  /** The widest circle disagreeing geocodes may be placed within
   *  (geocoding/locator.ts). */
  wideMetres: number;
  /** A lone dataset's point outside the typed city's outline is still
   *  trusted when it lies in the typed ZIP's Census area and in no other
   *  rated city: a rural address with a town's mailing name
   *  (geocoding/locator.ts). */
  lonePointOutsideCity: boolean;
  /** How far past its Census area an address with that ZIP may be, for an
   *  address no geocoder places (rates/map.ts). */
  zipMarginMetres: number;
  /** Square metres of a ZIP's widened area that may fall between the state's
   *  county outlines (slivers left by simplifying neighbours apart) and the
   *  counties still count as holding all of it (rates/map.ts). At 1,000 on
   *  2026-10-23: a Pennsylvania address 42 m² short of covered answered, no
   *  new wrong rate (dev, against a same-day baseline). */
  zipAreaGapSquareMetres: number;
  /** A map point this sure, agreed by two datasets, outweighs a street range
   *  (rates/ranges.ts). */
  preciseMetres: number;
  /** A point in a range state's tax zone for a town that the ZIP's file
   *  doesn't list and that levies nothing of its own takes the county's
   *  town-less area (rates/range-polygons.ts). */
  zoneBeyondZip: boolean;
  /** When a looked-up ZIP+4 and a state's own tax outlines disagree, the
   *  outlines answer; off, the address is declined locally so a state lookup
   *  can settle it, as outlines may be stale (rates/ranges.ts). */
  outlinesOverZip4: boolean;
  /** When a state's lookup gives two rates across the point's margin, ask
   *  once for a sharper point and try again (rates/index.ts). */
  lookupSharpen: boolean;
  /** A state's lookup is asked only at a point this sure: it is read at the
   *  point and four edges of its margin, which can miss a town inside a
   *  wider one (rates/index.ts). */
  lookupMaxMarginMetres: number;
  /** An address inside an outline that adds nothing on the sale date, but
   *  whose jurisdiction's rate starts later, on the day its source first
   *  lists rates like it, is refused: whether it taxed on the date isn't
   *  known (rates/map.ts). On the boundary benchmark this is every wrong
   *  Texas answer for a past date: districts its loader knows only from the
   *  current quarter's list. */
  refuseBeforeFirstRate: boolean;
  /** A range state whose boundary file lists only the rows in force on its
   *  edition (Missouri's) answers no date before that edition from its
   *  ranges (rates/ranges.ts); its map and state lookup still may. On the
   *  history split, Missouri's ZIP-wide answers for past dates were wrong
   *  3 times in 17; its dated state lookup, 0 in 77. */
  refuseBeforeRangesListed: boolean;
  /** Where the address could be in another combination of jurisdictions
   *  with the same total rate, refuse it rather than answer the rate with
   *  its parts marked uncertain (rates/map.ts, rates/ranges.ts). */
  breakdownMustAgree: boolean;
  /** Metres added to a point's margin at a line, by map state, for how far
   *  a loaded outline may be from the state's own (rates/map.ts). Widens
   *  refusals as well as alternatives. Every map state is named; the
   *  boundary benchmark finds Texas's published outlines up to about 80 m
   *  from the Comptroller's own lookup: at a rooftop's margin, Texas at 0 m
   *  gives 15 wrong rates of 1,194 points near lines, 25 m gives 7 (and 94
   *  more refusals), 80 m gives 2; the address dev splits are unchanged at
   *  25 m. */
  outlineMarginMetres: Record<string, number>;
  /** Within this many metres of a line, a neighbour with the same rate but
   *  other jurisdictions is listed as an alternative, even beyond the
   *  point's margin (rates/map.ts). It only marks the breakdown uncertain;
   *  it never refuses a rate. On the boundary benchmark (TX, AZ, VA, SC,
   *  rooftop margin), 0 leaves 6 wrong breakdowns unmarked; 60 marks all of
   *  them, and marks 99 right ones uncertain as well (21 at 0). */
  breakdownMarginMetres: number;
  /** A misspelled street is read as another when this alike, and this far
   *  ahead of the next (rates/streets/correct.ts). */
  spellingMinSimilarity: number;
  spellingMinLead: number;
}

const DEFAULTS: Params = {
  disabledGeocoders: ["google", "here"],
  peliasDuplicateMetres: 50,
  agreeFactor: 1,
  agreeCapMetres: 250,
  minMarginMetres: { rooftop: 15, parcel: 25, point: 40, interpolated: 75 },
  interpolatedWidens: true,
  wideMetres: 20_000,
  lonePointOutsideCity: true,
  zipMarginMetres: 2_000,
  zipAreaGapSquareMetres: 1_000,
  preciseMetres: 40,
  zoneBeyondZip: true,
  outlinesOverZip4: false,
  lookupSharpen: true,
  lookupMaxMarginMetres: 1_000,
  refuseBeforeFirstRate: true,
  breakdownMustAgree: false,
  refuseBeforeRangesListed: true,
  outlineMarginMetres: { ...Object.fromEntries(MAP_STATES.map((s) => [s, 0])), TX: 25 },
  breakdownMarginMetres: 60,
  spellingMinSimilarity: 0.45,
  spellingMinLead: 0.08,
};

/** The value OTR_PARAMS gives `key`, or an error saying why it can't be. */
function checked(key: string, value: unknown, fallback: unknown): unknown {
  const fail = (why: string): never => { throw new Error(`OTR_PARAMS: ${key} ${why}`); };
  if (Array.isArray(fallback)) {
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) fail("must be a list of names");
    return value;
  }
  if (typeof fallback === "object" && fallback) {
    if (typeof value !== "object" || !value || Array.isArray(value)) fail("must be an object");
    const given = value as Record<string, unknown>;
    for (const k of Object.keys(given)) {
      if (!(k in fallback)) fail(`has no ${k}`);
      checked(`${key}.${k}`, given[k], (fallback as Record<string, unknown>)[k]);
    }
    return { ...fallback, ...given };
  }
  if (typeof value !== typeof fallback) fail(`must be a ${typeof fallback}`);
  if (typeof value === "number" && !(Number.isFinite(value) && value >= 0)) fail("must be a number of 0 or more");
  return value;
}

function read(): Params {
  const raw = process.env.OTR_PARAMS;
  const params = structuredClone(DEFAULTS) as unknown as Record<string, unknown>;
  if (!raw) return params as unknown as Params;
  let given: Record<string, unknown>;
  try {
    given = JSON.parse(raw);
  } catch {
    throw new Error("OTR_PARAMS isn't valid JSON");
  }
  const unknown = Object.keys(given).filter((k) => !(k in DEFAULTS));
  if (unknown.length) throw new Error(`OTR_PARAMS names unknown settings: ${unknown.join(", ")}`);
  for (const [key, value] of Object.entries(given)) params[key] = checked(key, value, params[key]);
  return params as unknown as Params;
}

/** Read once, at start; modules read it where they use it, so a test may
 *  change one for the rest of its file. */
export const PARAMS: Params = read();
