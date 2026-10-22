import { describe, expect, it } from "vitest";
import { matchesAddress } from "../src/geocoding/providers/match.js";

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
