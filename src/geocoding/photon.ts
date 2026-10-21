import { parseStreet } from "../address.js";
import { matchesAddress, normalized } from "./address.js";
import { geocoderJson, GeocoderError, type AddressToLocate, type LocatedPoint } from "./types.js";

interface Feature {
  geometry?: { type?: string; coordinates?: number[] };
  properties?: {
    type?: string;
    housenumber?: string;
    street?: string;
    city?: string;
    state?: string;
    postcode?: string;
    countrycode?: string;
  };
}

/** An optional internal OSM geocoder. A search suggestion is not a match. */
export function photonGeocoder() {
  const endpoint = process.env.PHOTON_URL?.trim();
  if (!endpoint) return undefined;

  return async (a: AddressToLocate, signal = AbortSignal.timeout(6_000)): Promise<LocatedPoint | null> => {
    const requested = parseStreet(a.street);
    if (!requested || requested.streetKey === "POBOX") return null;
    const state = normalized(a.state);
    const url = new URL(`${endpoint.replace(/\/+$/, "")}/api`);
    url.search = new URLSearchParams({
      q: [a.street, a.city, `${state} ${a.zip ?? ""}`.trim()].join(", "),
      countrycode: "US",
      limit: "5",
    }).toString();
    const body = await geocoderJson(url, signal) as { features?: Feature[] };
    if (!Array.isArray(body.features)) throw new GeocoderError();
    const points: LocatedPoint[] = [];
    for (const feature of body.features ?? []) {
      const p = feature.properties;
      const coordinates = feature.geometry?.coordinates;
      if (feature.geometry?.type !== "Point" || !coordinates || coordinates.length !== 2) continue;
      const [lon, lat] = coordinates;
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)
        throw new GeocoderError();
      if (!p?.housenumber || !p.street || p.type !== "house" || p.countrycode?.toUpperCase() !== "US") continue;
      if (!matchesAddress(a, { house: p.housenumber, street: p.street, city: p.city,
        state: p.state, zip: p.postcode, country: p.countrycode })) continue;
      points.push({ lon, lat, accuracy: "point" });
    }
    if (!points.length) return null;
    // Nearby duplicate objects are acceptable; distant matches are ambiguous.
    const best = points[0];
    const spread = Math.max(...points.map(p => Math.hypot(
      (p.lon - best.lon) * 111_320 * Math.cos(best.lat * Math.PI / 180),
      (p.lat - best.lat) * 110_540,
    )));
    if (spread > 50) return null;
    return spread > 40 ? { ...best, metres: Math.ceil(spread) } : best;
  };
}
