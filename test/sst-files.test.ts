/**
 * Reading the Streamlined Sales Tax files: lines exactly as the member states
 * publish them (byte-order marks, CRLF endings, unpadded types, open-ended
 * dates) must come out as the rows the lookup indexes.
 *
 * Setup: none; each case is a line copied from a 2026 Q4 state file.
 */
import { describe, expect, it } from "vitest";
import { parseBoundaryLine, parseRateLine } from "../src/engine/sst-files.js";

describe("rate lines", () => {
  it("reads a rate across a state's padding, marks and open end date", () => {
    expect(
      parseRateLine("﻿50,1,42850,0.01,0.01,0.01,0.01,20230101,29991231\r"),
    ).toEqual({
      type: "01",
      code: "42850",
      rate: 0.01,
      startsOn: "2023-01-01",
      endsOn: "9999-12-31",
    });
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
      area: { county: "061", place: null, districts: "63:31000" },
    });
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
