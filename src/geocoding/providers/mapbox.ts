/**
 * Mapbox's forward geocoder (MAPBOX_ACCESS_TOKEN). Only a single confident
 * match in the state, with its house number placed on the street, is used.
 */
import { geocoderJson, GeocoderError, type AddressToLocate, type SourcedPoint } from "../types.js";

const ACCURACIES = ["rooftop", "parcel", "point", "interpolated"] as const;

interface Feature {
  properties?: {
    coordinates?: { longitude: number; latitude: number; accuracy?: string };
    match_code?: { confidence?: string; address_number?: string; street?: string };
    context?: { region?: { region_code?: string } };
  };
}

export async function mapboxPoint(a: AddressToLocate, signal: AbortSignal): Promise<SourcedPoint | null> {
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.search = new URLSearchParams({
    q: [a.street, a.city, `${a.state} ${a.zip ?? ""}`.trim()].join(", "),
    country: "us",
    types: "address",
    autocomplete: "false",
    limit: "5",
    access_token: process.env.MAPBOX_ACCESS_TOKEN!,
    ...(process.env.MAPBOX_PERMANENT === "true" ? { permanent: "true" } : {}),
  }).toString();
  const body = (await geocoderJson(url, signal)) as { features?: Feature[] };
  if (!Array.isArray(body.features)) throw new GeocoderError();
  const matches = body.features.flatMap(({ properties: p }): SourcedPoint[] => {
    const accuracy = ACCURACIES.find((x) => x === p?.coordinates?.accuracy);
    const confident = ["exact", "high"].includes(p?.match_code?.confidence ?? "");
    const placed = p?.match_code?.address_number === "matched" && p?.match_code?.street === "matched";
    const inState = p?.context?.region?.region_code?.toUpperCase() === a.state;
    return accuracy && confident && placed && inState && p?.coordinates
      ? [{ lon: p.coordinates.longitude, lat: p.coordinates.latitude, accuracy, provider: "mapbox", source: "mapbox" }]
      : [];
  });
  return matches.length === 1 ? matches[0] : null;
}
