/**
 * Places a US street address on the map by asking several geocoders at once
 * and keeping a point only where they agree:
 *   - the caller's own geocoder (Mapbox in the app), when it gives one;
 *   - the Census Bureau's geocoder, which matches the street's address range;
 *   - OpenStreetMap's Nominatim, when it finds the house itself.
 * The most precise point wins. When the points spread further apart than its
 * accuracy allows, a line must be at least that spread away; when they are
 * more than MAX_SPREAD apart, the address isn't placed at all.
 *
 * Nominatim's usage policy allows one request a second and asks for an
 * identifying user agent; requests here are spaced to match.
 */
import type { Trace } from "../rates/types.js";

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

/** The geocoders a trace can name. */
export type GeocoderName = "census" | "nominatim" | "mapbox";

/** To 5 decimals, about a metre. */
const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** Geocoders further apart than this leave the address unplaced. */
const MAX_SPREAD_METRES = 250;
const TIMEOUT_MS = 6_000;
const USER_AGENT = process.env.OPENTAXRATE_USER_AGENT || "opentaxrate (+https://github.com/opentaxrate/opentaxrate)";

export interface AddressToLocate {
  street: string;
  city: string;
  state: string;
  zip?: string | null;
}

type Source = (address: AddressToLocate) => Promise<LocatedPoint | null>;

const ACCURACY_ORDER: LocatedPoint["accuracy"][] = [
  "rooftop",
  "parcel",
  "point",
  "interpolated",
];

/** The address's point, or null when no geocoder places it or they disagree.
 *  `primary` is the caller's Mapbox geocoder. With a trace, each source's
 *  point and the point chosen are recorded in it. */
export async function locateAddress(
  address: AddressToLocate,
  primary?: Source,
  trace?: Trace,
): Promise<LocatedPoint | null> {
  const sources: Array<[GeocoderName, Source]> = [
    ["mapbox", primary],
    ["census", censusPoint],
    ["nominatim", nominatimPoint],
  ].filter((s): s is [GeocoderName, Source] => Boolean(s[1]));
  const settled = await Promise.allSettled(sources.map(([, s]) => s(address)));
  const points = settled.flatMap((r, i) =>
    r.status === "fulfilled" && r.value ? [{ ...r.value, source: sources[i][0] }] : [],
  );
  for (const p of points)
    trace?.geocoders.push({ source: p.source, lon: round5(p.lon), lat: round5(p.lat), accuracy: p.accuracy });
  if (!points.length) return null;
  points.sort(
    (a, b) =>
      ACCURACY_ORDER.indexOf(a.accuracy) - ACCURACY_ORDER.indexOf(b.accuracy),
  );
  const { source, ...best } = points[0];
  const spread = Math.max(...points.map((p) => metresBetween(best, p)));
  if (spread > MAX_SPREAD_METRES) return null;
  // Agreement within the best point's own margin keeps it; a wider spread
  // becomes the margin a line must be beyond.
  const chosen = spread > EDGE_METRES[best.accuracy] ? { ...best, metres: Math.ceil(spread) } : best;
  if (trace)
    trace.point = {
      lon: round5(chosen.lon),
      lat: round5(chosen.lat),
      accuracy: chosen.accuracy,
      source,
      marginMetres: marginOf(chosen),
      spreadMetres: Math.round(spread * 10) / 10,
    };
  return chosen;
}

/** The Census Bureau's match of the street's address range, if exactly one. */
async function censusPoint(a: AddressToLocate): Promise<LocatedPoint | null> {
  const url = new URL(
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress",
  );
  url.search = new URLSearchParams({
    address: `${a.street}, ${a.city}, ${a.state} ${a.zip ?? ""}`.trim(),
    benchmark: "Public_AR_Current",
    format: "json",
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    result?: {
      addressMatches?: Array<{
        coordinates: { x: number; y: number };
        addressComponents?: { state?: string };
      }>;
    };
  };
  const matches = (body.result?.addressMatches ?? []).filter(
    (m) => !m.addressComponents?.state || m.addressComponents.state === a.state,
  );
  if (matches.length !== 1) return null;
  const { x, y } = matches[0].coordinates;
  return { lon: x, lat: y, accuracy: "interpolated" };
}

let nominatimFree = 0;

/** OpenStreetMap's point for the house itself; nothing coarser. */
async function nominatimPoint(a: AddressToLocate): Promise<LocatedPoint | null> {
  const wait = nominatimFree - Date.now();
  nominatimFree = Math.max(Date.now(), nominatimFree) + 1_000;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    street: a.street,
    city: a.city,
    state: a.state,
    ...(a.zip ? { postalcode: a.zip.slice(0, 5) } : {}),
    countrycodes: "us",
    format: "jsonv2",
    addressdetails: "1",
    limit: "2",
  }).toString();
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const results = (await response.json()) as Array<{
    lat: string;
    lon: string;
    address?: { house_number?: string; "ISO3166-2-lvl4"?: string };
  }>;
  const houses = results.filter(
    (r) =>
      r.address?.house_number &&
      r.address["ISO3166-2-lvl4"] === `US-${a.state}`,
  );
  const points = houses.map((h): LocatedPoint => ({
    lon: Number(h.lon),
    lat: Number(h.lat),
    accuracy: "point",
  }));
  // The same house mapped twice (a node and a building) is one answer.
  if (!points.length || points.some((p) => metresBetween(points[0], p) > 50))
    return null;
  return points[0];
}

function metresBetween(a: LocatedPoint, b: LocatedPoint) {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * 110_540);
}
