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
import { inArray, like, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import {
  salesTaxAreas,
  salesTaxDataReleases,
  salesTaxJurisdictionRates,
  salesTaxShapes,
  salesTaxStreetRanges,
  salesTaxZipRanges,
  zipAreas,
  zipStreetNames,
} from "../src/db/schema.js";
import { addressRates } from "../src/rates/index.js";
import { geoRateAt } from "../src/rates/map.js";
import { geometryOf } from "../src/ingest/geometry.js";
import type { LocatedPoint } from "../src/geocoding/index.js";
import { emptyTrace } from "../src/rates/types.js";

const STATES = ["WY", "XT", "MT"];
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
const DISTRICT_AREA = 56_999_003;

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
  await db.delete(zipAreas).where(like(zipAreas.zip5, "990%"));
  await db.delete(zipStreetNames).where(inArray(zipStreetNames.state, STATES));
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
    { state: "MT", kind: "rates", file: "MT-fixture", rows: 2 },
  ]);
  await db.insert(salesTaxAreas).values([
    { id: COUNTY_AREA, state: "WY", county: "021", place: null, districts: "" },
    { id: CITY_AREA, state: "WY", county: "021", place: "13900", districts: "" },
    { id: DISTRICT_AREA, state: "WY", county: "021", place: "02290", districts: "" },
  ]);
  await db.insert(salesTaxStreetRanges).values([
    street(100, 198, CITY_AREA, "82001", "1234"),
    street(200, 298, COUNTY_AREA),
    street(100, 198, COUNTY_AREA, "82009"),
    // ZIPs 82002 and 82003 list only Main St's 100 block, the rest of each
    // its default, the county: in 82002 the block is a resort district, in
    // 82003 the city.
    street(100, 198, DISTRICT_AREA, "82002"),
    street(100, 198, CITY_AREA, "82003"),
    // Oak Dr's odd side: 101 and 121 in Cheyenne, 141 past its line.
    listed(101, CITY_AREA),
    listed(121, CITY_AREA),
    listed(141, COUNTY_AREA),
  ]);
  await db.insert(salesTaxZipRanges).values([
    { state: "WY", zip5: "82001", plus4Low: 1000, plus4High: 1999, kind: "zip4", startsOn: "2020-01-01", endsOn: "9999-12-31", areaId: CITY_AREA },
    { state: "WY", zip5: "82001", plus4Low: 5000, plus4High: 5999, kind: "zip4", startsOn: "2020-01-01", endsOn: "9999-12-31", areaId: COUNTY_AREA },
    { state: "WY", zip5: "82002", plus4Low: 0, plus4High: 9999, kind: "zip4", startsOn: "2020-01-01", endsOn: "9999-12-31", areaId: COUNTY_AREA },
    { state: "WY", zip5: "82003", plus4Low: 0, plus4High: 9999, kind: "zip4", startsOn: "2020-01-01", endsOn: "9999-12-31", areaId: COUNTY_AREA },
  ]);
  await db.insert(salesTaxJurisdictionRates).values([
    rate("WY", "45", "56", 0.04),
    rate("WY", "00", "021", 0.01),
    rate("WY", "01", "13900", 0.02),
    rate("WY", "69", "02290", 0.02),
    rate("XT", "45", "99", 0.05),
    rate("XT", "00", "001", 0.02),
    rate("XT", "01", "10000", 0.01),
    rate("XT", "01x", "20000", 0.03),
    rate("XT", "rc", "003", 0.01),
    rate("XT", "63", "T1", 0.005),
    rate("MT", "45", "30", 0),
    rate("MT", "rt", "WHITEFISH", 0.03),
    rate("MT", "no", "CRAIG", 0),
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
    shape("MT", "county", "029", 10, 12),
    shape("MT", "district", "WHITEFISH", 10, 11),
  ]);
  // ZIP areas in XT, 0.2° of latitude tall (lat 41.4-41.6).
  const zipArea = (zip5: string, lon0: number, lon1: number) => ({
    zip5, geom: geometryOf(square(lon0, lon1, 41.4, 41.6)), file: "fixture",
  });
  await db.insert(zipAreas).values([
    zipArea("99001", 2.2, 2.6), // county 003, outside every rated city
    zipArea("99002", 0.4, 0.6), // across district T1's line at lon 0.5
    zipArea("99003", 0.6, 0.9), // inside city 10000, clear of T1
    zipArea("99004", 2.01, 2.5), // ~800 m from county 001's line
  ]);
  // The Census lists Elm St only in ZIP 99003, far from 99001, and Main St
  // in 99001.
  await db.insert(zipStreetNames).values([
    { state: "XT", zip5: "99003", streetKey: "ELM", street: "Elm St", file: "fixture" },
    { state: "XT", zip5: "99001", streetKey: "MAIN", street: "Main St", file: "fixture" },
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
    expect(found).toMatchObject({ rate: 0.07, match: "street", locationCode: "56-021-13900", zip4: "82001-1234" });
    expect(found.source).toContain("WYR-fixture");
    // A range the file gives no ZIP+4 says none.
    expect((await addressRates.at({ state: "WY", street: "250 Main St", city: "Cheyenne", zip: "82001" }, ON)).zip4).toBeNull();
  });

  it("takes the map over its street range when two datasets place it clear of the line", async () => {
    const precise = { ...at(-104.2), placedBy: ["mapbox (mapbox)", "google (google)"] };
    const found = await addressRates.at(
      { state: "WY", street: "150 Main St", city: "Cheyenne", zip: "82001", locate: async () => precise },
      ON,
    );
    expect(found).toMatchObject({ rate: 0.05, match: "map" });
    expect(found.source).toContain("in place of the street range's 7%");
    // Two providers on one dataset (Geocodio's TIGER points are Census's) aren't two datasets.
    const oneDataset = { ...at(-104.2), placedBy: ["census (tiger)", "geocodio (tiger)"] };
    await expect(
      addressRates.at({ state: "WY", street: "150 Main St", city: "Cheyenne", zip: "82001", locate: async () => oneDataset }, ON),
    ).rejects.toThrow(/disagree/);
    // One dataset alone isn't enough to overrule the state's file.
    await expect(
      addressRates.at({ state: "WY", street: "150 Main St", city: "Cheyenne", zip: "82001", locate: async () => at(-104.2) }, ON),
    ).rejects.toThrow(/disagree/);
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

  it("on a street its ZIP doesn't list, takes the ZIP's default only where the rest of the ZIP adds just districts", async () => {
    const lookup = (street: string, zip: string) => addressRates.at({ state: "WY", street, city: "Cheyenne", zip }, ON);
    const found = await lookup("9 Elm St", "82002");
    expect(found).toMatchObject({ rate: 0.05, match: "zip5" });
    expect(found.source).toContain("the ZIP's default");
    // A listed street without the house, or a default that leaves out a city's tax, doesn't.
    await expect(lookup("300 Main St", "82002")).rejects.toThrow(/more than one rate/);
    await expect(lookup("9 Elm St", "82003")).rejects.toThrow(/more than one rate/);
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

  it("is refused when the map contradicts a looked-up ZIP+4", async () => {
    const standard = async () => ({ street: "9 Elm St", city: "Cheyenne", state: "WY", zip5: "82001", plus4: "1500", exact: true, source: "Geocodio" });
    // ZIP+4 1500 is Cheyenne's 7%; the map puts the house outside Cheyenne, at 5%.
    await expect(cheyenne("9 Elm St", { standardize: standard, locate: async () => at(-104.2) })).rejects.toThrow(/isn't confirmed/);
    expect(await cheyenne("9 Elm St", { standardize: standard, locate: async () => at(-104.8) })).toMatchObject({ rate: 0.07, match: "zip4" });
  });

  it("is placed by its standardized ZIP+4, but not one in another ZIP", async () => {
    const standard = (zip5: string) => async () => ({ street: "9 Elm St", city: "Cheyenne", state: "WY", zip5, plus4: "1500", exact: true, source: "Geocodio" });
    const found = await cheyenne("9 Elm St", { standardize: standard("82001") });
    expect(found).toMatchObject({ rate: 0.07, match: "zip4", zip4: "82001-1500" });
    expect(found.source).toContain("ZIP+4 82001-1500 from Geocodio");
    await expect(cheyenne("9 Elm St", { standardize: standard("82009") })).rejects.toThrow(/more than one rate/);
  });
});

describe("boundary refinement", () => {
  it.each([[0.5004, 0.08], [0.4996, 0.085]])("recomputes the map rate at the refined point %s", async (lon, rate) => {
    const locate = vi.fn(async (need?: { marginUnder: number }) => need ? at(lon) : at(0.5001, "point"));
    expect((await geoRateAt("XT", locate, ON)).rate).toBe(rate);
    expect(locate).toHaveBeenCalledTimes(2);
    expect(locate.mock.calls[1][0]?.marginUnder).toBeLessThan(10);
  });
  it("refuses after one refinement when the new point is still near an edge", async () => {
    const locate = vi.fn(async (need?: { marginUnder: number }) => at(0.5001, need ? "rooftop" : "point"));
    await expect(geoRateAt("XT", locate, ON)).rejects.toThrow(/within 15 m/);
    expect(locate).toHaveBeenCalledTimes(2);
  });
  it("rechecks candidate areas in a split ZIP at the new point", async () => {
    const locate = vi.fn(async (need?: { marginUnder: number }) => need ? at(-104.4996) : at(-104.5001, "point"));
    const found = await addressRates.at({ state: "WY", street: "9 Elm St", city: "Cheyenne", zip: "82001", locate }, ON);
    expect(found).toMatchObject({ rate: 0.05, match: "map" });
    expect(locate).toHaveBeenCalledTimes(2);
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

  it("without a map point, takes the rate its whole ZIP has", async () => {
    const byZip = (zip: string, city = "Rural") => geoRateAt("XT", null, ON, undefined, undefined, { zip, city });
    // State 5% + county 003's remainder 1%.
    expect(await byZip("99001")).toMatchObject({ rate: 0.06, wholeZip: "99001", placedBy: [] });
    // County 2% + city 1%, ZIP+4 typed.
    expect((await byZip("99003-1234")).rate).toBe(0.08);
    // A district line crosses the ZIP; within the margin of a county line.
    await expect(byZip("99002")).rejects.toThrow(/couldn't be placed on the map/);
    await expect(byZip("99004")).rejects.toThrow(/couldn't be placed on the map/);
    // No area for the ZIP, or none typed.
    await expect(byZip("99999")).rejects.toThrow(/couldn't be placed on the map/);
    await expect(geoRateAt("XT", null, ON)).rejects.toThrow(/couldn't be placed on the map/);
  });

  it("without a map point, doesn't trust a ZIP that doesn't reach the typed city", async () => {
    // City 10000 has an outline, and it is nowhere near ZIP 99001.
    await expect(geoRateAt("XT", null, ON, undefined, undefined, { zip: "99001", city: "place 10000" }))
      .rejects.toThrow(/couldn't be placed on the map/);
    expect((await geoRateAt("XT", null, ON, undefined, undefined, { zip: "99003", city: "place 10000" })).rate).toBe(0.08);
  });

  it("without a map point, doesn't trust a ZIP the typed street is listed only far from", async () => {
    const byZip = (street: string) => geoRateAt("XT", null, ON, street, undefined, { zip: "99001", city: "Rural" });
    await expect(byZip("12 Elm St")).rejects.toThrow(/couldn't be placed on the map/);
    expect((await byZip("12 Main St")).rate).toBe(0.06);
    // A street the Census lists nowhere says nothing either way.
    expect((await byZip("12 Coronel Corte")).rate).toBe(0.06);
  });
});

describe("a trace of how the address was placed", () => {
  it("records a street match's range, and no point or outlines when none was used", async () => {
    const trace = emptyTrace();
    await addressRates.at({ state: "WY", street: "150 Main Street", city: "Cheyenne", zip: "82001", trace }, ON);
    expect(trace).toEqual({
      geocoders: [],
      outlines: [],
      range: { street: "MAIN ST", low: 100, high: 198, side: "both", zip: "82001", file: "WYB-fixture" },
    });
  });

  it("records each outline around a map point and which ones levy", async () => {
    const trace = emptyTrace();
    await geoRateAt("XT", at(0.25), ON, undefined, trace);
    const byKey = Object.fromEntries(trace.outlines.map((o) => [`${o.kind}:${o.fips}`, o]));
    expect(byKey["county:001"]).toMatchObject({ inside: true, levies: true });
    expect(byKey["place:10000"]).toMatchObject({ inside: true, levies: true });
    expect(byKey["district:T1"]).toMatchObject({ name: "district T1", inside: true, levies: true });
    // The district's sides at lon 0 and 0.5 are each ~21 km away.
    expect(byKey["district:T1"].edgeMetres).toBeGreaterThan(20_000);
    expect([0, 0.5]).toContain(byKey["district:T1"].foot.lon);
  });

  it("keeps the outlines on a refusal, so the line it was too close to can be shown", async () => {
    const trace = emptyTrace();
    await expect(geoRateAt("XT", at(0.5001), ON, undefined, trace)).rejects.toThrow(/within 15 m/);
    expect(trace.outlines.find((o) => o.fips === "T1")?.edgeMetres).toBeLessThan(15);
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

  it("takes a Montana resort area's rate inside its outline, refuses near its edge, and is 0% outside", async () => {
    const whitefish = (lon: number) =>
      addressRates.at({ state: "MT", street: "418 E 2nd St", city: "Whitefish", locate: async () => at(lon) }, ON);
    expect(await whitefish(10.5)).toMatchObject({ rate: 0.03, match: "map" });
    // 0.0001° (~8 m) outside the outline is inside a rooftop's 15 m margin.
    await expect(whitefish(11.0001)).rejects.toThrow(/within 15 m of the district WHITEFISH line/);
    await expect(
      addressRates.at({ state: "MT", street: "418 E 2nd St", city: "Whitefish", locate: async () => null }, ON),
    ).rejects.toThrow(/Whitefish levies its own local tax, and this address couldn't be placed/);
    expect(await whitefish(11.5)).toMatchObject({ rate: 0, match: "map" });
    // Craig publishes no outline: an address there that can't be placed is
    // refused by name; another Montana town is 0%.
    await expect(
      addressRates.at({ state: "MT", street: "375 Augusta St", city: "Craig" }, ON),
    ).rejects.toThrow(/Craig levies its own local tax and publishes no outline/);
    // Placed or not.
    await expect(
      addressRates.at({ state: "MT", street: "375 Augusta St", city: "Craig", locate: async () => at(11.5) }, ON),
    ).rejects.toThrow(/Craig levies its own local tax/);
    expect(
      (await addressRates.at({ state: "MT", street: "1 Main St", city: "Helena" }, ON)).rate,
    ).toBe(0);
  });
});
