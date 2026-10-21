/**
 * Address rates end to end against the database: what rate an address gets,
 * and when it is refused instead of guessed.
 *
 * Setup, on a map of square outlines (one degree is ~85-110 km here):
 *   - Wyoming, read from Streamlined files: state 4%; Laramie County (021)
 *     1%; Cheyenne (13900) 2% more. ZIP 82001 holds a street range for
 *     100-198 Main St in Cheyenne and one for 200-298 outside it, so the ZIP
 *     is split; ZIP 82009 holds only county addresses. County outline spans
 *     lon -105..-104, Cheyenne's -105..-104.5.
 *   - "XT", a map-read state: state 5%; county 001 2% across lon 0..2;
 *     city 10000 (lon 0..1) adds 1%; city 20000 (lon 1..2) 3% replacing its
 *     county; county 003 (lon 2..4) 1% only outside its cities; a transit
 *     district T1 (lon 0..0.5) 0.5%.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import {
  salesTaxAreas,
  salesTaxDataReleases,
  salesTaxJurisdictionRates,
  salesTaxShapes,
  salesTaxStreetRanges,
  salesTaxZipRanges,
} from "../src/db/schema.js";
import { addressRates } from "../src/rates/index.js";
import { geoRateAt } from "../src/rates/map.js";
import { geometryOf } from "../src/ingest/geometry.js";
import type { LocatedPoint } from "../src/geocoding/index.js";

const STATES = ["WY", "XT"];
const ON = "2026-10-21";

const square = (
  lon0: number,
  lon1: number,
  lat0 = 41,
  lat1 = 42,
): Array<Array<[number, number]>> => [
  [
    [lon0, lat0],
    [lon1, lat0],
    [lon1, lat1],
    [lon0, lat1],
    [lon0, lat0],
  ],
];

function shape(
  state: string,
  kind: "county" | "place" | "cousub" | "district",
  fips: string,
  lon0: number,
  lon1: number,
) {
  return {
    state,
    kind,
    fips,
    name: `${kind} ${fips}`,
    geom: geometryOf(square(lon0, lon1)),
    file: "fixture",
  };
}

const rate = (state: string, type: string, code: string, r: number, startsOn = "2020-01-01", endsOn = "9999-12-31") => ({
  state,
  type,
  code,
  rate: String(r),
  startsOn,
  endsOn,
});

const street = (houseLow: number, houseHigh: number, areaId: number, zip5 = "82001", plus4: string | null = null) => ({
  state: "WY",
  streetKey: "MAIN",
  street: "MAIN ST",
  suffix: "ST",
  houseLow,
  houseHigh,
  parity: "B",
  city: "CHEYENNE",
  zip5,
  plus4,
  startsOn: "2020-01-01",
  endsOn: "9999-12-31",
  areaId,
});

const COUNTY_AREA = 56_999_001;
const CITY_AREA = 56_999_002;

async function clear() {
  for (const table of [
    salesTaxStreetRanges,
    salesTaxZipRanges,
    salesTaxJurisdictionRates,
    salesTaxAreas,
    salesTaxShapes,
    salesTaxDataReleases,
  ])
    await db.delete(table).where(inArray(table.state, STATES));
}

beforeAll(async () => {
  // The fixtures replace every Wyoming row; on a loaded database that would
  // wipe the real state.
  const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (!name.endsWith("_test"))
    throw new Error(`These tests replace Wyoming's rows; run them on a *_test database, not ${name}.`);
  await clear();
  await db.insert(salesTaxDataReleases).values([
    { state: "WY", kind: "rates", file: "WYR-fixture", rows: 3 },
    { state: "WY", kind: "boundaries", file: "WYB-fixture", rows: 4 },
    { state: "XT", kind: "rates", file: "XT-fixture", rows: 6 },
  ]);
  await db.insert(salesTaxAreas).values([
    { id: COUNTY_AREA, state: "WY", county: "021", place: null, districts: "" },
    { id: CITY_AREA, state: "WY", county: "021", place: "13900", districts: "" },
  ]);
  await db.insert(salesTaxStreetRanges).values([
    street(100, 198, CITY_AREA, "82001", "1234"),
    street(200, 298, COUNTY_AREA),
    street(100, 198, COUNTY_AREA, "82009"),
  ]);
  await db.insert(salesTaxZipRanges).values([
    { state: "WY", zip5: "82001", plus4Low: 1000, plus4High: 1999, kind: "zip4", startsOn: "2020-01-01", endsOn: "9999-12-31", areaId: CITY_AREA },
    { state: "WY", zip5: "82001", plus4Low: 5000, plus4High: 5999, kind: "zip4", startsOn: "2020-01-01", endsOn: "9999-12-31", areaId: COUNTY_AREA },
  ]);
  await db.insert(salesTaxJurisdictionRates).values([
    rate("WY", "45", "56", 0.04),
    rate("WY", "00", "021", 0.01),
    rate("WY", "01", "13900", 0.02),
    rate("XT", "45", "99", 0.05),
    rate("XT", "00", "001", 0.02),
    rate("XT", "01", "10000", 0.01),
    rate("XT", "01x", "20000", 0.03),
    rate("XT", "rc", "003", 0.01),
    rate("XT", "63", "T1", 0.005),
  ]);
  await db.insert(salesTaxShapes).values([
    shape("WY", "county", "021", -105, -104),
    shape("WY", "place", "13900", -105, -104.5),
    shape("XT", "county", "001", 0, 2),
    shape("XT", "county", "003", 2, 4),
    shape("XT", "place", "10000", 0, 1),
    shape("XT", "place", "20000", 1, 2),
    shape("XT", "place", "30000", 3, 4),
    shape("XT", "district", "T1", 0, 0.5),
  ]);
});

afterAll(clear);

const at = (lon: number, accuracy: LocatedPoint["accuracy"] = "rooftop"): LocatedPoint => ({
  lon,
  lat: 41.5,
  accuracy,
});

describe("a Streamlined state's address", () => {
  it("takes its street range's rate, typed however the owner types it", async () => {
    const found = await addressRates.at(
      { state: "WY", street: "150 Main Street", city: "Cheyenne", zip: "82001" },
      ON,
    );
    expect(found).toMatchObject({ rate: 0.07, match: "street", locationCode: "56-021-13900" });
    expect(found.source).toContain("WYR-fixture");
  });

  it("is refused when its street range and ZIP+4 disagree", async () => {
    await expect(
      addressRates.at({ state: "WY", street: "150 Main St", city: "Cheyenne", zip: "82001-5100" }, ON),
    ).rejects.toThrow(/disagree.*5% \(Cheyenne\) or 7% \(Cheyenne\)/);
  });

  it("off any range, takes its ZIP's rate only when the whole ZIP has one", async () => {
    expect(
      await addressRates.at({ state: "WY", street: "9 Elm St", city: "Cheyenne", zip: "82009" }, ON),
    ).toMatchObject({ rate: 0.05, match: "zip5" });
    await expect(
      addressRates.at({ state: "WY", street: "9 Elm St", city: "Cheyenne", zip: "82001" }, ON),
    ).rejects.toThrow(/more than one rate.*5% \(Cheyenne\) or 7% \(Cheyenne\)/);
  });

  it("in a split ZIP, is settled by which outlines its map point falls in, unless it is near a line", async () => {
    const lookup = (lon: number, accuracy?: LocatedPoint["accuracy"]) =>
      addressRates.at(
        { state: "WY", street: "9 Elm St", city: "Cheyenne", zip: "82001", locate: async () => at(lon, accuracy) },
        ON,
      );
    expect(await lookup(-104.8)).toMatchObject({ rate: 0.07, match: "map" });
    expect(await lookup(-104.2)).toMatchObject({ rate: 0.05, match: "map" });
    // 0.0005° of longitude is ~40 m: inside a rooftop's margin, not a street's.
    await expect(lookup(-104.5005, "interpolated")).rejects.toThrow(/within 75 m/);
  });
});

describe("a map-read state's address", () => {
  it("adds each outline's rate it falls in", async () => {
    // County 2% + city 1% + transit 0.5%.
    expect(await geoRateAt("XT", at(0.25), ON)).toMatchObject({ rate: 0.085, locationCode: "99-001-10000-T1" });
    // County 2% + city 1%, outside the district.
    expect((await geoRateAt("XT", at(0.75), ON)).rate).toBe(0.08);
  });

  it("lets a city's own rate stand in for its county's, and a county's remainder rate stop at city lines", async () => {
    expect((await geoRateAt("XT", at(1.5), ON)).rate).toBe(0.08);
    expect((await geoRateAt("XT", at(2.5), ON)).rate).toBe(0.06);
    // City 30000 levies nothing, so the county's remainder rate still applies.
    expect((await geoRateAt("XT", at(3.5), ON)).rate).toBe(0.06);
  });

  it("near a line, is refused only when the other side's rate differs", async () => {
    // 0.0001° of longitude is ~8 m here.
    await expect(geoRateAt("XT", at(0.5001), ON)).rejects.toThrow(/within 15 m/);
    // County 001 → county 003 at lon 2 changes the rate (8% vs 6%).
    await expect(geoRateAt("XT", at(2.0001), ON)).rejects.toThrow(/8% or 6%|6% or 8%/);
  });

  it("is refused without a map point", async () => {
    await expect(geoRateAt("XT", null, ON)).rejects.toThrow(/couldn't be placed on the map/);
  });
});

describe("a statewide state's address", () => {
  it("takes the rate in force on the sale's date", async () => {
    const dc = (date: string) =>
      addressRates.at({ state: "DC", street: "1350 Pennsylvania Ave NW", city: "Washington" }, date);
    expect((await dc("2025-09-30")).rate).toBe(0.06);
    expect((await dc("2025-10-01")).rate).toBe(0.06);
    expect((await dc("2026-10-01")).rate).toBe(0.06);
  });

  it("is refused in a Montana resort area, which levies its own tax", async () => {
    await expect(
      addressRates.at({ state: "MT", street: "418 E 2nd St", city: "Whitefish" }, ON),
    ).rejects.toThrow(/resort area/);
    expect(
      (await addressRates.at({ state: "MT", street: "1 Main St", city: "Helena" }, ON)).rate,
    ).toBe(0);
  });
});
