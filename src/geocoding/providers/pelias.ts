import { matchesAddress } from "./match.js";
import { geocoderJson, GeocoderError, metresBetween, validPoint, type AddressToLocate, type SourcedPoint } from "../types.js";
import { PARAMS } from "../../params.js";

export async function peliasPoint(a: AddressToLocate, signal: AbortSignal): Promise<SourcedPoint | null> {
  const url = new URL(`${process.env.PELIAS_URL!.replace(/\/+$/, "")}/v1/search`);
  url.search = new URLSearchParams({ text: `${a.street}, ${a.city}, ${a.state} ${a.zip ?? ""}`,
    "boundary.country": "USA", layers: "address", size: "5" }).toString();
  const body = await geocoderJson(url, signal);
  if (!Array.isArray(body.features)) throw new GeocoderError();
  const matches: SourcedPoint[] = body.features.flatMap((f: any): SourcedPoint[] => {
    const p = f.properties ?? {};
    if (p.layer !== "address" || p.accuracy !== "point" || p.match_type !== "exact"
      || !matchesAddress(a, { house: p.housenumber, street: p.street, city: p.locality,
        state: p.region_a ?? p.region, zip: p.postalcode, country: p.country_a === "USA" ? "US" : p.country_a })) return [];
    // Public address aggregators share upstream government datasets. Treat
    // them as one family; Overture can also redistribute OpenStreetMap.
    const upstream = p.addendum?.provenance?.sources;
    const osm = p.source === "openstreetmap" || (p.source === "overtureaddresses"
      && Array.isArray(upstream) && upstream.some((s: any) => /openstreetmap|\bosm\b/i.test(s?.dataset ?? "")));
    const source = osm ? "osm" : ["openaddresses", "nad", "nyc", "overtureaddresses"].includes(p.source) ? "openaddresses" : "pelias";
    const point: SourcedPoint = { provider: "pelias", source, accuracy: "point",
      lon: f.geometry?.coordinates?.[0], lat: f.geometry?.coordinates?.[1] };
    return validPoint(point) ? [point] : [];
  });
  if (!matches.length) return null;
  // Several copies of the same address are one placement. Keep an OSM
  // lineage when any matching copy has it, and cover the point spread.
  const first = matches[0];
  const spread = Math.max(...matches.map(p => metresBetween(first, p)));
  if (spread > PARAMS.peliasDuplicateMetres) return null;
  return { ...first, source: matches.some(p => p.source === "osm") ? "osm" : first.source,
    ...(spread > 0 ? { metres: Math.ceil(spread) } : {}) };
}
