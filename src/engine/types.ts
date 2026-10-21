/**
 * The shapes every address-rate engine shares: a rate's parts, a geocoded
 * point, and how close to a line a point may be for its geocode's accuracy.
 */

export interface RatePart {
  kind: "state" | "county" | "city" | "district";
  /** The publisher's jurisdiction type and code, e.g. "00:061". */
  code: string;
  rate: number;
}

/** Where a geocoder put an address, and how it got there. */
export interface LocatedPoint {
  lon: number;
  lat: number;
  accuracy: "rooftop" | "parcel" | "point" | "interpolated";
  /** A wider margin than the accuracy's, when geocoders placed it apart. */
  metres?: number;
}

/** How near a line the point may be before it could be on either side. */
export const marginOf = (p: LocatedPoint) => p.metres ?? EDGE_METRES[p.accuracy];

/** How close to a county, city or district line a point may be before it
 *  could be on either side, by how the geocoder placed it. */
export const EDGE_METRES: Record<LocatedPoint["accuracy"], number> = {
  rooftop: 15,
  parcel: 25,
  point: 40,
  interpolated: 75,
};
