import { matchesAddress } from "./match.js";
import { geocoderJson, GeocoderError, type AddressToLocate, type SourcedPoint } from "../types.js";

export async function googlePoint(a: AddressToLocate, signal: AbortSignal): Promise<SourcedPoint | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.search = new URLSearchParams({ address: `${a.street}, ${a.city}, ${a.state} ${a.zip ?? ""}`,
    components: "country:US", key: process.env.GOOGLE_MAPS_API_KEY! }).toString();
  const body = await geocoderJson(url, signal);
  if (body.status === "ZERO_RESULTS") return null;
  if (body.status !== "OK" || !Array.isArray(body.results)) throw new GeocoderError(body.status === "OVER_QUERY_LIMIT" ? 429 : 0);
  const matches = body.results.flatMap((r: any): SourcedPoint[] => {
    const component = (type: string, short = false) => r.address_components?.find((c: any) => c.types?.includes(type))?.[short ? "short_name" : "long_name"];
    const accuracy = r.geometry?.location_type === "ROOFTOP" ? "rooftop" : r.geometry?.location_type === "RANGE_INTERPOLATED" ? "interpolated" : null;
    if (!accuracy || r.partial_match || !matchesAddress(a, {
      house: component("street_number"), street: component("route"), city: component("locality"),
      state: component("administrative_area_level_1", true), zip: component("postal_code"), country: component("country", true),
    })) return [];
    return [{ provider: "google", source: "google", accuracy, lon: r.geometry?.location?.lng, lat: r.geometry?.location?.lat }];
  });
  return matches.length === 1 ? matches[0] : null;
}
