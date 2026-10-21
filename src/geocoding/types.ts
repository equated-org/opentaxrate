export interface LocatedPoint {
  lon: number;
  lat: number;
  accuracy: "rooftop" | "parcel" | "point" | "interpolated";
  metres?: number;
  /** Providers and underlying datasets supporting this placement. */
  placedBy?: string[];
}

export const EDGE_METRES: Record<LocatedPoint["accuracy"], number> = {
  rooftop: 15, parcel: 25, point: 40, interpolated: 75,
};
export const marginOf = (p: LocatedPoint) => Math.max(EDGE_METRES[p.accuracy], p.metres ?? 0);

export interface AddressToLocate {
  street: string;
  city: string;
  state: string;
  zip?: string | null;
}
export type Locate = (need?: { marginUnder: number }) => Promise<LocatedPoint | null>;
export interface SourcedPoint extends LocatedPoint { provider: string; source: string }
export interface GeocoderProvider {
  id: string;
  /** Isolates endpoints, credentials, and response-affecting configuration. */
  cacheId: string;
  budgetId: string;
  sources: string[];
  typicalAccuracy: LocatedPoint["accuracy"];
  costPerCall: number;
  ratePerSecond: number;
  dailyCap: number;
  storable: boolean;
  /** null means a successful, definitive no-match. Failures must throw. */
  geocode(address: AddressToLocate, signal: AbortSignal): Promise<SourcedPoint | null>;
}
export class GeocoderError extends Error {
  constructor(readonly status = 0) { super(`Geocoder request failed (${status})`); }
}
export async function geocoderJson(url: URL, signal: AbortSignal): Promise<any> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new GeocoderError(response.status);
  const body = await response.json();
  if (!body || typeof body !== "object") throw new GeocoderError();
  return body;
}
export function validPoint(p: LocatedPoint): boolean {
  return Number.isFinite(p.lon) && Math.abs(p.lon) <= 180 && Number.isFinite(p.lat) && Math.abs(p.lat) <= 90
    && Object.hasOwn(EDGE_METRES, p.accuracy) && (p.metres === undefined || (Number.isFinite(p.metres) && p.metres >= 0));
}
export function metresBetween(a: LocatedPoint, b: LocatedPoint) {
  return Math.hypot((a.lon - b.lon) * 111_320 * Math.cos((a.lat + b.lat) * Math.PI / 360),
    (a.lat - b.lat) * 110_540);
}
