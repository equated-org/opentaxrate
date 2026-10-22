import { describe, expect, it } from "vitest";
import { parseStreet, streetVariantsOf } from "../src/address.js";
import { matchesAddress } from "../src/geocoding/providers/match.js";

/** Whether a typed line can find the filed street: the same key and
 *  directions, under some reading of it. */
const finds = (typed: string, filed: string) => {
  const f = parseStreet(filed)!;
  return streetVariantsOf(parseStreet(typed)!).some(
    (v) => v.streetKey === f.streetKey && v.preDirectional === f.preDirectional && v.postDirectional === f.postDirectional,
  );
};
const found = (house: string, street: string) => ({ house, street, city: "Town", state: "CO", zip: "80000", country: "US" });
const typed = (street: string) => ({ street, city: "Town", state: "CO", zip: "80000" });

describe("an address typed the way people type it", () => {
  it("reads Queens and Hawaii hyphenated house numbers", () => {
    expect(parseStreet("249-20 37 Avenue")).toMatchObject({ houseText: "249-20", house: 249, streetKey: "37", suffix: "AVE" });
    expect(parseStreet("94-1234 Kamehameha Hwy")).toMatchObject({ houseText: "94-1234", suffix: "HWY" });
  });

  it("finds a street whose name ends in a type word, typed without its own type", () => {
    expect(finds("10522 Ridge Park", "10522 Ridge Park Drive")).toBe(true);
    expect(finds("300 N Harbor", "300 N Harbor Drive")).toBe(true);
    expect(finds("5261 Little Tree", "5261 Little Tree Street")).toBe(true);
  });

  it("passes the geocoder match the same way, and still not with another type or direction", () => {
    expect(matchesAddress(typed("10522 Ridge Park"), found("10522", "Ridge Park Drive"))).toBe(true);
    expect(matchesAddress(typed("300 N Harbor"), found("300", "N Harbor Drive"))).toBe(true);
    expect(matchesAddress(typed("10522 Ridge Park Ct"), found("10522", "Ridge Park Drive"))).toBe(false);
    expect(matchesAddress(typed("300 S Harbor"), found("300", "N Harbor Drive"))).toBe(false);
  });

  it("doesn't read a state code or a street name's own word as a unit", () => {
    expect(parseStreet("2386 FL 73")).toMatchObject({ unit: null, alternates: expect.arrayContaining([expect.objectContaining({ streetKey: "HWY73" })]) });
    expect(parseStreet("2162 Sand Lot Court")).toMatchObject({ streetKey: "SANDLOT", suffix: "CT", unit: null });
    expect(parseStreet("33750 Post Office Drive Apt 4")).toMatchObject({ streetKey: "POSTOFFICE", suffix: "DR", unit: "4" });
    expect(parseStreet("123 Main St Fl 2")).toMatchObject({ streetKey: "MAIN", unit: "2" });
  });

  it("matches a highway however it's written, by the address's own state's code only", () => {
    const m = (state: string, typedLine: string, house: string, street: string) =>
      matchesAddress({ street: typedLine, city: "X", state, zip: "00000" }, { house, street, city: "X", state, zip: "00000", country: "US" });
    expect(m("WI", "4107 WI 91", "4107", "State Road 91")).toBe(true);
    expect(m("WY", "780 WY 387", "780", "State Highway 387")).toBe(true);
    expect(m("NE", "80721 NE 281", "80721", "Highway 281")).toBe(true);
    expect(m("VT", "4923 VT 14", "4923", "VT Route 14")).toBe(true);
    expect(m("ID", "613 US 95", "613", "United States Highway 95")).toBe(true);
    expect(m("WI", "4107 IA 91", "4107", "State Road 91")).toBe(false);
    expect(m("WI", "4107 WI 91", "4107", "State Road 92")).toBe(false);
    expect(m("NE", "100 NE 5th St", "100", "5th St")).toBe(false);
  });

  it("matches a street typed without a type word the found one has anywhere, and nothing looser", () => {
    expect(matchesAddress(typed("115 Forest Extension"), found("115", "Forest Avenue Extension"))).toBe(true);
    expect(matchesAddress(typed("955 River 2"), found("955", "River Loop 2"))).toBe(true);
    expect(matchesAddress(typed("218 Shoreline Bear Lake Sands"), found("218", "Shoreline Road Bear Lake Sands"))).toBe(true);
    expect(matchesAddress(typed("115 Forest Ave"), found("115", "Forest Avenue Extension"))).toBe(false);
    expect(matchesAddress(typed("88 Oak"), found("88", "Oak Ridge Road"))).toBe(false);
    expect(matchesAddress(typed("186 Byers Ln"), found("186", "Myers Ln"))).toBe(false);
  });

  it("keeps a fractional house number after a unit typed before it", () => {
    expect(matchesAddress(typed("Apt 4, 3281 1/2 M Street NW"), found("3281 1/2", "M Street NW"))).toBe(true);
    expect(matchesAddress(typed("Apt 4, 3281 M Street NW"), found("3281 1/2", "M Street NW"))).toBe(false);
  });
});

