import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { client, db } from "../src/db/client.js";
import { salesTaxAreas, salesTaxDataReleases, salesTaxJurisdictionRates, salesTaxJurisdictions,
  salesTaxShapes, salesTaxStreetRanges, salesTaxZipRanges } from "../src/db/schema.js";
import { fetchRangePolygons, loadRangePolygons, readRangePolygons } from "../src/ingest/range-polygons.js";
import { geometryOf } from "../src/ingest/geometry.js";
import { sstRateAt } from "../src/rates/ranges.js";
import { emptyTrace } from "../src/rates/types.js";
import { RANGE_POLYGON_SOURCES } from "../src/range-polygon-sources.js";

const states = ["MO", "UT"];
const square = (left: number, right: number): Array<Array<[number, number]>> =>
  [[[left, 41], [right, 41], [right, 42], [left, 42], [left, 41]]];
const polygon = (state: string, kind: "county" | "place" | "district", key: string, left: number, right: number) =>
  ({ kind, fips: `rp:${state}:${key}`, name: key, rings: square(left, right) });
const mo = [polygon("MO", "county", "COU:019", 0, 3), polygon("MO", "place", "MUN:15670", 0, 2),
  polygon("MO", "district", "CID:CID00120", 1, 2)];
const ut = [polygon("UT", "district", "043:58070:22030", 0, 1), polygon("UT", "district", "043:98043:22040", 1, 2)];
const rate = (state: string, type: string, code: string, value: number) =>
  ({ state, type, code, rate: String(value), startsOn: "2020-01-01", endsOn: "9999-12-31" });
async function clear() {
  for (const table of [salesTaxStreetRanges, salesTaxZipRanges, salesTaxAreas, salesTaxJurisdictionRates,
    salesTaxJurisdictions, salesTaxShapes, salesTaxDataReleases])
    await db.delete(table).where(inArray(table.state, states));
}
beforeAll(async () => {
  const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (!name.endsWith("_test")) throw new Error("Range polygon fixtures require a *_test database");
});
beforeEach(async () => {
  await clear();
  for (const state of states) await db.insert(salesTaxDataReleases).values([
    { state, kind: "rates", file: "dated rates", rows: 3 }, { state, kind: "boundaries", file: "ranges", rows: 2 },
  ]);
  await db.insert(salesTaxAreas).values([
    { id: 29900001, state: "MO", county: "019", place: "15670", districts: "99:15670-019-000", ids: { "Jurisdiction Code": "15670-019-000" } },
    { id: 29900002, state: "MO", county: "019", place: "15670", districts: "99:15670-019-010", ids: { "Jurisdiction Code": "15670-019-010" } },
    { id: 49900001, state: "UT", county: "043", place: "58070", districts: "" },
    { id: 49900002, state: "UT", county: "043", place: "98043", districts: "" },
  ]);
  await db.insert(salesTaxJurisdictions).values([
    { state: "MO", type: "99", code: "15670-019-000", file: "dated rates", ids: { "Jurisdiction Code": "15670-019-000" } },
    { state: "MO", type: "99", code: "15670-019-010", file: "dated rates", ids: { "Jurisdiction Code": "15670-019-010", "District Code 1": "CID00120" } },
  ]);
  await db.insert(salesTaxJurisdictionRates).values([
    rate("MO", "45", "29", .04225), rate("MO", "99", "15670-019-000", .0375), rate("MO", "99", "15670-019-010", .0475),
    rate("UT", "45", "49", .0485), rate("UT", "00", "043", .028), rate("UT", "01", "58070", .019), rate("UT", "01", "98043", .015),
  ]);
  await db.insert(salesTaxZipRanges).values([29900001, 29900002, 49900001, 49900002].map((areaId) => ({
    state: areaId < 40000000 ? "MO" : "UT", areaId, zip5: "99999", plus4Low: 0, plus4High: 9999, kind: "zip4" as const,
    startsOn: "2020-01-01", endsOn: "9999-12-31",
  })));
  await loadRangePolygons("MO", mo);
  await loadRangePolygons("UT", ut);
});
afterAll(async () => { await clear(); await client.end(); });
const lookup = (state: string, lon: number, date = "2026-10-21", trace = emptyTrace()) => sstRateAt({
  state, street: "123 Missing Street", city: "Town", zip: "99999", trace,
  locate: async () => ({ lon, lat: 41.5, accuracy: "rooftop" }),
}, date);

describe("indexed tax polygons for range states", () => {
  it("resolves both the base area and a special district using dated workbook rates", async () => {
    const base = await lookup("MO", .5);
    expect(base.rate).toBe(.07975);
    expect(base.locationIds).toEqual({ "Jurisdiction Code": "15670-019-000" });
    expect(base.files).toContain(RANGE_POLYGON_SOURCES.MO.file);
    expect((await lookup("MO", 1.5)).rate).toBe(.08975);
  });
  it("declines when tax polygons and an automatically looked-up ZIP+4 disagree (outlinesOverZip4 off)", async () => {
    await db.delete(salesTaxZipRanges).where(eq(salesTaxZipRanges.state, "MO"));
    await db.insert(salesTaxZipRanges).values([29900001, 29900002].map((areaId, i) => ({
      state: "MO", areaId, zip5: "99999", plus4Low: i ? 5000 : 0, plus4High: i ? 9999 : 4999,
      kind: "zip4" as const, startsOn: "2020-01-01", endsOn: "9999-12-31",
    })));
    // The outlines may be stale (Missouri's are a 2023 archive), so the
    // conflict is left to the state's own lookup.
    await expect(sstRateAt({ state: "MO", street: "123 Missing Street", city: "Town", zip: "99999",
      locate: async () => ({ lon: .5, lat: 41.5, accuracy: "rooftop" }),
      standardize: async () => ({ street: "123 Missing Street", city: "Town", state: "MO", zip5: "99999", plus4: "5000", exact: true, source: "fixture" }),
    }, "2026-10-21")).rejects.toMatchObject({ status: 422, message: expect.stringContaining("isn't confirmed") });
  });
  it("does not interpret a missing district polygon as zero tax", async () => {
    await db.delete(salesTaxShapes).where(and(eq(salesTaxShapes.state, "MO"), eq(salesTaxShapes.fips, "rp:MO:CID:CID00120")));
    await expect(lookup("MO", .5)).rejects.toMatchObject({ status: 422 });
  });
  it("requires workbook district identifiers rather than guessing a code", async () => {
    await db.delete(salesTaxJurisdictions).where(eq(salesTaxJurisdictions.state, "MO"));
    await expect(lookup("MO", .5)).rejects.toMatchObject({ status: 422 });
  });
  it("maps the Utah zone to the SST area, ignoring the layer's undated rate", async () => {
    const result = await lookup("UT", .5);
    expect(result.rate).toBe(.0955);
    expect(result.files).toContain(RANGE_POLYGON_SOURCES.UT.file);
    expect(result.parts.some((p) => p.code === "01:58070")).toBe(true);
  });
  it("declines a placement whose uncertainty crosses a tax-zone boundary", async () => {
    await expect(lookup("UT", .99999)).rejects.toMatchObject({ status: 422 });
  });
  it("does not project the boundary snapshot onto an earlier date", async () => {
    await expect(lookup("UT", .5, "2025-10-21")).rejects.toMatchObject({ status: 422 });
  });
  it("does not use archived polygons to overrule a published street range", async () => {
    await db.insert(salesTaxStreetRanges).values({ state: "MO", streetKey: "MISSING", street: "MISSING ST", suffix: "ST",
      city: "TOWN", zip5: "99999", houseLow: 100, houseHigh: 198, parity: "B", areaId: 29900001,
      startsOn: "2020-01-01", endsOn: "9999-12-31" });
    expect((await lookup("MO", 1.5)).rate).toBe(.07975);
  });
  it("retains Census shapes when replacing a polygon snapshot", async () => {
    await db.insert(salesTaxShapes).values({ state: "MO", kind: "county", fips: "019", name: "Boone", geom: geometryOf(square(0, 3)), file: "tl_fixture" });
    await loadRangePolygons("MO", mo);
    expect(await db.select().from(salesTaxShapes).where(and(eq(salesTaxShapes.state, "MO"), eq(salesTaxShapes.file, "tl_fixture")))).toHaveLength(1);
    expect(await db.select().from(salesTaxShapes).where(eq(salesTaxShapes.state, "MO"))).toHaveLength(4);
  });
  it("rejects an incomplete layer download before it can replace indexed shapes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "otr-range-polygons-"));
    vi.stubEnv("OPENTAXRATE_DOWNLOAD_DIR", directory);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ objectIds: [1, 2], objectIdFieldName: "OBJECTID" }))));
    try { await expect(fetchRangePolygons("MO")).rejects.toThrow("incomplete polygon batch"); }
    finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); }
  });
});

describe("source polygon parsing", () => {
  it("retains crosswalk ids and excludes rate attributes", () => {
    const parsed = readRangePolygons("MO", [{ properties: { JURISDICTION_TYPE: "CID", JURISDICTION_ID: "CID00120", JURISDICTION_NAME: "District", SALES_TAX: 99 }, geometry: { type: "Polygon", coordinates: square(0, 1) } }]);
    expect(parsed[0].fips).toBe("rp:MO:CID:CID00120");
    expect(parsed[0]).not.toHaveProperty("rate");
  });
});
