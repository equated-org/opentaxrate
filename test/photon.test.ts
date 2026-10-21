import { afterEach, describe, expect, it, vi } from "vitest";
import { photonPoint } from "../src/geocoding/providers/photon.js";
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
const ask = (a: typeof address) => photonPoint(a, AbortSignal.timeout(1_000));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("internal Photon address geocoding", () => {
  it("is disabled without its URL", () => {
    vi.stubEnv("PHOTON_URL", "");
    expect(geocoderProviders().map(p => p.id)).not.toContain("photon");
  });

  it("uses the configured endpoint and accepts equivalent street spelling", async () => {
    const fetch = serve();
    expect(await ask(address)).toEqual({ lon: -97.74, lat: 30.27, accuracy: "point", provider: "photon", source: "osm" });
    const url = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("http://geocoder.example.test:2322/api");
    expect(url.searchParams.get("q")).toContain(address.street);
    expect(url.searchParams.get("countrycode")).toBe("US");
  });

  it.each([
    { housenumber: "700" }, { housenumber: "1100A" },
    { street: "South Congress Avenue" }, { street: "North Congress Street" },
    { street: "North Main Avenue" }, { city: "Dallas", postcode: "75201" }, { state: "CA" },
    { countrycode: "CA" },
    { type: "street", housenumber: undefined }, { state: undefined },
  ])("rejects a mismatched or incomplete address: %j", async properties => {
    serve([feature(properties)]);
    expect(await ask(address)).toBeNull();
  });

  it("accepts a different city or a different ZIP, but not both", async () => {
    serve([feature({ city: "Sunset Valley" })]);
    expect(await ask(address)).not.toBeNull();
    serve([feature({ postcode: "78702" })]);
    expect(await ask(address)).not.toBeNull();
  });

  it("accepts state abbreviations and ZIP+4 input", async () => {
    serve([feature({ state: "TX" })]);
    expect(await ask({ ...address, zip: "78701-1234" })).not.toBeNull();
  });

  it("does not equate a fractional house number with a whole number", async () => {
    serve();
    expect(await ask({ ...address, street: "1100 1/2 N Congress Ave" })).toBeNull();
  });

  it("rejects distant duplicate matches", async () => {
    serve([feature(), feature({}, [-97.75, 30.27])]);
    expect(await ask(address)).toBeNull();
  });

  it("accepts nearby duplicate matches and preserves their spread", async () => {
    serve([feature(), feature({}, [-97.74, 30.2704])]);
    expect(await ask(address)).toMatchObject({ metres: 45 });
  });

  it.each([[181, 30], [-97, 91], [NaN, 30]])("leaves invalid coordinates unplaced, as a failure %j", async (lon, lat) => {
    serve([feature({}, [lon, lat])]);
    const locate = createLocator(address, {
      providers: geocoderProviders().filter(p => p.id === "photon"),
      cache: { get: async () => undefined, put: async () => {} },
      budget: { reserve: async () => true, success: () => {}, failure: () => {} },
      checkSingle: async () => true,
    });
    expect(await locate()).toBeNull();
    expect(locate.trace).toEqual([{ provider: "photon", outcome: "failed" }]);
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
