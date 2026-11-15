import { describe, expect, it } from "vitest";
import { matchesAddress } from "../src/geocoding/providers/match.js";
import { PARAMS } from "../src/params.js";
import { parseStreet } from "../src/address.js";

/** The ZIP's streets, by key: Main St, Chestnut St and Myers/Byers Ln are real there. */
const zipStreets = new Set(["MAIN", "CHESTNUT", "PEARL", "MYERS", "BYERS", "FRST", "OAK"]);
const typed = (street: string, extra: object = {}) => ({ street, city: "Town", state: "CO", zip: "80000", zipStreets, ...extra });
const found = (house: string, street: string, zip = "80000") => ({ house, street, city: "Town", state: "CO", zip, country: "US" });

describe("a typed street one letter off the geocoder's", () => {
  it("is a typo when the ZIP has the found street and not the typed one", () => {
    expect(matchesAddress(typed("1200 Chestnot St"), found("1200", "Chestnut St"))).toBe(true);
    expect(matchesAddress(typed("1200 Mian St"), found("1200", "Main St"))).toBe(false); // under five letters
    expect(matchesAddress(typed("1200 Chestnutt Street Apt 4"), found("1200", "Chestnut St"))).toBe(true);
    expect(matchesAddress(typed("88 Forset Ln"), found("88", "Forest Ln"))).toBe(true);
    expect(matchesAddress(typed("24 Peal St"), found("24", "Pearl St"))).toBe(true); // a letter dropped from five
  });

  it("is another street when both are real there, whatever the geocoder says", () => {
    expect(matchesAddress(typed("186 Byers Ln"), found("186", "Myers Ln"))).toBe(false);
  });

  it("isn't taken without the ZIP's list, in another ZIP, or with another house, type or direction", () => {
    expect(matchesAddress(typed("1200 Mian St", { zipStreets: null }), found("1200", "Main St"))).toBe(false);
    expect(matchesAddress(typed("1200 Mian St"), found("1200", "Main St", "80001"))).toBe(false);
    expect(matchesAddress(typed("1201 Mian St"), found("1200", "Main St"))).toBe(false);
    expect(matchesAddress(typed("1200 Mian Ave"), found("1200", "Main St"))).toBe(false);
    expect(matchesAddress(typed("1200 N Mian St"), found("1200", "S Main St"))).toBe(false);
  });

  it("isn't a typo two letters off, or of a real name under five letters", () => {
    expect(matchesAddress(typed("1200 Maon Sx"), found("1200", "Main St"))).toBe(false);
    expect(matchesAddress(typed("12 Oka Ln"), found("12", "Oak Ln"))).toBe(false);
  });
});

describe("a typed street missing a direction, or with one too many (directionFromZipStreets)", () => {
  // Thacker Ave is only N Thacker in the ZIP; Westmont Ave is both E and W;
  // 29th Street Rd has no direction; Fairmont Pkwy is both plain and W.
  const zipDirections = new Map([
    ["THACKER", new Set(["N|"])],
    ["WESTMONT", new Set(["E|", "W|"])],
    ["29ST", new Set(["|"])],
    ["FAIRMONT", new Set(["|", "W|"])],
  ]);
  const withDirections = (street: string, extra: object = {}) => typed(street, { zipDirections, ...extra });
  const withSetting = <T>(value: boolean, f: () => T) => {
    const given = PARAMS.directionFromZipStreets;
    PARAMS.directionFromZipStreets = value;
    try { return f(); } finally { PARAMS.directionFromZipStreets = given; }
  };
  const on = <T>(f: () => T) => withSetting(true, f);
  const key = (street: string) => parseStreet(`1 ${street}`)!.streetKey;

  it("keys the fixture's streets as the matcher does", () => {
    expect([...zipDirections.keys()]).toEqual([key("Thacker Ave"), key("Westmont Ave"), key("29th Street Rd"), key("Fairmont Pkwy")]);
  });

  it("takes the ZIP's only street by that name", () => {
    on(() => {
      expect(matchesAddress(withDirections("301 Thacker Avenue"), found("301", "N Thacker Ave"))).toBe(true);
      expect(matchesAddress(withDirections("6700 W 29th Street Road"), found("6700", "29th Street Rd"))).toBe(true);
    });
  });

  it("refuses where the ZIP has it with more than one direction, or the directions conflict", () => {
    on(() => {
      expect(matchesAddress(withDirections("137 Westmont Avenue"), found("137", "E Westmont Ave"))).toBe(false);
      expect(matchesAddress(withDirections("10001 E Fairmont Parkway"), found("10001", "Fairmont Pkwy"))).toBe(false);
      expect(matchesAddress(withDirections("301 S Thacker Avenue"), found("301", "N Thacker Ave"))).toBe(false);
    });
  });

  it("refuses without the ZIP's directions, in another ZIP, or with the setting off", () => {
    on(() => {
      expect(matchesAddress(withDirections("301 Thacker Avenue", { zipDirections: null }), found("301", "N Thacker Ave"))).toBe(false);
      expect(matchesAddress(withDirections("301 Thacker Avenue", { city: "Elsewhere" }), found("301", "N Thacker Ave", "80001"))).toBe(false);
    });
    withSetting(false, () => expect(matchesAddress(withDirections("301 Thacker Avenue"), found("301", "N Thacker Ave"))).toBe(false));
  });
});
