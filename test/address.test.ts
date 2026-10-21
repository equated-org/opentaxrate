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
import {
  letteredHouse,
  parseStreet,
  readFileStreet,
  streetKeysOf,
  streetVariantsOf,
} from "../src/address.js";

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
    // State-named highways, typed and filed every which way.
    ["4100 Ohio Highway 29", ["", "HIGHWAY 29", "", ""]],
    ["100 Vermont Route 100", ["", "VT ROUTE 100", "", ""]],
    ["54 North Carolina Hwy 54", ["N", "HWY 54", "", ""]],
    ["2 W Virginia Rte 2", ["W", "STATE ROUTE 2", "", ""]],
    ["39781 South Dakota Highway 34", ["S", "SD HIGHWAY 34", "", ""]],
    ["5 Washington Highway 20", ["", "SR 20", "", ""]],
    // Wisconsin's trunk highways.
    ["W5350 CTH M", ["", "COUNTY HIGHWAY M", "", ""]],
    ["300 STH 19", ["", "STATE HIGHWAY 19", "", ""]],
    // A file that repeats the type or direction in the name.
    ["214 Spruce St", ["", "SPRUCE ST", "ST", ""]],
    ["10 N Edmonds Ave", ["N", "N EDMONDS", "AVE", ""]],
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

  it("reads Arkansas's \"AR 33 Hwy\" as Highway 33", () => {
    expect(parseStreet("720 Highway 33")!.streetKey).toBe(readFileStreet("", "AR 33", "HWY", "").streetKey);
  });

  it("leaves a road named for a state alone when it is no highway", () => {
    expect(parseStreet("8 Georgia Ave")).toMatchObject({ streetKey: "GEORGIA", suffix: "AVE" });
    // A bare code before a number is a county road ("NC 8068", Newton
    // County, Arkansas), and "Co Hwy 5" is a county highway.
    expect(parseStreet("6 NC 8068")!.streetKey).toBe("NC8068");
    expect(parseStreet("9 Co Hwy 5")!.streetKey).toBe("CR5");
  });
});

describe("lettered grid house numbers", () => {
  it("joins a grid number typed with a space", () => {
    expect(parseStreet("N78 W7008 Oak St")).toMatchObject({
      house: null,
      houseText: "N78W7008",
      streetKey: "OAK",
    });
  });

  it("splits a lettered number into its grid line and number", () => {
    expect(letteredHouse("W5350")).toEqual({ line: "W#", number: 5350 });
    expect(letteredHouse("N78W7008")).toEqual({ line: "N78W#", number: 7008 });
    expect(letteredHouse("E0250")).toEqual({ line: "E#", number: 250 });
    expect(letteredHouse("5350")).toBeNull();
    expect(letteredHouse("W5350A")).toBeNull();
  });

  it("also tries a one-letter grid number as a direction and a number", () => {
    const last = streetVariantsOf(parseStreet("E10546 Old 56 Rd")!).at(-1);
    expect(last).toMatchObject({ house: 10546, houseText: "10546", preDirectional: "E", streetKey: "OLD56" });
  });
});

describe("other spellings a file may use", () => {
  const keys = (line: string) =>
    streetVariantsOf(parseStreet(line)!).map((v) => [v.streetKey, v.suffix]);

  it("runs a name's words together unabbreviated", () => {
    expect(keys("905 Oak Hollow Rd")).toContainEqual(["OAKHOLLOW", "RD"]);
  });

  it("keeps a last word read as the type in the name", () => {
    expect(keys("102 Oak Ridge")).toContainEqual(["OAKRIDGE", ""]);
    expect(keys("12808 W 87th St")).toContainEqual(["87ST", ""]);
  });

  it("tries a lettered route and a county's named road as filed", () => {
    expect(keys("2522 K 18 Hwy")).toContainEqual(["HWYK18", "HWY"]);
    expect(keys("17 Columbia Road 161")).toContainEqual(["COLUMBIA161", ""]);
  });

  it("tries the street's own spelling first", () => {
    expect(keys("905 Oak Hollow Rd")[0]).toEqual(["OAKHOLW", "RD"]);
  });
});
