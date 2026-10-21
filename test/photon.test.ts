import { afterEach, describe, expect, it, vi } from "vitest";
import { photonGeocoder } from "../src/geocoding/photon.js";
import { createLocator, geocoderProviders } from "../src/geocoding/index.js";

const address = { street: "1100 N Congress Ave", city: "Austin", state: "TX", zip: "78701" };
const feature = (properties = {}, coordinates = [-97.74, 30.27]) => ({
  geometry: { type: "Point", coordinates },
  properties: {
    type: "house", housenumber: "1100", street: "North Congress Avenue",
    city: "Austin", state: "Texas", postcode: "78701", countrycode: "US",
    ...properties,
  },
});
function serve(features = [feature()]) {
  vi.stubEnv("PHOTON_URL", "http://geocoder.example.test:2322/");
  const fetch = vi.fn(async () => Response.json({ features }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("internal Photon address geocoding", () => {
  it("is disabled without its URL", () => {
    vi.stubEnv("PHOTON_URL", "");
    expect(photonGeocoder()).toBeUndefined();
  });

  it("uses the configured endpoint and accepts equivalent street spelling", async () => {
    const fetch = serve();
    expect(await photonGeocoder()!(address)).toEqual({ lon: -97.74, lat: 30.27, accuracy: "point" });
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("http://geocoder.example.test:2322/api");
    expect(url.searchParams.get("q")).toContain(address.street);
    expect(url.searchParams.get("countrycode")).toBe("US");
  });

  it.each([
    { housenumber: "700" }, { housenumber: "1100A" },
    { street: "South Congress Avenue" }, { street: "North Congress Street" },
    { street: "North Main Avenue" }, { city: "Dallas" }, { state: "CA" },
    { countrycode: "CA" }, { postcode: "78702" },
    { type: "street", housenumber: undefined }, { state: undefined },
  ])("rejects a mismatched or incomplete address: %j", async properties => {
    serve([feature(properties)]);
    expect(await photonGeocoder()!(address)).toBeNull();
  });

  it("accepts state abbreviations and ZIP+4 input", async () => {
    serve([feature({ state: "TX" })]);
    expect(await photonGeocoder()!({ ...address, zip: "78701-1234" })).not.toBeNull();
  });

  it("does not equate a fractional house number with a whole number", async () => {
    serve();
    expect(await photonGeocoder()!({ ...address, street: "1100 1/2 N Congress Ave" })).toBeNull();
  });

  it("rejects distant duplicate matches", async () => {
    serve([feature(), feature({}, [-97.75, 30.27])]);
    expect(await photonGeocoder()!(address)).toBeNull();
  });

  it("accepts nearby duplicate matches and preserves their spread", async () => {
    serve([feature(), feature({}, [-97.74, 30.2704])]);
    expect(await photonGeocoder()!(address)).toMatchObject({ metres: 45 });
  });

  it.each([[181, 30], [-97, 91], [NaN, 30]])("rejects invalid coordinates %j", async (lon, lat) => {
    serve([feature({}, [lon, lat])]);
    await expect(photonGeocoder()!(address)).rejects.toThrow();
  });

  it.each([false, true])("keeps Census usable when Photon fails (throws=%s)", async throws => {
    vi.stubEnv("PHOTON_URL", "http://geocoder.example.test:2322");
    const fetch = vi.fn(async (input: URL | string) => {
      const url = new URL(input);
      if (url.hostname === "geocoder.example.test") {
        if (throws) throw new Error("unavailable");
        return new Response("unavailable", { status: 503 });
      }
      expect(url.hostname).toBe("geocoding.geo.census.gov");
      return Response.json({ result: { addressMatches: [{
        coordinates: { x: -97.74, y: 30.27 }, addressComponents: { state: "TX" },
      }] } });
    });
    vi.stubGlobal("fetch", fetch);
    const locate = createLocator(address, {
      providers: geocoderProviders().filter(p => ["census", "photon"].includes(p.id)),
      cache: { get: async () => undefined, put: async () => {} },
      budget: { reserve: async () => true, success: () => {}, failure: () => {} },
      checkSingle: async () => true,
    });
    expect(await locate()).toMatchObject({ lon: -97.74, lat: 30.27, accuracy: "interpolated" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
