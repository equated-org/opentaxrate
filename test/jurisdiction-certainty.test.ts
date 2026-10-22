/**
 * A settled rate isn't a settled breakdown: an address near the line
 * between two districts with the same rate gets the rate, with the other
 * district's breakdown as an alternative, or a refusal with
 * breakdownMustAgree. Runs on a *_test database, as "XL" (a map-read state
 * no other test uses).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { client, db } from "../src/db/client.js";
import { salesTaxDataReleases, salesTaxJurisdictionRates, salesTaxJurisdictions, salesTaxShapes } from "../src/db/schema.js";
import { loadGeoState } from "../src/ingest/load.js";
import { geoRateAt } from "../src/rates/map.js";
import { PARAMS } from "../src/params.js";

const square = (x0: number, y0: number, x1: number, y1: number) => ({
  rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] as Array<Array<[number, number]>>,
  bbox: [x0, y0, x1, y1] as [number, number, number, number],
});
const rate = (type: string, code: string, rate: number) => ({ type, code, rate, startsOn: "2020-01-01", endsOn: "9999-12-31" });
// About 11 m east of the line between the districts, inside a rooftop's 15 m.
const nearLine = { lon: 1.0001, lat: 1, accuracy: "rooftop" as const };

async function clear() {
  for (const table of [salesTaxJurisdictionRates, salesTaxJurisdictions, salesTaxShapes, salesTaxDataReleases])
    await db.delete(table).where(inArray(table.state, ["XL"]));
}

beforeAll(async () => {
  const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (!name.endsWith("_test"))
    throw new Error(`These tests replace rows; run them on a *_test database, not ${name}.`);
  await clear();
  await loadGeoState("XL", {
    rates: [rate("45", "99", 0.04), rate("00", "001", 0.01), rate("sd", "A", 0.005), rate("sd", "B", 0.005), rate("sd", "C", 0.01)],
    jurisdictions: [],
    shapes: [
      { kind: "county", fips: "001", name: "One", ...square(0, 0, 3, 2) },
      { kind: "district", fips: "A", name: "West District", ...square(0, 0, 1, 2) },
      { kind: "district", fips: "B", name: "East District", ...square(1, 0, 2, 2) },
      { kind: "district", fips: "C", name: "Far District", ...square(2, 0, 3, 2) },
    ],
    files: { rates: "rates-fixture", boundaries: "outlines-fixture" },
  });
});

afterAll(async () => {
  await clear();
  await client.end();
});

describe("an address near a line with the same rate on both sides", () => {
  it("gets the rate, with the other side's jurisdictions as an alternative", async () => {
    const found = await geoRateAt("XL", nearLine, "2026-10-21");
    expect(found.rate).toBe(0.055);
    expect(found.parts.map((p) => p.code)).toContain("sd:B");
    expect(found.alternatives).toHaveLength(1);
    expect(found.alternatives[0].parts.map((p) => p.code)).toContain("sd:A");
  });

  it("has no alternatives far from any line", async () => {
    expect((await geoRateAt("XL", { ...nearLine, lon: 1.5 }, "2026-10-21")).alternatives).toEqual([]);
  });

  it("is refused with breakdownMustAgree", async () => {
    PARAMS.breakdownMustAgree = true;
    try {
      await expect(geoRateAt("XL", nearLine, "2026-10-21")).rejects.toThrow(/jurisdictions it is paid to differ/);
    } finally {
      PARAMS.breakdownMustAgree = false;
    }
  });

  it("lists a neighbour beyond the margin within breakdownMarginMetres, and never refuses there", async () => {
    // About 55 m from each line: past a rooftop's 15 m.
    const far = { ...nearLine, lon: 1.0005 };
    const given = PARAMS.breakdownMarginMetres;
    PARAMS.breakdownMarginMetres = 0;
    try {
      expect((await geoRateAt("XL", far, "2026-10-21")).alternatives).toEqual([]);
      PARAMS.breakdownMarginMetres = 100;
      expect((await geoRateAt("XL", far, "2026-10-21")).alternatives).toHaveLength(1);
      // Across the B/C line the rate differs, but only a breakdown is in
      // question this far out.
      expect((await geoRateAt("XL", { ...far, lon: 1.9995 }, "2026-10-21")).rate).toBe(0.055);
    } finally {
      PARAMS.breakdownMarginMetres = given;
    }
  });

  it("refuses a rate within outlineMarginMetres of a line", async () => {
    const far = { ...nearLine, lon: 1.9995 };
    PARAMS.outlineMarginMetres.XL = 100;
    try {
      await expect(geoRateAt("XL", far, "2026-10-21")).rejects.toThrow(/too close to tell/);
    } finally {
      delete PARAMS.outlineMarginMetres.XL;
    }
  });

  it("is still refused where the rates differ", async () => {
    await expect(geoRateAt("XL", { ...nearLine, lon: 2.0001 }, "2026-10-21")).rejects.toThrow(/too close to tell/);
  });
});
