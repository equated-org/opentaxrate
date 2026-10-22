import { afterEach, expect, it, vi } from "vitest";
import { peliasPoint } from "../src/geocoding/providers/pelias.js";
import { fingerprint, geocoderProviders } from "../src/geocoding/registry.js";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const address = { street: "100 N Main St", city: "Austin", state: "TX", zip: "78701" };
function feature(source: string, lon = -97.74, provenance?: unknown) {
  return { geometry: { coordinates: [lon, 30.27] }, properties: {
    layer: "address", accuracy: "point", match_type: "exact", source,
    housenumber: "100", street: "N Main St", locality: "Austin", region_a: "TX",
    postalcode: "78701", country_a: "USA", addendum: { provenance },
  } };
}
async function locate(features: unknown[]) {
  vi.stubEnv("PELIAS_URL", "http://geocoder.example.test:4000");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ features })));
  return peliasPoint(address, AbortSignal.timeout(1000));
}
it("accepts an address duplicated across government aggregators as one dataset", async () => {
  expect(await locate([feature("openaddresses"), feature("nad"), feature("nyc"), feature("overtureaddresses")]))
    .toMatchObject({ source: "openaddresses", lon: -97.74, lat: 30.27 });
});
it("widens the placement margin to cover nearby copies", async () => {
  const result = await locate([feature("nad"), feature("overtureaddresses", -97.7399)]);
  expect(result?.metres).toBeGreaterThan(9);
  expect(result?.metres).toBeLessThan(12);
});
it("refuses conflicting exact address points", async () => {
  expect(await locate([feature("nad"), feature("openaddresses", -97.73)])).toBeNull();
});
it("keeps OSM lineage from Overture even when another aggregator ranks first", async () => {
  expect(await locate([feature("nad"), feature("overtureaddresses", -97.74,
    { sources: [{ dataset: "OpenStreetMap" }] })])).toMatchObject({ source: "osm" });
});
it("skips malformed coordinates in matching records", async () => {
  expect(await locate([feature("nad"), feature("openaddresses", NaN)])).toMatchObject({ source: "openaddresses" });
});
it("bypasses cached refusals from the old adapter without resetting the quota", () => {
  vi.stubEnv("PELIAS_URL", "http://geocoder.example.test:4000");
  const p = geocoderProviders().find(p => p.id === "pelias")!;
  const oldBudget = `pelias:${fingerprint("http://geocoder.example.test:4000")}`;
  expect(p.budgetId).toBe(oldBudget);
  expect(p.cacheId).not.toBe(`${oldBudget}:true`);
});
