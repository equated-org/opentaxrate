import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesAddress } from "../src/geocoding/providers/match.js";
import { insideTypedArea } from "../src/geocoding/locator.js";

const parker = { street: "42725 London", city: "Parker", state: "CO", zip: "80138" };
const found = (street: string) => ({ house: "42725", street, city: "Parker", state: "CO", zip: "80138", country: "US" });

describe("a geocoder's address", () => {
  it("matches a street typed without its type, but not one typed with another type or direction", () => {
    expect(matchesAddress(parker, found("London Dr"))).toBe(true);
    expect(matchesAddress({ ...parker, street: "42725 London Dr" }, found("London Dr"))).toBe(true);
    expect(matchesAddress({ ...parker, street: "42725 London Ct" }, found("London Dr"))).toBe(false);
    expect(matchesAddress(parker, found("N London Dr"))).toBe(false);
  });
});

describe("a lone dataset's point, where the typed town has no outline loaded", () => {
  const hatfield = { street: "2333 Welsh Road", city: "Hatfield", state: "PA", zip: "19440" };
  const point = { lon: -75.31669, lat: 40.26265, accuracy: "point" as const };
  const census = (geographies: object) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ result: { geographies } }))));
  afterEach(() => vi.unstubAllGlobals());

  it("is plausible in the typed ZIP's area, or a Census place or township of the typed name", async () => {
    census({ "2020 Census ZIP Code Tabulation Areas": [{ ZCTA5: "19446" }], "County Subdivisions": [{ NAME: "Hatfield township" }] });
    expect(await insideTypedArea(hatfield, point)).toBe(true);
    census({ "2020 Census ZIP Code Tabulation Areas": [{ ZCTA5: "19440" }], "County Subdivisions": [{ NAME: "Towamencin township" }] });
    expect(await insideTypedArea(hatfield, point)).toBe(true);
    census({ "2020 Census ZIP Code Tabulation Areas": [{ ZCTA5: "19446" }], "County Subdivisions": [{ NAME: "Towamencin township" }] });
    expect(await insideTypedArea(hatfield, point)).toBe(false);
  });
});
