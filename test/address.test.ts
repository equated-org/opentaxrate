/**
 * Street reading for address rates: an address as an owner or invoice types
 * it must land on the same street key as the state file's own spelling of
 * that street, or the lookup falls back to coarser ZIP data.
 *
 * Setup: none; each case pairs a typed line with a boundary file's
 * (pre-direction, name, type, post-direction) columns, taken from the
 * Streamlined files.
 */
import { describe, expect, it } from "vitest";
import { parseStreet, readFileStreet, streetKeysOf } from "../src/engine/address.js";

describe("a typed street meets the file's spelling of it", () => {
  it.each([
    ["2801 SW 17th Street", ["SW", "17th", "St", ""]],
    ["2802 Southeast 3rd Ave.", ["SE", "3", "AVE", ""]],
    ["3330 W McCollister Drive", ["W", "MCCOLLISTER", "Dr", ""]],
    ["8000 Boomtown-Garson Road", ["", "BOOMTOWN GARSON ", "RD", ""]],
    ["18750 State Route 92", ["", "HIGHWAY 92", "", ""]],
    ["11040 Springfield Pike Apt 417", ["", "SPRINGFIELD", "PIKE", ""]],
    ["1402 194th St SE #4", ["", "194TH", "ST", "SE"]],
    ["100 Saint Johns Blvd", ["", "ST JOHNS", "BLVD", ""]],
    ["5 N St", ["", "N", "ST", ""]],
    ["301 South East Street", ["S", "E", "ST", ""]],
    ["1200 North Avenue", ["", "N", "AVE", ""]],
  ])("%s", (typed, [pre, name, suffix, post]) => {
    const parts = parseStreet(typed)!;
    const file = readFileStreet(pre, name, suffix, post);
    expect(parts.streetKey).toBe(file.streetKey);
    expect(parts.suffix).toBe(file.suffix);
    expect(parts.preDirectional).toBe(file.preDirectional);
    expect(parts.postDirectional).toBe(file.postDirectional);
  });
});

describe("what a street line yields to match on", () => {
  it("keeps the house number for range checks and the unit apart", () => {
    expect(parseStreet("1402 194th St SE, Unit 7")).toMatchObject({
      house: 1402,
      unit: "7",
    });
    expect(parseStreet("123A Main St")).toMatchObject({ house: 123 });
  });

  it("reads a lettered grid number and a PO box", () => {
    expect(parseStreet("W258S7120 Oakdale Rd")).toMatchObject({
      house: null,
      houseText: "W258S7120",
    });
    expect(parseStreet("P.O. Box 1025")).toMatchObject({
      house: 1025,
      streetKey: "POBOX",
    });
  });

  it("refuses a line with no house number", () => {
    expect(parseStreet("Main Street")).toBeNull();
  });

  it("also tries a name led by a street type without it", () => {
    expect(streetKeysOf(parseStreet("10 Avenue B")!)).toEqual(["AVEB", "B"]);
  });
});
