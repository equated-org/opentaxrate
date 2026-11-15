/**
 * An Alabama-style police jurisdiction: an unincorporated address within a
 * city's reach is refused; that reach is three miles, or a mile and a half
 * for a city with a pjnear marker (a town under 6,000). Runs on a *_test
 * database, as "XP" (a map-read state no other test uses).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { client, db } from "../src/db/client.js";
import { salesTaxDataReleases, salesTaxJurisdictionRates, salesTaxJurisdictions, salesTaxShapes } from "../src/db/schema.js";
import { loadGeoState } from "../src/ingest/load.js";
import { geoRateAt } from "../src/rates/map.js";
import { pjNear } from "../src/ingest/states/alabama.js";

const square = (x0: number, y0: number, x1: number, y1: number) => ({
  rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] as Array<Array<[number, number]>>,
  bbox: [x0, y0, x1, y1] as [number, number, number, number],
});
const rate = (type: string, code: string, rate: number) => ({ type, code, rate, startsOn: "2020-01-01", endsOn: "9999-12-31" });
// One degree of longitude at the equator is about 111 km.
const east = (metres: number, x0: number) => ({ lon: x0 + metres / 111_320, lat: 0.5, accuracy: "rooftop" as const });

async function clear() {
  for (const table of [salesTaxJurisdictionRates, salesTaxJurisdictions, salesTaxShapes, salesTaxDataReleases])
    await db.delete(table).where(inArray(table.state, ["XP"]));
}

beforeAll(async () => {
  const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (!name.endsWith("_test"))
    throw new Error(`These tests replace rows; run them on a *_test database, not ${name}.`);
  await clear();
  // Big Town (west) reaches three miles; Small Town (east) has a marker.
  await loadGeoState("XP", {
    rates: [
      rate("45", "98", 0.04),
      rate("00", "001", 0.01),
      rate("01", "00001", 0.03),
      rate("pj", "00001", 0.015),
      rate("01", "00002", 0.04),
      rate("pj", "00002", 0.02),
      rate("pjnear", "00002", 0),
    ],
    jurisdictions: [],
    shapes: [
      { kind: "county", fips: "001", name: "One", ...square(0, 0, 3, 1) },
      { kind: "place", fips: "00001", name: "Big Town", ...square(0.1, 0.4, 0.2, 0.6) },
      { kind: "place", fips: "00002", name: "Small Town", ...square(2.8, 0.4, 2.9, 0.6) },
    ],
    files: { rates: "rates-fixture", boundaries: "outlines-fixture" },
  });
});

afterAll(async () => {
  await clear();
  await client.end();
});

describe("a police jurisdiction's reach", () => {
  it("refuses within three miles of a city without a marker", async () => {
    await expect(geoRateAt("XP", east(3_700, 0.2), "2026-11-14")).rejects.toThrow(/outside Big Town but within three miles/);
  });

  it("rates past three miles of a city without a marker", async () => {
    expect((await geoRateAt("XP", east(5_000, 0.2), "2026-11-14")).rate).toBe(0.05);
  });

  it("refuses within a mile and a half of a city with a marker", async () => {
    await expect(geoRateAt("XP", { ...east(2_000, 2.9) }, "2026-11-14")).rejects.toThrow(/outside Small Town but within a mile and a half/);
  });

  it("rates past a mile and a half of a city with a marker", async () => {
    // 781 Eudon Best Road, Ashford, AL lies 3,707 m outside the town.
    expect((await geoRateAt("XP", { ...east(-3_700, 2.8) }, "2026-11-14")).rate).toBe(0.05);
  });

  it("counts the geocode's margin against the reach", async () => {
    // 2,420 m: past 2,414 m, but not past it plus a rooftop's 15 m.
    await expect(geoRateAt("XP", east(2_420, 2.9), "2026-11-14")).rejects.toThrow(/a mile and a half/);
  });
});

describe("pjNear", () => {
  const head2010 = "SUMLEV,STATE,COUNTY,PLACE,COUSUB,CONCIT,PRIMGEO_FLAG,FUNCSTAT,NAME,STNAME,CENSUS2010POP";
  const head2020 = "SUMLEV,STATE,COUNTY,PLACE,COUSUB,CONCIT,PRIMGEO_FLAG,FUNCSTAT,NAME,STNAME,ESTIMATESBASE2020";
  // 300 filler towns, so the files pass the completeness check.
  const filler = () => Array.from({ length: 300 }, (_, i) => `162,01,000,9${String(i).padStart(4, "0")},00000,00000,0,A,Filler ${i} town,Alabama,100`);
  const file = (head: string, rows: string[]) => [head, ...rows, ...filler()].join("\n");

  it("marks a place under the threshold in both counts, and only a place", () => {
    const rows = pjNear(
      file(head2010, [
        "162,01,000,02836,00000,00000,0,A,Ashford town,Alabama,2148",
        "157,01,069,02836,00000,00000,1,A,Ashford town,Alabama,2148",
        "162,01,000,11111,00000,00000,0,A,Grew city,Alabama,5000",
        "162,01,000,22222,00000,00000,0,A,Big city,Alabama,9000",
        "162,01,000,33333,00000,00000,0,F,Gone town,Alabama,300",
        '162,01,000,55555,00000,00000,0,A,"Comma, Small town",Alabama,900',
      ]),
      file(head2020, [
        "162,01,000,02836,00000,00000,0,A,Ashford city,Alabama,2253",
        "162,01,000,11111,00000,00000,0,A,Grew city,Alabama,6100",
        "162,01,000,22222,00000,00000,0,A,Big city,Alabama,8000",
        "162,01,000,44444,00000,00000,0,A,New town,Alabama,400",
        '162,01,000,55555,00000,00000,0,A,"Comma, Small town",Alabama,950',
      ]),
    );
    const codes = rows.map((r) => r.name);
    expect(codes).toContain("0102836");
    expect(codes).not.toContain("0111111"); // could have adopted three miles
    expect(codes).not.toContain("0122222");
    expect(codes).not.toContain("0144444"); // no 2010 count
    expect(codes).toContain("0155555"); // a quoted name's comma doesn't shift its count
    expect(rows.find((r) => r.name === "0102836")).toMatchObject({ type: "pjnear", rate: 0 });
  });

  it("stops on a file missing its population column", () => {
    expect(() => pjNear(head2020, head2020)).toThrow(/CENSUS2010POP/);
  });
});
