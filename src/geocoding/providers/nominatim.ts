/**
 * OpenStreetMap's Nominatim: your own when NOMINATIM_URL is set, else the
 * public server, whose usage policy allows one request a second and asks for
 * an identifying user agent (OPENTAXRATE_USER_AGENT). Only a house it finds
 * itself counts, and copies of it more than 50 m apart are ambiguous.
 */
import { matchesAddress } from "./match.js";
import { GeocoderError, metresBetween, type AddressToLocate, type SourcedPoint } from "../types.js";

export const PUBLIC_NOMINATIM = "https://nominatim.openstreetmap.org";
const USER_AGENT = process.env.OPENTAXRATE_USER_AGENT || "opentaxrate (+https://github.com/opentaxrate/opentaxrate)";

interface Result {
  lat?: string;
  lon?: string;
  address?: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    "ISO3166-2-lvl4"?: string;
    postcode?: string;
    country_code?: string;
  };
}

export async function nominatimPoint(a: AddressToLocate, signal: AbortSignal): Promise<SourcedPoint | null> {
  const url = new URL(`${(process.env.NOMINATIM_URL?.trim() || PUBLIC_NOMINATIM).replace(/\/+$/, "")}/search`);
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
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal });
  if (!response.ok) throw new GeocoderError(response.status);
  const body = (await response.json()) as Result[];
  if (!Array.isArray(body)) throw new GeocoderError();
  const points = body.flatMap(({ lat, lon, address: c }): SourcedPoint[] =>
    c && matchesAddress(a, {
      house: c.house_number, street: c.road, city: c.city ?? c.town ?? c.village ?? c.hamlet,
      state: c["ISO3166-2-lvl4"]?.replace(/^US-/, ""), zip: c.postcode, country: c.country_code?.toUpperCase(),
    }) ? [{ lon: Number(lon), lat: Number(lat), accuracy: "point", provider: "nominatim", source: "osm" }] : []);
  if (!points.length || points.some((p) => metresBetween(points[0], p) > 50)) return null;
  return points[0];
}
