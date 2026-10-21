import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geocoderCoverage, geocoderProviders } from "../src/geocoding/registry.js";

const variables = ["CENSUS_DISABLED", "PHOTON_URL", "PELIAS_URL", "GEOCODIO_API_KEY", "SMARTY_AUTH_ID", "SMARTY_AUTH_TOKEN",
  "MAPBOX_ACCESS_TOKEN", "MAPBOX_PERMANENT", "HERE_API_KEY", "ARCGIS_API_KEY", "ARCGIS_FOR_STORAGE", "GOOGLE_MAPS_API_KEY"];
beforeEach(() => { for (const name of variables) vi.stubEnv(name, ""); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("enabled geocoders", () => {
  it("enables only Census without keys or URLs", () => {
    expect(geocoderProviders().map(p => p.id)).toEqual(["census"]);
  });
  it("can disable Census, and never registers Nominatim", () => {
    vi.stubEnv("CENSUS_DISABLED", "true");
    vi.stubEnv("NOMINATIM_URL", "http://geocoder.example.test:8080");
    expect(geocoderProviders()).toEqual([]);
  });
  it("registers configured providers in cost order without exposing credentials", () => {
    for (const name of variables.filter(name => !["CENSUS_DISABLED", "MAPBOX_PERMANENT", "ARCGIS_FOR_STORAGE"].includes(name)))
      vi.stubEnv(name, name.endsWith("_URL") ? "http://geocoder.example.test:2322" : "secret-test-key");
    const providers = geocoderProviders();
    expect(providers).toHaveLength(9);
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
