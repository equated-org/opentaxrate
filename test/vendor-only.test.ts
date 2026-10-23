/**
 * Taxes only vendors located in their area collect (vendorOnlyTaxes):
 * Wyoming's resort districts are left out of the rate on a sale delivered
 * there, so a Jackson ZIP that holds Teton Village has one rate. Runs on a
 * *_test database, as "XW" (a Wyoming-like state no other test uses).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { client, db } from "../src/db/client.js";
import { salesTaxAreas, salesTaxJurisdictionRates } from "../src/db/schema.js";
import { rateAreas } from "../src/rates/ranges.js";
import { PARAMS } from "../src/params.js";

const rate = (type: string, code: string, value: number) =>
  ({ state: "XW", type, code, rate: String(value), startsOn: "2020-01-01", endsOn: "9999-12-31" });

async function clear() {
  for (const table of [salesTaxJurisdictionRates, salesTaxAreas]) await db.delete(table).where(inArray(table.state, ["XW"]));
}

const given = PARAMS.vendorOnlyTaxes;

beforeAll(async () => {
  PARAMS.vendorOnlyTaxes = ["XW:69"];
  const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (!name.endsWith("_test")) throw new Error(`These tests replace rows; run them on a *_test database, not ${name}.`);
  await clear();
  await db.insert(salesTaxJurisdictionRates).values([rate("45", "98", 0.04), rate("00", "039", 0.03), rate("69", "02290", 0.02)]);
  // Teton County, and Teton Village's resort district within it.
  await db.insert(salesTaxAreas).values([
    { id: 98000001, state: "XW", county: "039", place: null, districts: "" },
    { id: 98000002, state: "XW", county: "039", place: "02290", districts: "" },
  ]);
});

afterAll(async () => {
  PARAMS.vendorOnlyTaxes = given;
  await clear();
  await client.end();
});

describe("a tax only vendors located in its district collect", () => {
  it("is left out of the delivered rate, and named", async () => {
    const [county, village] = await rateAreas("XW", "98", [98000001, 98000002], "2026-10-21");
    expect(county.rate).toBe(0.07);
    expect(village.rate).toBe(0.07);
    expect(village.vendorOnly).toEqual([{ code: "69:02290", rate: 0.02 }]);
  });

  it("is added when the setting doesn't name it", async () => {
    PARAMS.vendorOnlyTaxes = [];
    try {
      const [, village] = await rateAreas("XW", "98", [98000001, 98000002], "2026-10-21");
      expect(village.rate).toBe(0.09);
    } finally {
      PARAMS.vendorOnlyTaxes = ["XW:69"];
    }
  });
});
