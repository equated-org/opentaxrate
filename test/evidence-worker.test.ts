import { afterEach, describe, expect, it, vi } from "vitest";

// The evidence Worker (evidence/worker.js) run against a bucket held in memory.
const good = "a".repeat(64), bad = "b".repeat(64), later = "c".repeat(64);
const page = "https://services.example/FeatureServer/0?f=json";
const catalog = {
  generatedAt: "2026-11-01T00:00:00Z",
  urls: {
    [page]: {
      captures: [
        { at: "2026-10-01T00:00:00Z", sha256: good, bytes: 20, type: "application/json" },
        { at: "2026-10-20T00:00:00Z", sha256: bad, bytes: 30, type: "application/json", bad: "error answer" },
        { at: "2026-10-28T00:00:00Z", sha256: later, bytes: 25, type: "application/json" },
      ],
      citedBy: [],
    },
    "https://only-bad.example/page": { captures: [{ at: "2026-10-20T00:00:00Z", sha256: "d".repeat(64), bytes: 9, type: "text/html; charset=utf-8", bad: "request rejected" }], citedBy: [] },
  },
};
const object = (body: string) => ({ body, json: async () => JSON.parse(body), text: async () => body, httpMetadata: {} });
const env = {
  EVIDENCE: {
    get: async (key: string) => (key === "catalog.json" ? object(JSON.stringify(catalog)) : key.startsWith("sha256/") ? object('{"error":{"code":400}}') : null),
  },
};

async function go(path: string) {
  vi.stubGlobal("caches", { default: { match: async () => null, put: async () => {} } });
  const worker = (await import("../evidence/worker.js")).default as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> };
  return worker.fetch(new Request(`https://evidence.test${path}`), env, { waitUntil() {} });
}
afterEach(() => vi.unstubAllGlobals());

describe("the evidence Worker and known-bad captures", () => {
  it("labels a known-bad capture on its page, among the other captures, and in the URL's list", async () => {
    const capture = await (await go(`/sha256/${bad}`)).text();
    expect(capture).toContain("Error answer — not the page");
    expect(capture).toContain("See the other captures below.");
    const other = await (await go(`/sha256/${good}`)).text();
    expect(other).toContain("(Error answer — not the page)");
    expect(other).not.toContain('<p class="bad-capture">');
    const list = await (await go(`/url?u=${encodeURIComponent(page)}`)).text();
    expect(list.match(/Error answer — not the page; see other captures/g)).toHaveLength(1);
  });

  it("sends a day to the last good capture on or before it, never a known-bad one", async () => {
    const on = async (day: string) => (await go(`/${day}/${page}`)).headers.get("location");
    expect(await on("20261022")).toBe(`https://evidence.test/sha256/${good}`);
    expect(await on("20261030")).toBe(`https://evidence.test/sha256/${later}`);
    expect(await on("20260901")).toBe(`https://evidence.test/sha256/${good}?asked=2026-09-01`);
    // Every capture bad: the bad one, which says what it is.
    expect((await go("/20261025/https://only-bad.example/page")).headers.get("location")).toBe(`https://evidence.test/sha256/${"d".repeat(64)}`);
  });
});
