import { matchesAddress } from "./match.js";
import { geocoderJson, GeocoderError, type AddressToLocate, type SourcedPoint } from "../types.js";

export async function geocodioPoint(a: AddressToLocate, signal: AbortSignal): Promise<SourcedPoint | null> {
  const url = new URL("https://api.geocod.io/v2/geocode");
  url.search = new URLSearchParams({ street: a.street, city: a.city, state: a.state,
    postal_code: a.zip ?? "", country: "US", limit: "2", api_key: process.env.GEOCODIO_API_KEY! }).toString();
  const body = await geocoderJson(url, signal);
  if (!Array.isArray(body.results)) throw new GeocoderError();
  const matches = body.results.flatMap((r: any): SourcedPoint[] => {
    const c = r.address_components ?? {};
    const accuracy = ({ rooftop: "rooftop", point: "point", range_interpolation: "interpolated" } as const)[r.accuracy_type as string];
    if (!accuracy || r.accuracy < 0.9 || !Number.isFinite(r.accuracy) || !matchesAddress(a, {
      house: c.number, street: c.formatted_street, city: c.city,
      state: c.state_province ?? c.state, zip: c.postal_code ?? c.zip, country: c.country ?? "US",
    })) return [];
    // Geocodio's TIGER interpolation is the Census Bureau's data, not a second opinion.
    const source = /tiger|census/i.test(String(r.source ?? "")) ? "tiger" : "geocodio";
    return [{ provider: "geocodio", source, accuracy, lon: r.location?.lng, lat: r.location?.lat }];
  });
  return matches.length === 1 ? matches[0] : null;
}
