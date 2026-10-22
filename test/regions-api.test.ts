import { afterEach, describe, expect, it, vi } from "vitest";
import { answerKey } from "../src/cache.js";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("../src/lookup.js", () => ({ lookUpRate: lookup }));
import { app } from "../src/server.js";

const base = { state: "CT", rate: 0.0635, parts: [] };
afterEach(() => vi.clearAllMocks());
describe("regional API expansion", () => {
  it("passes regions independently of trace and leaves plain requests unexpanded", async () => {
    lookup.mockImplementation(async (_q, options) => options.regions ? { ...base, regions: { matches: [], coverage: [] } } : base);
    for (const include of ["", "regions", "trace,regions", "regions,regions"]) {
      const response = await app.request(`/v1/rate?state=CT&include=${include}`);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.rate).toBe(0.0635);
      expect("regions" in body).toBe(include.includes("regions"));
      expect("trace" in body).toBe(include.includes("trace"));
      expect(lookup.mock.lastCall?.[1].regions).toBe(include.includes("regions"));
    }
  });
  it("separates regional cache keys from ordinary and trace answers", () => {
    const q = { state: "WA", street: "400 Broad St", city: "Seattle", date: "2026-10-22" };
    const keys = [[], ["regions"], ["trace"], ["trace", "regions"]].map(i => answerKey(q, i));
    expect(new Set(keys).size).toBe(4);
    expect(answerKey(q, ["regions", "trace"])).toBe(keys[3]);
  });
  it("expands and logs keyed requests using the same regional contract", async () => {
    const key = `otr_master_${"ab".repeat(24)}`;
    vi.stubEnv("OPENTAXRATE_MASTER_KEYS", `regions-test=${key}`);
    vi.resetModules();
    const log = vi.fn();
    vi.doMock("../src/requests.js", async original => ({
      ...(await original<typeof import("../src/requests.js")>()),
      cachedAnswer: async () => undefined,
      logRequest: log,
    }));
    try {
      const { app: keyed } = await import("../src/server.js");
      lookup.mockResolvedValue({ ...base, regions: { matches: [], coverage: [] } });
      const response = await keyed.request("/v1/rate?state=CT&include=regions", { headers: { "x-api-key": key } });
      expect(response.status).toBe(200);
      expect((await response.json()).regions).toEqual({ matches: [], coverage: [] });
      expect(lookup.mock.lastCall?.[1]).toMatchObject({ regions: true });
      expect(log).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        response: expect.objectContaining({ regions: { matches: [], coverage: [] } }),
      }));
    } finally {
      vi.doUnmock("../src/requests.js");
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
