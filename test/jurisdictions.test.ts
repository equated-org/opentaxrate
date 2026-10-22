/**
 * Loading each source's own jurisdiction ids: the Streamlined boundary
 * file's composite SER code onto its area, a source's names and ids into
 * sales_tax_jurisdictions beside the rates, and both replaced with the next
 * load. Runs on a *_test database, as Vermont (Streamlined) and "XJ" (a
 * map-read state no other test uses).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { client, db } from "../src/db/client.js";
import {
  salesTaxAreas,
  salesTaxDataReleases,
  salesTaxJurisdictionRates,
  salesTaxJurisdictions,
  salesTaxShapes,
  salesTaxStreetRanges,
  salesTaxZipRanges,
} from "../src/db/schema.js";
import { loadGeoState, loadSstState } from "../src/ingest/load.js";

const STATES = ["VT", "XJ"];

async function clear() {
  for (const table of [
    salesTaxStreetRanges,
    salesTaxZipRanges,
    salesTaxJurisdictionRates,
    salesTaxJurisdictions,
    salesTaxAreas,
    salesTaxShapes,
    salesTaxDataReleases,
  ])
    await db.delete(table).where(inArray(table.state, STATES));
}

beforeAll(async () => {
  const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (!name.endsWith("_test"))
    throw new Error(`These tests replace Vermont's rows; run them on a *_test database, not ${name}.`);
  await clear();
});

afterAll(async () => {
  await clear();
  await client.end();
});

const RATES = ["50,45,50,.06,.06,.0,.0,20200101,99991231", "50,01,10675,.01,.01,.0,.0,20200101,99991231"];
const street = (ser: string, place: string) =>
  `A,20200101,99991231,100,198,B,,MAIN,ST,,,,,,BURLINGTON,05401,,,,,,${ser},50,50,007,${place},,,,`;

describe("loading a Streamlined state", () => {
  it("keys areas by their SER code and stores the jurisdictions given", async () => {
    const counts = await loadSstState({
      state: "VT",
      rates: { name: "VTR-fixture", lines: RATES },
      boundaries: { name: "VTB-fixture", lines: [street("01726", "10675"), street("", "10675"), street("01726", "10675")] },
      jurisdictions: () => [{ type: "01", code: "10675", name: "BURLINGTON", ids: { "Town Code": "035" } }],
    });
    expect(counts).toMatchObject({ rates: 2, jurisdictions: 1, streets: 3, areas: 2 });

    const areas = await db.select().from(salesTaxAreas).where(inArray(salesTaxAreas.state, ["VT"]));
    expect(areas.map((a) => a.ids).sort((a, b) => Object.keys(a).length - Object.keys(b).length)).toEqual([
      {},
      { "Composite SER Code": "01726" },
    ]);
    expect(await db.select().from(salesTaxJurisdictions).where(inArray(salesTaxJurisdictions.state, ["VT"]))).toEqual([
      { state: "VT", type: "01", code: "10675", name: "BURLINGTON", ids: { "Town Code": "035" }, file: "VTR-fixture" },
    ]);
  });

  it("drops the last load's jurisdictions when the files give none", async () => {
    await loadSstState({
      state: "VT",
      rates: { name: "VTR-fixture-2", lines: RATES },
      boundaries: { name: "VTB-fixture-2", lines: [street("", "10675")] },
    });
    expect(await db.select().from(salesTaxJurisdictions).where(inArray(salesTaxJurisdictions.state, ["VT"]))).toEqual([]);
  });
});

describe("loading a map-read state", () => {
  const data = (name: string | null) => ({
    rates: [
      { type: "45", code: "99", rate: 0.04, startsOn: "2020-01-01", endsOn: "9999-12-31" },
      { type: "01", code: "51000", rate: 0.035, startsOn: "2020-01-01", endsOn: "9999-12-31" },
    ],
    jurisdictions: name
      ? [{ type: "01", code: "51000", name, ids: { "Locality Code": "9454", Administered: "SELF" } }]
      : [],
    shapes: [],
    files: { rates: "taxrates.csv" },
  });

  it("stores each jurisdiction's name and ids with the rates, verbatim", async () => {
    expect(await loadGeoState("XJ", data("MONTGOMERY"))).toMatchObject({ rates: 2, jurisdictions: 1 });
    const [row] = await db.select().from(salesTaxJurisdictions).where(inArray(salesTaxJurisdictions.state, ["XJ"]));
    expect(row).toEqual({
      state: "XJ",
      type: "01",
      code: "51000",
      name: "MONTGOMERY",
      ids: { "Locality Code": "9454", Administered: "SELF" },
      file: "taxrates.csv",
    });
  });

  it("replaces them on the next load", async () => {
    await loadGeoState("XJ", data(null));
    expect(await db.select().from(salesTaxJurisdictions).where(inArray(salesTaxJurisdictions.state, ["XJ"]))).toEqual([]);
  });
});
