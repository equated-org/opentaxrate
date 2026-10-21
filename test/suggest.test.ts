/**
 * The suggestion relay: what it asks Photon for, what it hands back, and how
 * it answers when Photon fails. Photon is a stub; no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { suggestFromEnv } from "../src/suggest.js";

function appWith(fetchImpl: typeof fetch) {
  vi.stubGlobal("fetch", fetchImpl);
  const app = new Hono();
  app.get("/v1/suggest", suggestFromEnv({ OPENTAXRATE_PHOTON_URL: "http://photon.internal:2322/" })!);
  return app;
}

afterEach(() => vi.unstubAllGlobals());

describe("suggestFromEnv", () => {
  it("is off without a Photon URL", () => {
    expect(suggestFromEnv({})).toBeUndefined();
  });

  it("relays the query, known layers and bbox, and returns Photon's answer unchanged", async () => {
    const asked: string[] = [];
    const body = { type: "FeatureCollection", features: [{ properties: { housenumber: "1100" } }] };
    const app = appWith(async (url) => {
      asked.push(String(url));
      return Response.json(body);
    });
    const r = await app.request("/v1/suggest?q=1100+Congress&limit=8&bbox=-180,17,-64,72&layer=house&layer=street&layer=bogus");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(body);
    const u = new URL(asked[0]);
    expect(u.origin + u.pathname).toBe("http://photon.internal:2322/api");
    expect(u.searchParams.get("q")).toBe("1100 Congress");
    expect(u.searchParams.get("limit")).toBe("8");
    expect(u.searchParams.getAll("layer")).toEqual(["house", "street"]);
    expect(u.searchParams.get("bbox")).toBe("-180,17,-64,72");
  });

  it("refuses a missing query and an oversized limit", async () => {
    const app = appWith(async () => Response.json({}));
    expect((await app.request("/v1/suggest")).status).toBe(400);
    expect((await app.request("/v1/suggest?q=x&limit=500")).status).toBe(400);
  });

  it("answers 502 when Photon fails and 504 when it can't be reached", async () => {
    expect((await appWith(async () => new Response("no", { status: 500 })).request("/v1/suggest?q=x")).status).toBe(502);
    expect((await appWith(async () => { throw new Error("down"); }).request("/v1/suggest?q=x")).status).toBe(504);
  });
});
