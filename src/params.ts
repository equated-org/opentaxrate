/**
 * The engine's tunable settings: numbers and switches that decide how sure
 * an answer must be, kept in one place so they can be tuned on the dev
 * splits rather than rewritten as rules. Each default is the best value
 * found so far (docs/accuracy-log.md, Tuning); OTR_PARAMS (JSON) overrides
 * any of them for a run,
 * e.g. OTR_PARAMS='{"agreeFactor":3}'. See docs/accuracy-log.md for what
 * each one has decided on the benchmark.
 */
export interface Params {
  /** Geocoders never asked, whatever keys are set (geocoding/registry.ts).
   *  On the dev splits Mapbox, HERE and Google stood in for one another,
   *  so Mapbox, the cheapest, is kept (docs/accuracy-log.md). */
  disabledGeocoders: string[];
  /** Two geocodes agree when no farther apart than this many times the
   *  larger of their accuracy classes' margins (geocoding/agreement.ts). */
  agreeFactor: number;
  /** ...and never farther apart than this, in metres. */
  agreeCapMetres: number;
  /** When no two geocodes agree by agreeFactor, the factor to try once more
   *  with; 1 never does. The group's spread still becomes its margin. */
  agreeFallbackFactor: number;
  /** The smallest margin each accuracy class gets, in metres. */
  edgeMetres: { rooftop: number; parcel: number; point: number; interpolated: number };
  /** A lone dataset's point outside the typed city's outline is still
   *  trusted when it lies in the typed ZIP's Census area: a rural address
   *  with a town's mailing name (geocoding/locator.ts). */
  lonePointOutsideCity: boolean;
  /** The widest circle disagreeing geocodes may be placed within. */
  wideMetres: number;
  /** How far past its Census area an address with that ZIP may be, for an
   *  address no geocoder places (rates/map.ts). */
  zipMarginMetres: number;
  /** A map point this sure, agreed by two datasets, outweighs a street range
   *  (rates/ranges.ts). */
  preciseMetres: number;
  /** A point inside a range state's tax zone for a town the ZIP's file
   *  doesn't list, and that levies no rate of its own, takes the county's
   *  town-less area (rates/range-polygons.ts). */
  zoneBeyondZip: boolean;
  /** When a looked-up ZIP+4 and a state's own tax outlines disagree: the
   *  outlines answer ("polygons"), or the address is declined locally, so a
   *  state lookup can settle it ("decline"), for outlines that may be stale
   *  (rates/ranges.ts). */
  zip4Conflict: "polygons" | "decline";
  /** When a state's lookup gives two rates across the point's margin, ask
   *  for a point with this fraction of the margin and try again; 0 never
   *  asks (rates/index.ts). */
  lookupRefine: number;
  /** A misspelled street is read as another when this alike, and this far
   *  ahead of the next (rates/streets/correct.ts). */
  spellingMinSimilarity: number;
  spellingMinLead: number;
}

const DEFAULTS: Params = {
  disabledGeocoders: ["google", "here"],
  agreeFactor: 1,
  agreeCapMetres: 250,
  agreeFallbackFactor: 1,
  edgeMetres: { rooftop: 15, parcel: 25, point: 40, interpolated: 75 },
  lonePointOutsideCity: true,
  wideMetres: 20_000,
  zipMarginMetres: 2_000,
  preciseMetres: 40,
  zoneBeyondZip: true,
  zip4Conflict: "decline",
  lookupRefine: 0.5,
  spellingMinSimilarity: 0.45,
  spellingMinLead: 0.08,
};

function read(): Params {
  const raw = process.env.OTR_PARAMS;
  if (!raw) return DEFAULTS;
  const given = JSON.parse(raw) as Partial<Params>;
  const unknown = Object.keys(given).filter((k) => !(k in DEFAULTS));
  if (unknown.length) throw new Error(`OTR_PARAMS names unknown settings: ${unknown.join(", ")}`);
  return { ...DEFAULTS, ...given, edgeMetres: { ...DEFAULTS.edgeMetres, ...given.edgeMetres } };
}

export const PARAMS: Params = read();
