import { geocoderJson, GeocoderError, type AddressToLocate, type SourcedPoint } from "../types.js";

export async function censusPoint(a: AddressToLocate, signal: AbortSignal): Promise<SourcedPoint | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.search = new URLSearchParams({ address: `${a.street}, ${a.city}, ${a.state} ${a.zip ?? ""}`.trim(),
    benchmark: "Public_AR_Current", format: "json" }).toString();
  const body = await geocoderJson(url, signal);
  if (!Array.isArray(body.result?.addressMatches)) throw new GeocoderError();
  const matches = body.result.addressMatches.filter((m: any) => m.addressComponents?.state === a.state);
  if (matches.length !== 1) return null;
  return { lon: matches[0].coordinates?.x, lat: matches[0].coordinates?.y,
    accuracy: "interpolated", provider: "census", source: "tiger" };
}
