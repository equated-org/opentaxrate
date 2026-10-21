import { matchesAddress } from "../address.js";
import { geocoderJson, GeocoderError, type AddressToLocate, type SourcedPoint } from "../types.js";

export async function esriPoint(a: AddressToLocate, signal: AbortSignal): Promise<SourcedPoint | null> {
  const url = new URL("https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates");
  url.search = new URLSearchParams({ SingleLine: `${a.street}, ${a.city}, ${a.state} ${a.zip ?? ""}`,
    sourceCountry: "USA", outSR: "4326", outFields: "*", maxLocations: "5", locationType: "rooftop",
    forStorage: String(process.env.ARCGIS_FOR_STORAGE === "true"), f: "json", token: process.env.ARCGIS_API_KEY! }).toString();
  const body = await geocoderJson(url, signal);
  if (body.error || !Array.isArray(body.candidates)) throw new GeocoderError(body.error?.code);
  const matches = body.candidates.flatMap((r: any): SourcedPoint[] => {
    const c = r.attributes ?? {};
    const accuracy = ["PointAddress", "Subaddress"].includes(c.Addr_type) ? "rooftop" : c.Addr_type === "StreetAddress" ? "interpolated" : null;
    if (!accuracy || r.score < 95 || !Number.isFinite(r.score) || !matchesAddress(a, {
      house: c.AddNum, street: [c.StPreDir, c.StName, c.StType, c.StDir].filter(Boolean).join(" "),
      city: c.City, state: c.RegionAbbr ?? c.Region, zip: c.Postal, country: c.Country === "USA" ? "US" : c.Country,
    })) return [];
    return [{ provider: "esri", source: "esri", accuracy, lon: r.location?.x, lat: r.location?.y }];
  });
  return matches.length === 1 ? matches[0] : null;
}
