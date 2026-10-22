/**
 * Outlines as dated editions: a new edition of a source ends the outlines it
 * changes or drops instead of replacing them, so a lookup on a past date
 * reads the lines in force then; and an address inside an outline whose
 * rate is on record only from a later date is refused for an earlier one.
 * Runs on a *_test database, as "XK" (a map-read state no other test uses).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { client, db } from "../src/db/client.js";
import { salesTaxDataReleases, salesTaxJurisdictionRates, salesTaxJurisdictions, salesTaxShapes } from "../src/db/schema.js";
import { loadGeoState } from "../src/ingest/load.js";
import { geoRateAt } from "../src/rates/map.js";

const square = (x0: number, y0: number, x1: number, y1: number) => ({
  rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] as Array<Array<[number, number]>>,
  bbox: [x0, y0, x1, y1] as [number, number, number, number],
});
const RATES = [
  { type: "45", code: "99", rate: 0.04, startsOn: "2020-01-01", endsOn: "9999-12-31" },
  { type: "00", code: "001", rate: 0.01, startsOn: "2020-01-01", endsOn: "9999-12-31" },
  { type: "01", code: "51000", rate: 0.02, startsOn: "2020-01-01", endsOn: "9999-12-31" },
  // On record only from 2025-09-01, the day the source first lists rates
  // like it, as a district a loader knows only from a current list.
  { type: "sd", code: "D1", rate: 0.005, startsOn: "2025-09-01", endsOn: "9999-12-31" },
];
const edition = (from: string, city: ReturnType<typeof square>, district: boolean) => ({
  rates: RATES,
  jurisdictions: [],
  shapes: [
    { kind: "county" as const, fips: "001", name: "One", ...square(0, 0, 2, 2) },
    { kind: "place" as const, fips: "51000", name: "Town", ...city },
    ...(district ? [{ kind: "district" as const, fips: "D1", name: "Library District", ...square(1, 1.2, 2, 2) }] : []),
  ],
  files: { rates: "rates-fixture", boundaries: `outlines ${from}` },
  boundariesFrom: from,
  ratesFirstListed: "2025-09-01",
});
const at = (lon: number, lat: number) => ({ lon, lat, accuracy: "rooftop" as const });
const rows = () =>
  db.select({ kind: salesTaxShapes.kind, fips: salesTaxShapes.fips, startsOn: salesTaxShapes.startsOn, endsOn: salesTaxShapes.endsOn })
    .from(salesTaxShapes).where(eq(salesTaxShapes.state, "XK"))
    .orderBy(salesTaxShapes.kind, salesTaxShapes.fips, salesTaxShapes.startsOn);

async function clear() {
  for (const table of [salesTaxJurisdictionRates, salesTaxJurisdictions, salesTaxShapes, salesTaxDataReleases])
    await db.delete(table).where(inArray(table.state, ["XK"]));
}

beforeAll(async () => {
  const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (!name.endsWith("_test"))
    throw new Error(`These tests replace rows; run them on a *_test database, not ${name}.`);
  await clear();
  await loadGeoState("XK", edition("2024-01-01", square(0, 0, 1, 1), true));
  // The town annexes land to its east; the district's outline is dropped.
  await loadGeoState("XK", edition("2026-07-01", square(0, 0, 1.5, 1), false));
});

afterAll(async () => {
  await clear();
  await client.end();
});

describe("loading a new edition of a state's outlines", () => {
  it("ends the outlines it changes or drops, and keeps the unchanged ones whole", async () => {
    expect(await rows()).toEqual([
      { kind: "county", fips: "001", startsOn: "0001-01-01", endsOn: "9999-12-31" },
      { kind: "district", fips: "D1", startsOn: "0001-01-01", endsOn: "2026-06-30" },
      { kind: "place", fips: "51000", startsOn: "0001-01-01", endsOn: "2026-06-30" },
      { kind: "place", fips: "51000", startsOn: "2026-07-01", endsOn: "9999-12-31" },
    ]);
  });

  it("leaves the same rows when the same edition is loaded again", async () => {
    const before = await rows();
    await loadGeoState("XK", edition("2026-07-01", square(0, 0, 1.5, 1), false));
    expect(await rows()).toEqual(before);
  });

  it("starts a changed outline on the reloaded edition's day, replacing the open row from that day", async () => {
    await loadGeoState("XK", edition("2026-07-01", square(0, 0, 1.6, 1), false));
    const places = (await rows()).filter((r) => r.kind === "place");
    expect(places).toEqual([
      { kind: "place", fips: "51000", startsOn: "0001-01-01", endsOn: "2026-06-30" },
      { kind: "place", fips: "51000", startsOn: "2026-07-01", endsOn: "9999-12-31" },
    ]);
    await loadGeoState("XK", edition("2026-07-01", square(0, 0, 1.5, 1), false));
  });
});

describe("a lookup on a date", () => {
  it("reads the outlines in force on it", async () => {
    expect((await geoRateAt("XK", at(1.25, 0.5), "2026-08-01")).rate).toBe(0.07);
    expect((await geoRateAt("XK", at(1.25, 0.5), "2025-06-01")).rate).toBe(0.05);
  });

  it("refuses inside an outline whose rate is on record only from a later date", async () => {
    await expect(geoRateAt("XK", at(1.5, 1.6), "2025-06-01")).rejects.toThrow(/on record only from 2025-09-01/);
    expect((await geoRateAt("XK", at(1.5, 1.6), "2025-10-01")).rate).toBe(0.055);
  });

  it("takes a later rate's start as the publisher's where its source doesn't say otherwise", async () => {
    await loadGeoState("XK", { ...edition("2026-07-01", square(0, 0, 1.5, 1), false), ratesFirstListed: undefined });
    try {
      // Before a new district's first rate, it levied nothing.
      expect((await geoRateAt("XK", at(1.5, 1.6), "2025-06-01")).rate).toBe(0.05);
    } finally {
      await loadGeoState("XK", edition("2026-07-01", square(0, 0, 1.5, 1), false));
    }
  });

  it("counts no outline after its edition ends", async () => {
    // The district's outline ended 2026-06-30: after it, nothing says the
    // address is in it.
    expect((await geoRateAt("XK", at(1.5, 1.6), "2026-08-01")).rate).toBe(0.05);
    const [district] = await db.select().from(salesTaxShapes)
      .where(and(eq(salesTaxShapes.state, "XK"), eq(salesTaxShapes.fips, "D1")));
    expect(district.endsOn).toBe("2026-06-30");
  });
});
