/**
 * The shapes every address-rate engine shares: a rate's parts, and its
 * rates by type of sale.
 */
import type { LocatedPoint } from "../geocoding/types.js";

export interface RatePart {
  kind: "state" | "county" | "city" | "district";
  /** The publisher's jurisdiction type and code, e.g. "00:061". */
  code: string;
  rate: number;
  /** This part's rate for each kind of sale, where its file rates them apart. */
  byType?: RatesByType;
}

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
