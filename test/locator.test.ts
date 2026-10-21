import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocator } from "../src/geocoding/locator.js";
import { addressCacheKey, type GeocodeCache } from "../src/geocoding/cache.js";
import { agreeingGroup, placement } from "../src/geocoding/agreement.js";
import { type GeocoderProvider, type SourcedPoint, marginOf } from "../src/geocoding/types.js";

const address = { street: "100 N Main St", city: "Austin", state: "TX", zip: "78701" };
const point = (provider: string, source: string, metres = 0, accuracy: SourcedPoint["accuracy"] = "point"): SourcedPoint =>
  ({ provider, source, lon: 0, lat: metres / 110_540, accuracy });
function provider(id: string, source: string, metres = 0, accuracy: SourcedPoint["accuracy"] = "point"): GeocoderProvider {
  return { id, cacheId: id, budgetId: id, sources: [source], typicalAccuracy: accuracy,
    costPerCall: 0, dailyCap: 100, ratePerSecond: 100, storable: true,
    geocode: vi.fn(async () => point(id, source, metres, accuracy)) };
}
function setup(providers: GeocoderProvider[], single = false) {
  const rows = new Map<string, SourcedPoint | null>();
  const cache: GeocodeCache = {
    get: vi.fn(async (key, id) => rows.get(`${key}:${id}`)),
    put: vi.fn(async (key, id, result) => { rows.set(`${key}:${id}`, result); }),
  };
  const budget = { reserve: vi.fn(async () => true), success: vi.fn(), failure: vi.fn() };
  const options = { providers, cache, budget, checkSingle: vi.fn(async () => single) };
  return { options, rows, cache, budget, locate: createLocator(address, options) };
}
afterEach(() => vi.unstubAllEnvs());

describe("staged locator", () => {
  it("stops at a cheap independent pair and memoizes repeated calls", async () => {
    const a = provider("census", "tiger", 0, "interpolated"), b = provider("photon", "osm", 20), c = provider("paid", "paid", 10, "rooftop");
    const { locate } = setup([a, b, c]);
    expect(await locate()).toMatchObject({ accuracy: "point", metres: 40 });
    await locate();
    expect(a.geocode).toHaveBeenCalledTimes(1);
    expect(b.geocode).toHaveBeenCalledTimes(1);
    expect(c.geocode).not.toHaveBeenCalled();
  });

  it("makes zero provider calls on a repeat address", async () => {
    const providers = [provider("a", "tiger"), provider("b", "osm")];
    const { locate, options } = setup(providers);
    await locate();
    await createLocator(address, options)();
    providers.forEach(p => expect(p.geocode).toHaveBeenCalledTimes(1));
  });

  it("uses a third source to reject an outlier", async () => {
    const { locate } = setup([provider("a", "tiger"), provider("b", "osm", 6000), provider("c", "openaddresses", 12, "rooftop")]);
    const found = await locate();
    expect(found?.placedBy).toEqual(["a (tiger)", "c (openaddresses)"]);
  });

  it("does not buy a new pair when one cached vote just needs a free partner", async () => {
    const a = provider("a", "tiger"), b = provider("b", "osm"), paid = provider("paid", "local", 0, "rooftop");
    const { locate, rows } = setup([a, b, paid]);
    rows.set(`${addressCacheKey(address)}:${a.cacheId}`, point("a", "tiger"));
    expect(await locate()).not.toBeNull();
    expect(a.geocode).not.toHaveBeenCalled();
    expect(b.geocode).toHaveBeenCalledTimes(1);
    expect(paid.geocode).not.toHaveBeenCalled();
  });

  it("does not use disagreement as a single-source fallback", async () => {
    const { locate, options } = setup([provider("a", "tiger"), provider("b", "osm", 6000)], true);
    expect(await locate()).toBeNull();
    expect(options.checkSingle).not.toHaveBeenCalled();
  });

  it.each([true, false])("accepts a lone point only when the city check passes (%s)", async single => {
    const { locate } = setup([provider("a", "tiger")], single);
    expect(Boolean(await locate())).toBe(single);
  });

  it("refines even when the old edge is just 10 m away, and only once", async () => {
    const paid = provider("paid", "local", 30, "rooftop");
    const { locate } = setup([provider("a", "tiger", 0, "interpolated"), provider("b", "osm", 0), paid]);
    expect((await locate())?.accuracy).toBe("point");
    expect((await locate({ marginUnder: 10 }))?.accuracy).toBe("rooftop");
    await locate({ marginUnder: 1 });
    expect(paid.geocode).toHaveBeenCalledTimes(1);
  });

  it("rejects a precise point outside the accepted placement", async () => {
    const { locate } = setup([provider("a", "tiger"), provider("b", "osm"), provider("paid", "local", 100, "rooftop")]);
    await locate();
    expect((await locate({ marginUnder: 10 }))?.accuracy).toBe("point");
  });

  it("does not erase disagreement by reusing the already accepted rooftop", async () => {
    const { locate } = setup([provider("a", "a", 0, "rooftop"), provider("b", "b", 60, "interpolated")]);
    expect(marginOf((await locate())!)).toBe(60);
    expect(marginOf((await locate({ marginUnder: 10 }))!)).toBe(60);
  });

  it("replays cached refinement consistently with the original request", async () => {
    const providers = [provider("a", "tiger", 0, "interpolated"), provider("b", "osm", 30), provider("c", "local", 10, "rooftop")];
    const { locate, options } = setup(providers);
    await locate();
    const sharp = await locate({ marginUnder: 10 });
    const repeat = createLocator(address, options);
    await repeat();
    expect(await repeat({ marginUnder: 10 })).toEqual(sharp);
    providers.forEach(p => expect(p.geocode).toHaveBeenCalledTimes(1));
  });

  it("never calls a provider without a budget reservation", async () => {
    const p = provider("a", "osm");
    const { locate, budget } = setup([p]);
    budget.reserve.mockResolvedValue(false);
    expect(await locate()).toBeNull();
    expect(p.geocode).not.toHaveBeenCalled();
  });

  it("caches confirmed no-match but never failures", async () => {
    const a = provider("a", "osm"), b = provider("b", "tiger");
    vi.mocked(a.geocode).mockResolvedValue(null);
    vi.mocked(b.geocode).mockRejectedValue(new Error("timeout"));
    const { locate, options, cache, budget } = setup([a, b]);
    await locate();
    await createLocator(address, options)();
    expect(a.geocode).toHaveBeenCalledTimes(1);
    expect(b.geocode).toHaveBeenCalledTimes(2);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(budget.failure).toHaveBeenCalledTimes(2);
  });

  it("does not persist non-storable results, including negatives", async () => {
    const a = { ...provider("a", "osm"), storable: false };
    vi.mocked(a.geocode).mockResolvedValue(null);
    const { locate, cache } = setup([a]);
    await locate();
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("read-only mode uses cached results without writes or outside calls", async () => {
    vi.stubEnv("OPENTAXRATE_GEOCODE_READ_ONLY", "true");
    const providers = [provider("a", "tiger"), provider("b", "osm")];
    const { locate, rows, budget, cache } = setup(providers);
    for (const p of providers) rows.set(`${addressCacheKey(address)}:${p.cacheId}`, point(p.id, p.sources[0]));
    expect(await locate()).not.toBeNull();
    expect(budget.reserve).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    providers.forEach(p => expect(p.geocode).not.toHaveBeenCalled());
  });

  it("cache off still reserves quota", async () => {
    vi.stubEnv("OPENTAXRATE_GEOCODE_CACHE", "off");
    const { locate, budget, cache } = setup([provider("a", "tiger")]);
    await locate();
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("coalesces concurrent requests for the same address", async () => {
    const p = provider("a", "tiger");
    const { options } = setup([p], true);
    await Promise.all([createLocator(address, options)(), createLocator(address, options)()]);
    expect(p.geocode).toHaveBeenCalledTimes(1);
  });
});

describe("agreement", () => {
  it("takes the most precise point with the sources that agree with it, past a lone outlier", () => {
    expect(agreeingGroup([point("a", "a", 0), point("b", "b", 30), point("c", "c", 60)])!.map(p => p.provider)).toEqual(["a", "b"]);
    expect(agreeingGroup([point("a", "a", 0, "rooftop"), point("b", "b", 500), point("c", "c", 510)])!.map(p => p.provider)).toEqual(["b", "c"]);
  });
  it("refuses when the sources agree on two places", () => {
    expect(agreeingGroup([point("a", "a"), point("b", "b"), point("c", "c", 1000), point("d", "d", 1000)])).toBeNull();
  });
  it("counts repeated data sources once", () => {
    expect(agreeingGroup([point("a", "osm"), point("b", "osm")])).toBeNull();
    expect(agreeingGroup([point("a", "osm"), point("b", "osm"), point("c", "tiger")])).toHaveLength(2);
  });
  it("widens uncertainty to the accepted group's spread", () => {
    const group = agreeingGroup([point("a", "a", 0, "rooftop"), point("b", "b", 60, "interpolated")])!;
    expect(marginOf(placement(group))).toBe(60);
  });
});

describe("complete cache identity", () => {
  it.each([
    { city: "Dallas" }, { street: "100 S Main St" }, { street: "100 N Main Ave" },
    { street: "100A N Main St" }, { street: "100 1/2 N Main St" },
    { street: "100 N Main St Unit 2" }, { zip: "78702" },
  ])("keeps different addresses apart: %j", change => {
    expect(addressCacheKey({ ...address, ...change })).not.toBe(addressCacheKey(address));
  });
  it("shares conservative spelling aliases", () => {
    expect(addressCacheKey({ ...address, street: " 100 north main Street " })).toBe(addressCacheKey(address));
  });
});
