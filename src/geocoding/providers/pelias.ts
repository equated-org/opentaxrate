import { matchesAddress } from "../address.js";
import { geocoderJson, GeocoderError, type AddressToLocate, type SourcedPoint } from "../types.js";

export async function peliasPoint(a: AddressToLocate, signal: AbortSignal): Promise<SourcedPoint | null> {
  const url = new URL(`${process.env.PELIAS_URL!.replace(/\/+$/, "")}/v1/search`);
  url.search = new URLSearchParams({ text: `${a.street}, ${a.city}, ${a.state} ${a.zip ?? ""}`,
    "boundary.country": "USA", layers: "address", size: "5" }).toString();
  const body = await geocoderJson(url, signal);
  if (!Array.isArray(body.features)) throw new GeocoderError();
  const matches = body.features.flatMap((f: any): SourcedPoint[] => {
    const p = f.properties ?? {};
    if (p.layer !== "address" || p.accuracy !== "point" || p.match_type !== "exact"
      || !matchesAddress(a, { house: p.housenumber, street: p.street, city: p.locality,
        state: p.region_a ?? p.region, zip: p.postalcode, country: p.country_a === "USA" ? "US" : p.country_a })) return [];
    const source = p.source === "openstreetmap" ? "osm" : p.source === "openaddresses" ? "openaddresses" : "unknown";
    return [{ provider: "pelias", source, accuracy: "point", lon: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] }];
  });
  return matches.length === 1 ? matches[0] : null;
}
