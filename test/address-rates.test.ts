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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

/** One house on Oak Dr, listed alone as Missouri's file lists addresses. */
const listed = (house: number, areaId: number) => ({
  ...street(house, house, areaId),
  streetKey: "OAK",
  street: "OAK DR",
  suffix: "DR",
  parity: house % 2 ? "O" : "E",
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
    // Oak Dr's odd side: 101 and 121 in Cheyenne, 141 past its line.
    listed(101, CITY_AREA),
    listed(121, CITY_AREA),
    listed(141, COUNTY_AREA),
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

describe("a Streamlined state's address its typed street doesn't find", () => {
  const cheyenne = (street: string, extra: object = {}) =>
    addressRates.at({ state: "WY", street, city: "Cheyenne", zip: "82001", ...extra }, ON);

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("takes its listed neighbours' area when both share one", async () => {
    const found = await cheyenne("111 Oak Dr");
    expect(found).toMatchObject({ rate: 0.07, match: "street" });
    expect(found.source).toContain("between listed houses 101 and 121");
  });

  it("is refused when its neighbours straddle a line, or it has none on its side", async () => {
    await expect(cheyenne("131 Oak Dr")).rejects.toThrow(/more than one rate/);
    await expect(cheyenne("112 Oak Dr")).rejects.toThrow(/more than one rate/);
  });

  it("is read as the ZIP's street its misspelling clearly is", async () => {
    const found = await cheyenne("150 Mainn St");
    expect(found).toMatchObject({ rate: 0.07, match: "street" });
    expect(found.source).toContain("street read as MAIN ST (closest spelling in the ZIP)");
  });

  it("asks Jev only when the spelling isn't clear, and takes only a confident pick", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    const jev = (confidence: number) =>
      vi.fn(async () => new Response(JSON.stringify({ answers: { pick: { choice: "MAIN ST", confidence } } })));
    vi.stubGlobal("fetch", jev(0.9));
    const found = await cheyenne("150 Mian St");
    expect(found).toMatchObject({ rate: 0.07, match: "street" });
    expect(found.source).toContain("street read as MAIN ST (Jev, confidence 0.90)");
    vi.stubGlobal("fetch", jev(0.3));
    await expect(cheyenne("150 Mian St")).rejects.toThrow(/more than one rate/);
  });

  it("is placed by its standardized ZIP+4, but not one in another ZIP", async () => {
    const standard = (zip5: string) => async () => ({ street: "9 Elm St", city: "Cheyenne", state: "WY", zip5, plus4: "1500", exact: true, source: "Geocodio" });
    const found = await cheyenne("9 Elm St", { standardize: standard("82001") });
    expect(found).toMatchObject({ rate: 0.07, match: "zip4" });
    expect(found.source).toContain("ZIP+4 82001-1500 from Geocodio");
    await expect(cheyenne("9 Elm St", { standardize: standard("82009") })).rejects.toThrow(/more than one rate/);
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
