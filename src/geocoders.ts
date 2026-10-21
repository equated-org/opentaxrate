/**
 * The optional geocoder the engine asks beside the Census Bureau's and
 * OpenStreetMap's: Mapbox, when MAPBOX_ACCESS_TOKEN is set. Only a single
 * confident match in the state, with its house number placed on the street,
 * is used.
 */
import type { AddressToLocate } from "./engine/locate.js";
import type { LocatedPoint } from "./engine/types.js";

const ACCURACIES = ["rooftop", "parcel", "point", "interpolated"] as const;

export function mapboxGeocoder() {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) return undefined;
  return async (a: AddressToLocate): Promise<LocatedPoint | null> => {
    const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
    url.search = new URLSearchParams({
      q: [a.street, a.city, `${a.state} ${a.zip ?? ""}`.trim()].join(", "),
      country: "us",
      types: "address",
      autocomplete: "false",
      limit: "5",
      access_token: token,
    }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      features?: Array<{
        properties?: {
          coordinates?: { longitude: number; latitude: number; accuracy?: string };
          match_code?: { confidence?: string; address_number?: string; street?: string };
          context?: { region?: { region_code?: string } };
        };
      }>;
    };
    const matches = (body.features ?? []).flatMap(({ properties: p }) => {
      const accuracy = ACCURACIES.find((x) => x === p?.coordinates?.accuracy);
      const confident = ["exact", "high"].includes(p?.match_code?.confidence ?? "");
      const placed = p?.match_code?.address_number === "matched" && p?.match_code?.street === "matched";
      const inState = p?.context?.region?.region_code?.toUpperCase() === a.state;
      return accuracy && confident && placed && inState && p?.coordinates
        ? [{ lon: p.coordinates.longitude, lat: p.coordinates.latitude, accuracy }]
        : [];
    });
    return matches.length === 1 ? matches[0] : null;
  };
}
