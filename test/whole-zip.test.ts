/**
 * An address no geocoder places, in a ZIP that rated outlines cross: with
 * zipSameTotal, it gets the rate when every piece of the ZIP's widened area
 * has the same total, with the largest piece's jurisdictions and the others'
 * as alternatives. Runs on a *_test database, as "XZ" (a map-read state no
 * other test uses), with ZIPs 998xx.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, like, sql } from "drizzle-orm";
import { client, db } from "../src/db/client.js";
import { salesTaxDataReleases, salesTaxJurisdictionRates, salesTaxJurisdictions, salesTaxShapes, zipAreas } from "../src/db/schema.js";
import { loadGeoState } from "../src/ingest/load.js";
import { geometryOf } from "../src/ingest/geometry.js";
import { geoRateAt } from "../src/rates/map.js";
import { PARAMS } from "../src/params.js";

const square = (x0: number, y0: number, x1: number, y1: number) => ({
  rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] as Array<Array<[number, number]>>,
  bbox: [x0, y0, x1, y1] as [number, number, number, number],
});
const rate = (type: string, code: string, rate: number) => ({ type, code, rate, startsOn: "2020-01-01", endsOn: "9999-12-31" });

async function clear() {
  for (const table of [salesTaxJurisdictionRates, salesTaxJurisdictions, salesTaxShapes, salesTaxDataReleases])
    await db.delete(table).where(inArray(table.state, ["XZ"]));
  await db.delete(zipAreas).where(like(zipAreas.zip5, "998%"));
}

beforeAll(async () => {
  const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (!name.endsWith("_test"))
    throw new Error(`These tests replace rows; run them on a *_test database, not ${name}.`);
  await clear();
  // West Town (lon 0-1) adds 2%; East Town (lon 1-2) adds 1% and sits in
  // district D, which adds 1%: 6% either side of lon 1. East of lon 2 the
  // county alone: 4%.
  await loadGeoState("XZ", {
    rates: [rate("45", "97", 0.04), rate("01", "00001", 0.02), rate("01", "00002", 0.01), rate("sd", "D", 0.01), rate("sd", "T", 0.01)],
    jurisdictions: [],
    shapes: [
      { kind: "county", fips: "001", name: "One", ...square(0, 0, 3, 1) },
      { kind: "place", fips: "00001", name: "West Town", ...square(0, 0, 1, 1) },
      { kind: "place", fips: "00002", name: "East Town", ...square(1, 0, 2, 1) },
      { kind: "district", fips: "D", name: "District D", ...square(1, 0, 2, 1) },
      // About 20 m square, in West Town north of ZIP 99801's area.
      { kind: "district", fips: "T", name: "Tiny District", ...square(0.8, 0.85, 0.80018, 0.85018) },
    ],
    files: { rates: "rates-fixture", boundaries: "outlines-fixture" },
  });
  const zipArea = (zip5: string, lon0: number, lon1: number) => ({ zip5, geom: geometryOf(square(lon0, 0.4, lon1, 0.6).rings), file: "fixture" });
  await db.insert(zipAreas).values([
    zipArea("99801", 0.7, 1.2), // across West and East Town: 6% both sides, mostly West
    zipArea("99802", 1.7, 2.2), // across East Town and the county alone: 6% or 4%
    { zip5: "99803", geom: geometryOf(square(0.7, 0.75, 1.2, 0.9).rings), file: "fixture" }, // as 99801, with Tiny District
  ]);
});

afterAll(async () => {
  await clear();
  await client.end();
});

const unplaced = (zip: string) => geoRateAt("XZ", null, "2026-11-14", undefined, undefined, { zip });

describe("a ZIP that rated outlines cross", () => {
  it("is refused with zipSameTotal off", async () => {
    PARAMS.zipSameTotal = false;
    try {
      await expect(unplaced("99801")).rejects.toThrow(/couldn't be placed/);
    } finally {
      PARAMS.zipSameTotal = true;
    }
  });

  it("gets the rate where every piece has the same total, the largest piece's parts first", async () => {
    PARAMS.zipSameTotal = true;
    try {
      const found = await unplaced("99801");
      expect(found.rate).toBeCloseTo(0.06, 9);
      expect(found.wholeZip).toBe("99801");
      expect(found.parts.map((p) => p.code)).toContain("01:00001");
      expect(found.alternatives).toHaveLength(1);
      expect(found.alternatives[0].parts.map((p) => p.code)).toContain("sd:D");
    } finally {
      PARAMS.zipSameTotal = true;
    }
  });

  it("is refused where the pieces' totals differ, or breakdowns must agree", async () => {
    PARAMS.zipSameTotal = true;
    try {
      await expect(unplaced("99802")).rejects.toThrow(/couldn't be placed/);
      // Tiny District's piece is under the sliver size, but it is a small
      // outline, not a gap between neighbours: kept, and 7% there refuses.
      await expect(unplaced("99803")).rejects.toThrow(/couldn't be placed/);
      PARAMS.breakdownMustAgree = true;
      await expect(unplaced("99801")).rejects.toThrow(/couldn't be placed/);
    } finally {
      PARAMS.breakdownMustAgree = false;
    }
  });
});
