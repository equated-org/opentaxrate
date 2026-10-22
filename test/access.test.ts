/**
 * Tiers: no key is the public tier and asks only OPENTAXRATE_PUBLIC_PROVIDERS;
 * a master key is the keyed tier and asks every provider; any other key is a
 * 401. The HTTP checks use /v1/coverage and a malformed /v1/rate, so they
 * need the test database but no loaded state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { EVERY_PROVIDER, masterKeys, policyFor, presentedKey, resolveAccess, type AccessVariables } from "../src/access.js";
import { geocoderProviders } from "../src/geocoding/registry.js";
import { addressStandardizer } from "../src/standardize/index.js";

const MASTER = `otr_master_${"a1".repeat(24)}`;
const OTHER = `otr_master_${"b2".repeat(24)}`;
const PROVIDER_ENV = {
  PHOTON_URL: "http://geocoder.example.test:2322",
  PELIAS_URL: "http://geocoder.example.test:4000",
  GEOCODIO_API_KEY: "test-geocodio",
  MAPBOX_ACCESS_TOKEN: "test-mapbox",
  GOOGLE_MAPS_API_KEY: "test-google",
};

beforeEach(() => {
  for (const [name, value] of Object.entries(PROVIDER_ENV)) vi.stubEnv(name, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the provider policy", () => {
  it("limits the public tier to the listed providers", () => {
    const policy = policyFor({ tier: "public" }, { OPENTAXRATE_PUBLIC_PROVIDERS: "photon, Pelias" });
    expect(geocoderProviders(policy).map((p) => p.id).sort()).toEqual(["pelias", "photon"]);
    expect(policy.allows("jev")).toBe(false);
    expect(addressStandardizer(policy)).toBeUndefined();
  });

  it("allows every provider to the keyed tier, and to the public one when nothing is listed", () => {
    const env = { OPENTAXRATE_PUBLIC_PROVIDERS: "photon,pelias" };
    expect(policyFor({ tier: "keyed", master: "test" }, env)).toBe(EVERY_PROVIDER);
    expect(policyFor({ tier: "public" }, {})).toBe(EVERY_PROVIDER);
    expect(geocoderProviders(EVERY_PROVIDER).map((p) => p.id)).toEqual(expect.arrayContaining(["census", "geocodio", "mapbox", "google"]));
    expect(addressStandardizer(EVERY_PROVIDER)).toBeDefined();
  });
});

describe("master keys", () => {
  it("are read with their names, bare or named", () => {
    const keys = masterKeys({ OPENTAXRATE_MASTER_KEYS: `equated=${MASTER}, ${OTHER}` });
    expect([...keys.values()]).toEqual(["equated", "master"]);
  });

  it("stop the server at start when weak or malformed", () => {
    expect(() => masterKeys({ OPENTAXRATE_MASTER_KEYS: "app=otr_master_short" })).toThrow(/at least 32/);
    expect(() => masterKeys({ OPENTAXRATE_MASTER_KEYS: `app=sk_${"a".repeat(40)}` })).toThrow(/otr_master_/);
    expect(() => masterKeys({ OPENTAXRATE_MASTER_KEYS: `my app=${MASTER}` })).toThrow(/isn't a name/);
  });

  it("are read from x-api-key or a Bearer token", async () => {
    const app = new Hono().get("/", (c) => c.text(presentedKey(c) ?? "none"));
    expect(await (await app.request("/", { headers: { "x-api-key": "k1" } })).text()).toBe("k1");
    expect(await (await app.request("/", { headers: { authorization: "Bearer k2" } })).text()).toBe("k2");
    expect(await (await app.request("/")).text()).toBe("none");
  });

  it("give the keyed tier; an unknown key is a 401, never the public tier", async () => {
    const app = new Hono<{ Variables: AccessVariables }>()
      .use(resolveAccess({ OPENTAXRATE_MASTER_KEYS: `equated=${MASTER}` }))
      .get("/", (c) => c.json(c.var.access));
    expect(await (await app.request("/")).json()).toEqual({ tier: "public" });
    expect(await (await app.request("/", { headers: { "x-api-key": MASTER } })).json()).toEqual({ tier: "keyed", master: "equated" });
    const bad = await app.request("/", { headers: { "x-api-key": OTHER } });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toMatchObject({ code: "INVALID_API_KEY" });
  });
});

describe("the API by tier", () => {
  async function server() {
    vi.stubEnv("OPENTAXRATE_PUBLIC_PROVIDERS", "photon,pelias");
    vi.stubEnv("OPENTAXRATE_MASTER_KEYS", `test=${MASTER}`);
    vi.stubEnv("OPENTAXRATE_PUBLIC_LIMIT", "1/min");
    return (await import("../src/server.js")).app;
  }
  const geocoders = async (response: Response) =>
    ((await response.json()) as Array<{ geocoders: Array<{ id: string }> }>)[0].geocoders.map((g) => g.id).sort();

  it("lists only the public providers without a key, and every one with a master key", async () => {
    const app = await server();
    const open = await app.request("/v1/coverage");
    expect(open.status).toBe(200);
    expect(await geocoders(open)).toEqual(["pelias", "photon"]);
    const keyed = await app.request("/v1/coverage", { headers: { authorization: `Bearer ${MASTER}` } });
    expect(await geocoders(keyed)).toEqual(expect.arrayContaining(["census", "geocodio", "google", "mapbox", "pelias", "photon"]));
    expect((await app.request("/v1/coverage", { headers: { "x-api-key": OTHER } })).status).toBe(401);
  });

  it("counts public lookups by IP but not keyed ones, and says which tier answered", async () => {
    const app = await server();
    const first = await app.request("/v1/rate?state=X");
    expect(first.status).toBe(400);
    expect(first.headers.get("x-opentaxrate-tier")).toBeNull(); // rejected before a lookup
    expect((await app.request("/v1/rate?state=X")).status).toBe(429);
    for (let i = 0; i < 3; i++)
      expect((await app.request("/v1/rate?state=X", { headers: { "x-api-key": MASTER } })).status).toBe(400);
  });
});
