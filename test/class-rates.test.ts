/**
 * Class-rate readers, from archived files and no database: Utah's rate
 * charts, read for every archived quarter so a new quarter's load keeps the
 * earlier ones, and the same load twice gives the same rows; Illinois's
 * grocery files, where an override flag keeps both rates as cases.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { illinoisClasses } from "../src/ingest/states/illinois.js";
import { utahClasses } from "../src/ingest/states/utah.js";

const CHART = path.join(process.cwd(), "artifacts/sources/files.tax.utah.gov/tax/salestax/rate/26q4simple.xlsx");

describe.skipIf(!existsSync(CHART))("Utah's restaurant rates", () => {
  const saved = process.env.OPENTAXRATE_DOWNLOAD_DIR;
  beforeAll(() => {
    const root = mkdtempSync(path.join(tmpdir(), "otr-ut-"));
    const dir = path.join(root, "sources/files.tax.utah.gov/tax/salestax/rate");
    mkdirSync(dir, { recursive: true });
    copyFileSync(CHART, path.join(dir, "26q4simple.xlsx"));
    // The next quarter's chart: the same rates, in effect from January 1, 2027.
    const files = unzipSync(readFileSync(CHART));
    for (const name of ["xl/sharedStrings.xml", "xl/worksheets/sheet2.xml"]) files[name] = strToU8(strFromU8(files[name]).replace("October 1, 2026", "January 1, 2027"));
    writeFileSync(path.join(dir, "27q1simple.xlsx"), zipSync(files));
    process.env.OPENTAXRATE_DOWNLOAD_DIR = root;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.OPENTAXRATE_DOWNLOAD_DIR;
    else process.env.OPENTAXRATE_DOWNLOAD_DIR = saved;
  });

  const rates = [
    { type: "45", code: "49", rate: 0.0485, startsOn: "2020-01-01", endsOn: "9999-12-31" },
    { type: "00", code: "035", rate: 0.026, startsOn: "2020-01-01", endsOn: "9999-12-31" },
    { type: "01", code: "67000", rate: 0.01, startsOn: "2020-01-01", endsOn: "9999-12-31" },
  ];
  const county = (rows: Awaited<ReturnType<typeof utahClasses.fetch>>["rows"]) => rows.filter((r) => r.code === "035").map((r) => [r.startsOn, r.endsOn, r.rate]);

  it("keeps the earlier quarter when the next is loaded, and reloads the same rows", async () => {
    const q4 = await utahClasses.fetch(undefined, { rates, ratesFile: "UTR2026Q4AUG11" });
    expect(county(q4.rows)).toEqual([["2026-10-01", "2026-12-31", 0.036]]);
    const q1 = await utahClasses.fetch(undefined, { rates, ratesFile: "UTR2027Q1NOV10" });
    expect(county(q1.rows)).toEqual([["2026-10-01", "2026-12-31", 0.036], ["2027-01-01", "2027-03-31", 0.036]]);
    // The city's restaurant rate is its general rate, the tax being the county's.
    expect(q1.rows.filter((r) => r.code === "67000").map((r) => r.rate)).toEqual([0.01, 0.01]);
    expect((await utahClasses.fetch(undefined, { rates, ratesFile: "UTR2027Q1NOV10" })).rows).toEqual(q1.rows);
  });
});

describe("Illinois's grocery rates", () => {
  // IDOR's layout: location, name, county, then the current period's day,
  // high rate, low rate and override flag, then the prior period's.
  const line = (id: string, name: string, county: string, high: string, low: string, flag: string) =>
    `${id}${name.padEnd(25)}${county.padEnd(25)}20260101${high}${low}${flag}19900101202512310000000000${flag}`;
  const saved = process.env.OPENTAXRATE_DOWNLOAD_DIR;
  let dir = "";
  beforeAll(() => {
    const root = mkdtempSync(path.join(tmpdir(), "otr-il-"));
    dir = path.join(root, "files");
    mkdirSync(dir);
    const text = [line("060-5000-2", "MADISON COUNTY", "MADISON", "00250", "00000", "Y"), line("016-0001-1", "CHICAGO", "COOK", "01250", "01250", "N")].join("\r\n");
    for (const edition of ["current", "prior-070126", "prior-010126"]) writeFileSync(path.join(dir, `grocerymache-${edition}.txt`), text);
    process.env.OPENTAXRATE_DOWNLOAD_DIR = root;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.OPENTAXRATE_DOWNLOAD_DIR;
    else process.env.OPENTAXRATE_DOWNLOAD_DIR = saved;
  });

  it("keeps a flagged location's high and low rates as its cases, and a plain one's single rate", async () => {
    const { rows } = await illinoisClasses.fetch(dir, { rates: [], ratesFile: null });
    expect(rows.filter((r) => r.code === "0605000").map((r) => [r.rate, r.appliesWhen?.slice(0, 26), r.startsOn])).toEqual([
      [0.0025, "The retailer is liable for", "2026-01-01"],
      [0, "The retailer isn't liable ", "2026-01-01"],
    ]);
    expect(rows.filter((r) => r.code === "0160001").map((r) => [r.rate, r.appliesWhen])).toEqual([[0.0125, undefined]]);
  });
});
