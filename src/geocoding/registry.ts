import { createHash } from "node:crypto";
import { photonGeocoder } from "./photon.js";
import { mapboxGeocoder } from "./mapbox.js";
import { censusPoint } from "./providers/census.js";
import { geocodioPoint } from "./providers/geocodio.js";
import { peliasPoint } from "./providers/pelias.js";
import { smartyPoint } from "./providers/smarty.js";
import { herePoint } from "./providers/here.js";
import { esriPoint } from "./providers/esri.js";
import { googlePoint } from "./providers/google.js";
import type { GeocoderProvider, LocatedPoint } from "./types.js";

export const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");
function setting(name: string, fallback: number, integer = false) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) throw new Error(`Invalid ${name}`);
  return value;
}

/** Configuration is read per lookup; absent keys/URLs never enable a vendor. */
export function geocoderProviders(): GeocoderProvider[] {
  const providers: GeocoderProvider[] = [];
  function add(id: string, credential: string | undefined, sources: string[], typicalAccuracy: LocatedPoint["accuracy"],
    cost: number, cap: number, rate: number, storable: boolean, geocode: GeocoderProvider["geocode"], mode = "") {
    if (!credential?.trim()) return;
    const prefix = id === "esri" ? "ARCGIS" : id.toUpperCase();
    const budgetId = `${id}:${fingerprint(credential)}`;
    providers.push({ id, budgetId, cacheId: `${budgetId}:${mode}`, sources, typicalAccuracy, storable, geocode,
      costPerCall: setting(`${prefix}_COST_PER_CALL`, cost), dailyCap: setting(`${prefix}_DAILY_CAP`, cap, true),
      ratePerSecond: setting(`${prefix}_RATE_PER_SECOND`, rate) });
  }
  if (process.env.CENSUS_DISABLED !== "true")
    add("census", "Public_AR_Current", ["tiger"], "interpolated", 0, 100_000, 10, true, censusPoint);
  const photon = photonGeocoder();
  if (photon) add("photon", process.env.PHOTON_URL, ["osm"], "point", 0, 100_000, 10, true,
    async (a, signal) => { const p = await photon(a, signal); return p && { ...p, provider: "photon", source: "osm" }; });
  add("pelias", process.env.PELIAS_URL, ["osm", "openaddresses"], "point", 0, 100_000, 10, true, peliasPoint);
  add("geocodio", process.env.GEOCODIO_API_KEY, ["unknown"], "rooftop", 0.0005, 2500, 5, true, geocodioPoint);
  add("smarty", process.env.SMARTY_AUTH_ID && process.env.SMARTY_AUTH_TOKEN
    ? `${process.env.SMARTY_AUTH_ID}:${process.env.SMARTY_AUTH_TOKEN}` : undefined,
    ["smarty"], "rooftop", 0.001, 100, 5, false, smartyPoint);
  const mapbox = mapboxGeocoder();
  const permanent = process.env.MAPBOX_PERMANENT === "true";
  if (mapbox) add("mapbox", process.env.MAPBOX_ACCESS_TOKEN, ["mapbox"], "rooftop", 0.001, 300, 5, permanent,
    async (a, signal) => { const p = await mapbox(a, signal); return p && { ...p, provider: "mapbox", source: "mapbox" }; }, String(permanent));
  add("here", process.env.HERE_API_KEY, ["here"], "point", 0.001, 300, 5, false, herePoint);
  const forStorage = process.env.ARCGIS_FOR_STORAGE === "true";
  add("esri", process.env.ARCGIS_API_KEY, ["esri"], "rooftop", 0.004, 300, 5, forStorage, esriPoint, String(forStorage));
  add("google", process.env.GOOGLE_MAPS_API_KEY, ["google"], "rooftop", 0.005, 300, 5, false, googlePoint);
  return providers.sort((a, b) => a.costPerCall - b.costPerCall || a.id.localeCompare(b.id));
}

export function geocoderCoverage() {
  return geocoderProviders().map(({ id, sources, typicalAccuracy, dailyCap, ratePerSecond, storable }) =>
    ({ id, sources, typicalAccuracy, dailyCap, ratePerSecond, storable }));
}
