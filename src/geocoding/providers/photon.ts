/**
 * A self-hosted Photon (PHOTON_URL), OpenStreetMap's house points. A search
 * suggestion is not a match: only a house whose returned address matches the
 * typed one counts, and copies of it more than 50 m apart are ambiguous.
 */
import { parseStreet } from "../../address.js";
import { matchesAddress, normalized } from "./match.js";
import { geocoderJson, GeocoderError, metresBetween, type AddressToLocate, type SourcedPoint } from "../types.js";

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

export async function photonPoint(a: AddressToLocate, signal: AbortSignal): Promise<SourcedPoint | null> {
  const requested = parseStreet(a.street);
  if (!requested || requested.streetKey === "POBOX") return null;
  const url = new URL(`${process.env.PHOTON_URL!.trim().replace(/\/+$/, "")}/api`);
  url.search = new URLSearchParams({
    q: [a.street, a.city, `${normalized(a.state)} ${a.zip ?? ""}`.trim()].join(", "),
    countrycode: "US",
    limit: "5",
  }).toString();
  const body = (await geocoderJson(url, signal)) as { features?: Feature[] };
  if (!Array.isArray(body.features)) throw new GeocoderError();
  const points = body.features.flatMap(({ geometry, properties: p }): SourcedPoint[] => {
    const [lon, lat] = geometry?.type === "Point" && geometry.coordinates?.length === 2 ? geometry.coordinates : [];
    if (p?.type !== "house" || !matchesAddress(a, { house: p.housenumber, street: p.street, city: p.city,
      state: p.state, zip: p.postcode, country: p.countrycode?.toUpperCase() })) return [];
    return [{ lon, lat, accuracy: "point", provider: "photon", source: "osm" }];
  });
  if (!points.length) return null;
  const spread = Math.max(...points.map((p) => metresBetween(points[0], p)));
  if (spread > 50) return null;
  return spread > 40 ? { ...points[0], metres: Math.ceil(spread) } : points[0];
}
