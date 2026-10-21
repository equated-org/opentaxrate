/**
 * include=trace against loaded data: a Texas map answer shows the geocoders'
 * points, the margin and the outlines drawn near the point; an Ohio street
 * answer shows the range that decided and no point. Read-only.
 *
 * Needs a database with TX and OH loaded, and the Census and Nominatim
 * geocoders reachable, so it is skipped elsewhere (the *_test database the
 * rest of the suite runs on has neither):
 *   DATABASE_URL=postgres://opentaxrate:opentaxrate@localhost:5433/opentaxrate pnpm test test/trace.test.ts
 */
import { describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { salesTaxDataReleases } from "../src/db/schema.js";
import { app } from "../src/server.js";

const loaded = await db
  .selectDistinct({ state: salesTaxDataReleases.state })
  .from(salesTaxDataReleases)
  .where(inArray(salesTaxDataReleases.state, ["TX", "OH"]))
  .then((rows) => rows.length === 2)
  .catch(() => false);

const rate = (q: string) => app.request(`/v1/rate?${q}`);

describe.skipIf(!loaded)("a traced lookup on loaded data", () => {
  it("places a Texas address with its geocoders, margin and outlines", { timeout: 30_000 }, async () => {
    const response = await rate("state=TX&street=1100+Congress+Ave&city=Austin&zip=78701&include=trace");
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text.length).toBeLessThan(40_000);
    const body = JSON.parse(text);
    expect(body).toMatchObject({ rate: 0.0825, match: "map" });
    const { trace } = body;
    expect(trace.geocoders.length).toBeGreaterThanOrEqual(1);
    for (const g of trace.geocoders) expect(["census", "nominatim", "mapbox"]).toContain(g.source);
    expect(trace.point).toMatchObject({ lon: expect.closeTo(-97.74, 1), lat: expect.closeTo(30.27, 1) });
    expect(trace.point.marginMetres).toBeGreaterThanOrEqual(15);
    // Five decimals at most.
    expect(String(trace.point.lon).split(".")[1].length).toBeLessThanOrEqual(5);
    const austin = trace.outlines.find((o: { kind: string; name: string }) => o.kind === "place" && o.name === "Austin");
    expect(austin).toMatchObject({ inside: true, levies: true });
    expect(["Polygon", "MultiPolygon"]).toContain(austin.geometry.type);
    expect(trace.outlines.some((o: { kind: string }) => o.kind === "county")).toBe(true);
    expect(trace.range).toBeUndefined();
  });

  it("shows an Ohio street match's range, with no point and no outlines", async () => {
    const response = await rate("state=OH&street=90+W+Broad+St&city=Columbus&zip=43215&include=trace");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.match).toBe("street");
    expect(body.trace).toEqual({
      geocoders: [],
      outlines: [],
      range: { street: "W BROAD ST", low: 90, high: 90, side: "even", zip: "43215", file: expect.stringMatching(/^OHB/) },
    });
  });

  it("answers exactly as before without include", async () => {
    const plain = await (await rate("state=OH&street=90+W+Broad+St&city=Columbus&zip=43215")).json();
    expect(plain).not.toHaveProperty("trace");
  });
});
