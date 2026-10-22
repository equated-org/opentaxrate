import { matchesAddress } from "./match.js";
import { geocoderJson, GeocoderError, metresBetween, type AddressToLocate, type SourcedPoint } from "../types.js";
import { PARAMS } from "../../params.js";

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
    const source = p.source === "openstreetmap" ? "osm" : p.source === "openaddresses" ? "openaddresses" : "pelias";
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
    return [{ provider: "pelias", source, accuracy: "point", lon, lat }];
  });
  if (!matches.length) return null;
  // The same house from several datasets is one answer, its margin wide
  // enough to reach them all; houses farther apart are different places.
  const [first] = matches;
  const spread = Math.max(...matches.map((m: SourcedPoint) => metresBetween(first, m)));
  if (spread > PARAMS.peliasDuplicateMetres) return null;
  return spread > 0 ? { ...first, metres: Math.ceil(spread) } : first;
}
