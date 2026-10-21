import { matchesAddress } from "../address.js";
import { geocoderJson, GeocoderError, type AddressToLocate, type SourcedPoint } from "../types.js";

export async function herePoint(a: AddressToLocate, signal: AbortSignal): Promise<SourcedPoint | null> {
  const url = new URL("https://geocode.search.hereapi.com/v1/geocode");
  url.search = new URLSearchParams({ q: `${a.street}, ${a.city}, ${a.state} ${a.zip ?? ""}`,
    in: "countryCode:USA", limit: "5", apiKey: process.env.HERE_API_KEY! }).toString();
  const body = await geocoderJson(url, signal);
  if (!Array.isArray(body.items)) throw new GeocoderError();
  const matches = body.items.flatMap((r: any): SourcedPoint[] => {
    const c = r.address ?? {};
    const accuracy = r.houseNumberType === "PA" ? "point" : r.houseNumberType === "interpolated" ? "interpolated" : null;
    if (r.resultType !== "houseNumber" || !accuracy || !matchesAddress(a, {
      house: c.houseNumber, street: c.street, city: c.city, state: c.stateCode ?? c.state,
      zip: c.postalCode, country: c.countryCode === "USA" ? "US" : c.countryCode,
    })) return [];
    return [{ provider: "here", source: "here", accuracy, lon: r.position?.lng, lat: r.position?.lat }];
  });
  return matches.length === 1 ? matches[0] : null;
}
