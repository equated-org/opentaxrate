/**
 * Reading the Streamlined Sales Tax files: lines exactly as the member states
 * publish them (byte-order marks, CRLF endings, unpadded types, open-ended
 * dates) must come out as the rows the lookup indexes.
 *
 * Setup: none; each case is a line copied from a 2026 Q4 state file.
 */
import { describe, expect, it } from "vitest";
import { parseBoundaryLine, parseRateLine } from "../src/ingest/sst-files.js";

describe("rate lines", () => {
  it("reads a rate across a state's padding, marks and open end date", () => {
    expect(
      parseRateLine("﻿50,1,42850,0.01,0.01,0.01,0.01,20230101,29991231\r"),
    ).toEqual({
      type: "01",
      code: "42850",
      rate: 0.01,
      rateInterstate: 0.01,
      foodDrugRate: 0.01,
      foodDrugRateInterstate: 0.01,
      startsOn: "2023-01-01",
      endsOn: "9999-12-31",
    });
  });

  it("keeps a state's lower food and drug rate apart from its general rate", () => {
    expect(
      parseRateLine("47,45,47,0.07,0.07,0.04,0.04,20170701,29991231"),
    ).toMatchObject({ rate: 0.07, rateInterstate: 0.07, foodDrugRate: 0.04, foodDrugRateInterstate: 0.04 });
  });

  it("reads a blank rate column as no rate, not zero", () => {
    expect(
      parseRateLine("29,99,12345-678-000,0.04,,,,20260101,99991231"),
    ).toMatchObject({ rate: 0.04, rateInterstate: null, foodDrugRate: null, foodDrugRateInterstate: null });
  });

  it("drops a rate that ended before the books the service keeps", () => {
    expect(
      parseRateLine("39,00,001,.01000,.01000,.01000,.01000,19910601,20001231"),
    ).toBeNull();
  });
});

describe("boundary lines", () => {
  it("places a street range in its county, city and districts", () => {
    const [row] = parseBoundaryLine(
      "A,20201001,99991231,11040,11040,B,,SPRINGFIELD,PIKE,,AP,417,417,B,CINCINNATI,45246,4118,,,,,,39,39,061,,,,,ST,31000,63,,,,",
    );
    expect(row).toMatchObject({
      kind: "street",
      streetKey: "SPRINGFIELD",
      suffix: "PIKE",
      houseLow: 11040,
      houseHigh: 11040,
      unitLow: "417",
      zip5: "45246",
      area: { county: "061", place: null, districts: "63:31000", reportingCode: null },
    });
  });

  it("keeps the composite SER code a state files the area under", () => {
    const [row] = parseBoundaryLine(
      "A,20160701,99991231,320,320,E,E,PINE,ST,,APT,201,224,B,SEATTLE,98122,0017,,,,,01726,53,53,,63000,,,,",
    );
    expect(row.area).toEqual({ county: null, place: "63000", districts: "", reportingCode: "01726" });
  });

  it("keeps a lettered range's numbers under its grid line", () => {
    const line = (low: string, high: string) =>
      parseBoundaryLine(
        `A,20201001,99991231,${low},${high},B,,OLD 56,RD,,,,,B,MUKWONAGO,53149,,,,,,,55,55,133,,,,,,,,,,`,
      )[0];
    expect(line("W5300", "W5399")).toMatchObject({ houseText: "W#", houseLow: 5300, houseHigh: 5399 });
    expect(line("N77W7201", "N77W7299")).toMatchObject({ houseText: "N77W#", houseLow: 7201, houseHigh: 7299 });
    // A range whose grid line changes along it keeps its first number.
    expect(line("N77W7201", "N78W7299")).toMatchObject({ houseText: "N77W7201", houseLow: null });
  });

  it("splits a ZIP+4 range that crosses ZIPs into one row per ZIP", () => {
    const rows = parseBoundaryLine(
      "4,20050101,29991231,,,,,,,,,,,,,,,46001,0,46003,4999,,18,18,,,,,,,,",
    );
    expect(rows.map((r) => r.kind === "zip4" && [r.zip5, r.plus4Low, r.plus4High])).toEqual([
      ["46001", 0, 9999],
      ["46002", 0, 9999],
      ["46003", 0, 4999],
    ]);
  });
});
