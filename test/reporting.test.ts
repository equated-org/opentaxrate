import { describe, expect, it } from "vitest";
import { reportingFor, STATE_REPORTING } from "../src/rates/reporting.js";
import { STATES } from "../src/geocoding/providers/match.js";
import { LocationIdsSchema } from "../src/api-schema.js";
import { washingtonLocationIds } from "../src/rates/index.js";

describe("reporting", () => {
  it("has an agency for every state and DC", () => {
    expect(Object.keys(STATE_REPORTING).sort()).toEqual(Object.keys(STATES).sort());
  });

  it("gives the state's agency, return and filing notes, and no codes", () => {
    const reporting = reportingFor("AL")!;
    expect(reporting).toMatchObject({
      agency: { name: "Alabama Department of Revenue" },
      form: "Sales tax return (My Alabama Taxes)",
    });
    expect(Object.keys(reporting).sort()).toEqual(["agency", "form", "locationKey", "notes"]);
    expect(reporting.locationKey).toBeNull();
    expect(reporting.notes[0]).toMatch(/collect their own tax/);
  });

  it("names the locationIds key a return files under, one the API spec lists", () => {
    expect(reportingFor("WA")!.locationKey).toBe("Location Code");
    expect(reportingFor("CA")!.locationKey).toBe("Local Tax Area Code");
    expect(reportingFor("MO")!.locationKey).toBe("Jurisdiction Code");
    for (const info of Object.values(STATE_REPORTING))
      if (info.locationKey) expect(Object.keys(LocationIdsSchema.shape)).toContain(info.locationKey);
  });

  it("gives Washington's four-digit DOR location code beside the padded SER code", () => {
    expect(washingtonLocationIds({ "Composite SER Code": "01726" })).toEqual({ "Composite SER Code": "01726", "Location Code": "1726" });
    expect(washingtonLocationIds({ "Composite SER Code": "00101" })["Location Code"]).toBe("0101");
    expect(washingtonLocationIds({})).toEqual({});
  });

  it("has nothing for a state it doesn't know", () => {
    expect(reportingFor("ZZ")).toBeNull();
  });
});
