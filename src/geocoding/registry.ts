/**
 * The geocoders this deployment can ask: each provider's defaults, enabled
 * only when its credential or URL is set. Census and OpenStreetMap's public
 * Nominatim need none, so a deployment with no keys still has two datasets
 * to compare; NOMINATIM_URL points at your own Nominatim instead. Read per
 * lookup, so a changed environment takes effect without a restart.
 */
import { createHash } from "node:crypto";
import { censusPoint } from "./providers/census.js";
import { esriPoint } from "./providers/esri.js";
import { geocodioPoint } from "./providers/geocodio.js";
import { googlePoint } from "./providers/google.js";
import { herePoint } from "./providers/here.js";
import { mapboxPoint } from "./providers/mapbox.js";
import { nominatimPoint, PUBLIC_NOMINATIM } from "./providers/nominatim.js";
import { peliasPoint } from "./providers/pelias.js";
import { photonPoint } from "./providers/photon.js";
import { smartyPoint } from "./providers/smarty.js";
import type { GeocoderProvider, LocatedPoint } from "./types.js";
import type { ProviderPolicy } from "../access.js";
import { PARAMS } from "../params.js";

export const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

interface Definition {
  id: string;
  /** The credential or URL that enables it; its fingerprint keys the budget. */
  credential: () => string | undefined;
  /** Prefix of its <PREFIX>_DAILY_CAP, _RATE_PER_SECOND and _COST_PER_CALL overrides. */
  env: string;
  sources: string[];
  typicalAccuracy: LocatedPoint["accuracy"];
  costPerCall: number;
  /** List price per call (dollars, checked 2026-10-22; see the landing's
   *  pricing.json), past any free tier, for results that aren't stored:
   *  what an account's geocoder allowance pays. Kept apart from costPerCall,
   *  which orders the providers. */
  price: number;
  dailyCap: number;
  /** Calls a second, or a function of the configuration. */
  ratePerSecond: number | (() => number);
  /** Whether its terms allow caching results; a mode that changes this keys its own cache. */
  storable: () => boolean;
  geocode: GeocoderProvider["geocode"];
}

const env = (name: string) => process.env[name]?.trim() || undefined;
const flag = (name: string) => process.env[name] === "true";

const DEFINITIONS: Definition[] = [
  { id: "census", credential: () => (flag("CENSUS_DISABLED") ? undefined : "Public_AR_Current"), env: "CENSUS",
    sources: ["tiger"], typicalAccuracy: "interpolated", costPerCall: 0, price: 0, dailyCap: 100_000, ratePerSecond: 10,
    storable: () => true, geocode: censusPoint },
  { id: "nominatim", credential: () => (flag("NOMINATIM_DISABLED") ? undefined : env("NOMINATIM_URL") ?? PUBLIC_NOMINATIM),
    env: "NOMINATIM", sources: ["osm"], typicalAccuracy: "point", costPerCall: 0, price: 0, dailyCap: 100_000,
    // The public server's usage policy: one request a second.
    ratePerSecond: () => (env("NOMINATIM_URL") ? 10 : 1), storable: () => true, geocode: nominatimPoint },
  { id: "photon", credential: () => env("PHOTON_URL"), env: "PHOTON",
    sources: ["osm"], typicalAccuracy: "point", costPerCall: 0, price: 0, dailyCap: 100_000, ratePerSecond: 10,
    storable: () => true, geocode: photonPoint },
  { id: "pelias", credential: () => env("PELIAS_URL"), env: "PELIAS",
    sources: ["osm", "openaddresses"], typicalAccuracy: "point", costPerCall: 0, price: 0, dailyCap: 100_000, ratePerSecond: 10,
    storable: () => true, geocode: peliasPoint },
  { id: "geocodio", credential: () => env("GEOCODIO_API_KEY"), env: "GEOCODIO",
    sources: ["geocodio", "tiger"], typicalAccuracy: "rooftop", costPerCall: 0.0005, price: 0.001, dailyCap: 2500, ratePerSecond: 5,
    storable: () => true, geocode: geocodioPoint },
  { id: "smarty", credential: () => (env("SMARTY_AUTH_ID") && env("SMARTY_AUTH_TOKEN") ? `${env("SMARTY_AUTH_ID")}:${env("SMARTY_AUTH_TOKEN")}` : undefined),
    env: "SMARTY", sources: ["smarty"], typicalAccuracy: "rooftop", costPerCall: 0.001, price: 0.001, dailyCap: 100, ratePerSecond: 5,
    storable: () => false, geocode: smartyPoint },
  { id: "mapbox", credential: () => env("MAPBOX_ACCESS_TOKEN"), env: "MAPBOX",
    sources: ["mapbox"], typicalAccuracy: "rooftop", costPerCall: 0.001, price: 0.00075, dailyCap: 300, ratePerSecond: 5,
    storable: () => flag("MAPBOX_PERMANENT"), geocode: mapboxPoint },
  { id: "here", credential: () => env("HERE_API_KEY"), env: "HERE",
    sources: ["here"], typicalAccuracy: "point", costPerCall: 0.001, price: 0.00083, dailyCap: 300, ratePerSecond: 5,
    storable: () => false, geocode: herePoint },
  { id: "esri", credential: () => env("ARCGIS_API_KEY"), env: "ARCGIS",
    sources: ["esri"], typicalAccuracy: "rooftop", costPerCall: 0.004, price: 0.0005, dailyCap: 300, ratePerSecond: 5,
    storable: () => flag("ARCGIS_FOR_STORAGE"), geocode: esriPoint },
  { id: "google", credential: () => env("GOOGLE_MAPS_API_KEY"), env: "GOOGLE",
    sources: ["google"], typicalAccuracy: "rooftop", costPerCall: 0.005, price: 0.005, dailyCap: 300, ratePerSecond: 5,
    storable: () => false, geocode: googlePoint },
];

/** An override from the environment, or the default when unset or invalid:
 *  a mistyped setting must not stop every lookup. */
function setting(name: string, fallback: number, integer = false) {
  if (process.env[name] === undefined || process.env[name] === "") return fallback;
  const value = Number(process.env[name]);
  if (Number.isFinite(value) && value >= 0 && (!integer || Number.isSafeInteger(value))) return value;
  console.warn(`Ignoring invalid ${name}=${process.env[name]}; using ${fallback}.`);
  return fallback;
}

/** The enabled providers a policy allows (all, without one), cheapest
 *  first. */
export function geocoderProviders(policy?: ProviderPolicy): GeocoderProvider[] {
  return DEFINITIONS.flatMap((d): GeocoderProvider[] => {
    if (policy && !policy.allows(d.id)) return [];
    if (PARAMS.disabledGeocoders.includes(d.id)) return [];
    const credential = d.credential();
    if (!credential) return [];
    const storable = d.storable();
    const budgetId = `${d.id}:${fingerprint(credential)}`;
    return [{
      id: d.id,
      budgetId,
      cacheId: `${budgetId}:${storable}`,
      sources: d.sources,
      typicalAccuracy: d.typicalAccuracy,
      storable,
      geocode: d.geocode,
      costPerCall: setting(`${d.env}_COST_PER_CALL`, d.costPerCall),
      pricePerCall: d.price,
      dailyCap: setting(`${d.env}_DAILY_CAP`, d.dailyCap, true),
      ratePerSecond: setting(`${d.env}_RATE_PER_SECOND`, typeof d.ratePerSecond === "function" ? d.ratePerSecond() : d.ratePerSecond),
    }];
  }).sort((a, b) => a.costPerCall - b.costPerCall || a.id.localeCompare(b.id));
}

export function geocoderCoverage(policy?: ProviderPolicy) {
  return geocoderProviders(policy).map(({ id, sources, typicalAccuracy, dailyCap, ratePerSecond, storable }) =>
    ({ id, sources, typicalAccuracy, dailyCap, ratePerSecond, storable }));
}
