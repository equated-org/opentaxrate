import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geocoderCoverage, geocoderProviders } from "../src/geocoding/registry.js";
import { PARAMS } from "../src/params.js";

// These test every adapter; which ones production asks is a setting.
PARAMS.disabledGeocoders = [];

const variables = ["CENSUS_DISABLED", "NOMINATIM_DISABLED", "NOMINATIM_URL", "PHOTON_URL", "PELIAS_URL", "GEOCODIO_API_KEY", "SMARTY_AUTH_ID", "SMARTY_AUTH_TOKEN",
  "MAPBOX_ACCESS_TOKEN", "MAPBOX_PERMANENT", "HERE_API_KEY", "ARCGIS_API_KEY", "ARCGIS_FOR_STORAGE", "GOOGLE_MAPS_API_KEY"];
beforeEach(() => { for (const name of variables) vi.stubEnv(name, ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("enabled geocoders", () => {
  it("enables Census and the public Nominatim without keys or URLs, two datasets to compare", () => {
    const providers = geocoderProviders();
    expect(providers.map(p => [p.id, p.sources[0]])).toEqual([["census", "tiger"], ["nominatim", "osm"]]);
    // The public server's usage policy: one request a second.
    expect(providers.find(p => p.id === "nominatim")?.ratePerSecond).toBe(1);
  });
  it("uses your own Nominatim when NOMINATIM_URL is set, faster", () => {
    vi.stubEnv("NOMINATIM_URL", "http://geocoder.example.test:8080");
    expect(geocoderProviders().find(p => p.id === "nominatim")?.ratePerSecond).toBe(10);
  });
  it("can disable Census and Nominatim", () => {
    vi.stubEnv("CENSUS_DISABLED", "true");
    vi.stubEnv("NOMINATIM_DISABLED", "true");
    expect(geocoderProviders()).toEqual([]);
  });
  it("ignores an invalid tuning value rather than failing every lookup", () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test");
    vi.stubEnv("GOOGLE_DAILY_CAP", "1.5");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(geocoderProviders().find(p => p.id === "google")?.dailyCap).toBe(300);
  });
  it("registers configured providers in cost order without exposing credentials", () => {
    for (const name of variables.filter(name => !["CENSUS_DISABLED", "NOMINATIM_DISABLED", "MAPBOX_PERMANENT", "ARCGIS_FOR_STORAGE"].includes(name)))
      vi.stubEnv(name, name.endsWith("_URL") ? "http://geocoder.example.test:2322" : "secret-test-key");
    const providers = geocoderProviders();
    expect(providers).toHaveLength(10);
    expect(providers[0].costPerCall).toBe(0);
    expect(providers.at(-1)?.id).toBe("google");
    expect(JSON.stringify(geocoderCoverage())).not.toContain("secret-test-key");
    expect(JSON.stringify(providers)).not.toContain("secret-test-key");
  });
  it("does not persist temporary Mapbox or Esri results", () => {
    vi.stubEnv("MAPBOX_ACCESS_TOKEN", "test");
    vi.stubEnv("ARCGIS_API_KEY", "test");
    const before = geocoderProviders();
    expect(before.find(p => p.id === "mapbox")?.storable).toBe(false);
    expect(before.find(p => p.id === "esri")?.storable).toBe(false);
    vi.stubEnv("MAPBOX_PERMANENT", "true");
    vi.stubEnv("ARCGIS_FOR_STORAGE", "true");
    const after = geocoderProviders();
    for (const id of ["mapbox", "esri"]) {
      expect(after.find(p => p.id === id)?.storable).toBe(true);
      expect(after.find(p => p.id === id)?.cacheId).not.toBe(before.find(p => p.id === id)?.cacheId);
      expect(after.find(p => p.id === id)?.budgetId).toBe(before.find(p => p.id === id)?.budgetId);
    }
  });
});

const address = { street: "100 N Main St", city: "Austin", state: "TX", zip: "78701" };
const location = { lng: -97.74, lat: 30.27 };
const fixtures: [string, Record<string, string>, unknown][] = [
  ["geocodio", { GEOCODIO_API_KEY: "test" }, { results: [{ accuracy: 1, accuracy_type: "rooftop", source: "Example County",
    address_components: { number: "100", formatted_street: "N Main St", city: "Austin", state_province: "TX", postal_code: "78701", country: "US" }, location }] }],
  ["pelias", { PELIAS_URL: "http://geocoder.example.test:4000" }, { features: [{ geometry: { type: "Point", coordinates: [-97.74, 30.27] },
    properties: { layer: "address", accuracy: "point", match_type: "exact", source: "openaddresses", housenumber: "100", street: "N Main St", locality: "Austin", region_a: "TX", postalcode: "78701", country_a: "USA" } }] }],
  ["smarty", { SMARTY_AUTH_ID: "test", SMARTY_AUTH_TOKEN: "test" }, [{
    components: { primary_number: "100", street_predirection: "N", street_name: "Main", street_suffix: "St", city_name: "Austin", state_abbreviation: "TX", zipcode: "78701" },
    metadata: { precision: "Rooftop", longitude: -97.74, latitude: 30.27 }, analysis: { dpv_match_code: "Y" } }]],
  ["here", { HERE_API_KEY: "test" }, { items: [{ resultType: "houseNumber", houseNumberType: "PA", position: location,
    address: { houseNumber: "100", street: "N Main St", city: "Austin", stateCode: "TX", postalCode: "78701", countryCode: "USA" } }] }],
  ["esri", { ARCGIS_API_KEY: "test" }, { candidates: [{ score: 100, location: { x: -97.74, y: 30.27 },
    attributes: { Addr_type: "PointAddress", AddNum: "100", StPreDir: "N", StName: "Main", StType: "St", City: "Austin", RegionAbbr: "TX", Postal: "78701", Country: "USA" } }] }],
  ["google", { GOOGLE_MAPS_API_KEY: "test" }, { status: "OK", results: [{ geometry: { location_type: "ROOFTOP", location },
    address_components: [["street_number", "100"], ["route", "N Main St"], ["locality", "Austin"], ["administrative_area_level_1", "TX"], ["postal_code", "78701"], ["country", "US"]]
      .map(([type, text]) => ({ types: [type], long_name: text, short_name: text })) }] }],
  ["nominatim", {}, [{ lat: "30.27", lon: "-97.74", address: { house_number: "100", road: "North Main Street",
    city: "Austin", "ISO3166-2-lvl4": "US-TX", postcode: "78701", country_code: "us" } }]],
  ["mapbox", { MAPBOX_ACCESS_TOKEN: "test" }, { features: [{ properties: { coordinates: { longitude: -97.74, latitude: 30.27, accuracy: "rooftop" },
    context: { region: { region_code: "TX" } }, match_code: { confidence: "exact", address_number: "matched", street: "matched" } } }] }],
];

describe("provider adapters", () => {
  it.each(fixtures)("accepts a confident address from %s", async (id, env, body) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));
    const provider = geocoderProviders().find(p => p.id === id)!;
    expect(await provider.geocode(address, AbortSignal.timeout(1000))).toMatchObject({ lon: -97.74, lat: 30.27, provider: id });
  });
  it.each(fixtures)("distinguishes HTTP errors from no-match for %s", async (id, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("limit", { status: 429 })));
    const provider = geocoderProviders().find(p => p.id === id)!;
    await expect(provider.geocode(address, AbortSignal.timeout(1000))).rejects.toMatchObject({ status: 429 });
  });
});

describe("Pelias's duplicates", () => {
  const exact = (source: string, lon: number) => ({ geometry: { type: "Point", coordinates: [lon, 30.27] },
    properties: { layer: "address", accuracy: "point", match_type: "exact", source, housenumber: "100", street: "N Main St",
      locality: "Austin", region_a: "TX", postalcode: "78701", country_a: "USA" } });
  const pelias = async (features: unknown[]) => {
    vi.stubEnv("PELIAS_URL", "http://geocoder.example.test:4000");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ features })));
    return geocoderProviders().find(p => p.id === "pelias")!.geocode(address, AbortSignal.timeout(1000));
  };

  it("take one house from several datasets as one answer, wide enough to reach them all", async () => {
    // OpenAddresses, then NAD 0.0003° (~29 m) east.
    expect(await pelias([exact("openaddresses", -97.74), exact("nad", -97.7397)]))
      .toMatchObject({ lon: -97.74, source: "openaddresses", metres: 29 });
    expect(await pelias([exact("openaddresses", -97.74), exact("nad", -97.74)])).not.toHaveProperty("metres");
  });

  it("skip a match without coordinates", async () => {
    const broken = { ...exact("nad", -97.74), geometry: { type: "Point", coordinates: [] } };
    expect(await pelias([exact("openaddresses", -97.74), broken])).toMatchObject({ source: "openaddresses" });
  });

  it("are two places when farther apart than peliasDuplicateMetres", async () => {
    // ~97 m apart.
    expect(await pelias([exact("openaddresses", -97.74), exact("nad", -97.739)])).toBeNull();
  });
});
