/**
 * The shapes every address-rate engine shares: a rate's parts, and its
 * rates by type of sale.
 */
import type { LocatedPoint } from "../geocoding/types.js";

export interface RatePart {
  kind: "state" | "county" | "city" | "district";
  /** The jurisdiction's name ("Washington", "King County", "Seattle"); null
   *  where no loaded source names it, as for most Streamlined districts. */
  name?: string | null;
  /** The publisher's jurisdiction type and code, e.g. "00:061". */
  code: string;
  rate: number;
  /** This part's rate for each kind of sale, where its file rates them apart. */
  byType?: RatesByType;
  /** This part's rate on a class of sale its publisher rates apart from the
   *  general sale (RATE_CLASSES), on the answer's date, where one is loaded
   *  (sales_tax_class_rates): Glendale, Arizona's city restaurant rate
   *  3.9% beside its 2.9% retail rate. Absent for a class with none loaded;
   *  never filled in from the general rate. Read by taxability rules that
   *  name a class (rateClass), never by the general rate. */
  classRates?: ClassRates;
  /** Where a class's rate turns on a fact the address doesn't settle (an
   *  Illinois Metro East location's grocery rate, for a retailer liable or
   *  not for the district's tax), each case and its rate, as the publisher
   *  states them, in place of a classRates entry. */
  classCases?: ClassCases;
  /** The state's own ids for this jurisdiction, keyed by its data's column
   *  names and unchanged ({"Locality Code": "9454", "Administered": "SELF"});
   *  {} where its data publishes none. Set on every answered part. */
  ids?: Record<string, string>;
}

/** The classes of sale a publisher rates apart from the general sale, as
 *  parts carry them (RatePart.classRates):
 *    restaurant  food and drink sold by a restaurant or bar: Arizona's
 *                restaurants and bars class (business code 011, plus a
 *                city's additional tax, 111), Utah's county restaurant tax
 *                on top of the combined rate;
 *    grocery     food for home consumption: Arizona's city rate on it
 *                (062), Alabama's local food rates (GROC), Illinois's local
 *                grocery rates from 2026. */
export const RATE_CLASSES = ["restaurant", "grocery"] as const;
export type RateClass = (typeof RATE_CLASSES)[number];
export type ClassRates = Partial<Record<RateClass, number>>;
export type ClassCases = Partial<Record<RateClass, Array<{ when: string; rate: number }>>>;

/** One combination of jurisdictions an address could be in, and its parts. */
export interface Breakdown {
  locationCode: string | null;
  parts: RatePart[];
}

/** Two breakdowns name the same jurisdictions at the same rates. */
export const sameBreakdown = (a: { parts: RatePart[] }, b: { parts: RatePart[] }) => {
  const key = (x: { parts: RatePart[] }) => x.parts.map((p) => `${p.code}=${p.rate}`).sort().join(" ");
  return key(a) === key(b);
};

/** A rate for each kind of sale the Streamlined files rate apart. `general`
 *  is the rate on a general sale from within the state; the others are null
 *  where the publisher gives none. A food and drug rate is what applies
 *  where the state taxes food at its food rate, not whether an item is
 *  taxable. */
export interface RatesByType {
  general: number;
  generalInterstate: number | null;
  foodDrug: number | null;
  foodDrugInterstate: number | null;
}

export const RATE_TYPES = ["general", "generalInterstate", "foodDrug", "foodDrugInterstate"] as const;

/** Only the general rate known. */
export const generalOnly = (rate: number): RatesByType => ({
  general: rate,
  generalInterstate: null,
  foodDrug: null,
  foodDrugInterstate: null,
});

/** Parts' rates added type by type; a type any part lacks is unknown. */
export function sumByType(parts: RatesByType[]): RatesByType {
  const sum = (type: (typeof RATE_TYPES)[number]) => {
    let total = 0;
    for (const p of parts) {
      const r = p[type];
      if (r === null) return null;
      total += r;
    }
    return Math.round(total * 1e6) / 1e6;
  };
  return {
    general: sum("general")!,
    generalInterstate: sum("generalInterstate"),
    foodDrug: sum("foodDrug"),
    foodDrugInterstate: sum("foodDrugInterstate"),
  };
}

/** The types every one of `rates` agrees on; null for the rest. */
export function agreedByType(rates: RatesByType[]): RatesByType {
  const agreed = { ...rates[0] };
  for (const type of RATE_TYPES.slice(1) as Exclude<(typeof RATE_TYPES)[number], "general">[])
    if (rates.some((r) => r[type] !== agreed[type])) agreed[type] = null;
  return agreed;
}

/** A polygon outline as GeoJSON, for drawing. */
export interface OutlineGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
}

/** One outline the map test looked at, as a trace records it. */
export interface TracedOutline {
  kind: "county" | "place" | "cousub" | "district";
  fips: string;
  name: string;
  inside: boolean;
  /** Metres from the point to the outline's nearest edge. */
  edgeMetres: number;
  /** The nearest point on that edge. */
  foot: { lon: number; lat: number };
  /** Whether the outline added a part to the rate. */
  levies: boolean;
  /** The outline near the point, clipped and simplified for display; added
   *  by the HTTP layer, never read by an engine. */
  geometry?: OutlineGeometry;
}

/** How a lookup placed the address, for showing on a map. An engine given
 *  one pushes into it as it goes; nothing reads it back, so a lookup
 *  without one answers exactly the same. Coordinates are rounded to 5
 *  decimals (about a metre). */
export interface Trace {
  /** Every point a geocoder returned. */
  geocoders: Array<{ source: string; lon: number; lat: number; accuracy: LocatedPoint["accuracy"] }>;
  /** The point the engine used, and the margin a line must be beyond. */
  point?: {
    lon: number;
    lat: number;
    accuracy: LocatedPoint["accuracy"];
    source: string;
    marginMetres: number;
    /** The largest distance from it to an agreeing geocoder's point. */
    spreadMetres: number;
  };
  /** The outlines around the point; empty when no point was used. */
  outlines: TracedOutline[];
  /** Range engine: the street range row that decided, when one did. */
  range?: { street: string; low: number; high: number; side: "odd" | "even" | "both"; zip: string | null; file: string };
}

export const emptyTrace = (): Trace => ({ geocoders: [], outlines: [] });

/** To 5 decimals, about a metre. */
export const roundCoord = (n: number) => Math.round(n * 1e5) / 1e5;

/** An outline as a trace records it; `levies` is set once the rate is known.
 *  Recording the same outline twice keeps the later one. */
export function traceOutline(
  trace: Trace,
  s: { kind: TracedOutline["kind"]; fips: string; name: string; inside: boolean; edgeMetres: number; foot: { lon: number; lat: number } },
): TracedOutline {
  const outline: TracedOutline = {
    kind: s.kind,
    fips: s.fips,
    name: s.name,
    inside: s.inside,
    edgeMetres: Math.round(s.edgeMetres * 10) / 10,
    foot: { lon: roundCoord(s.foot.lon), lat: roundCoord(s.foot.lat) },
    levies: false,
  };
  const at = trace.outlines.findIndex((o) => o.kind === s.kind && o.fips === s.fips);
  if (at >= 0) trace.outlines[at] = outline;
  else trace.outlines.push(outline);
  return outline;
}
