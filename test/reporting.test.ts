import { describe, expect, it } from "vitest";
import { reportingFor, STATE_REPORTING } from "../src/rates/reporting.js";
import { STATES } from "../src/geocoding/providers/match.js";
import type { RatePart } from "../src/rates/types.js";

const part = (kind: RatePart["kind"], code: string, rate: number): RatePart => ({ kind, code, rate });

describe("reporting", () => {
  it("has an agency for every state and DC", () => {
    expect(Object.keys(STATE_REPORTING).sort()).toEqual(Object.keys(STATES).sort());
  });

  it("gives Washington's four-digit location code from the SER column", () => {
    const parts = [part("state", "45:53", 0.065), part("city", "01:63000", 0.0405)];
    expect(reportingFor("WA", "street", parts, "53-000-63000", "01726")).toMatchObject({
      status: "complete",
      agency: { name: "Washington Department of Revenue" },
      codes: [{ scheme: "wa-dor-location", value: "1726", parts: ["45:53", "01:63000"], verified: true }],
      missing: [],
    });
  });

  it("says Washington's code is missing when the address matched several areas", () => {
    const parts = [part("state", "45:53", 0.065), part("city", "01:63000", 0.0405)];
    const reporting = reportingFor("WA", "zip5", parts, null, null)!;
    expect(reporting.status).toBe("partial");
    expect(reporting.codes).toEqual([]);
    expect(reporting.missing[0]).toMatch(/location code/);
  });

  it("needs no local code where there is no local tax", () => {
    expect(reportingFor("CT", "statewide", [part("state", "CT", 0.0635)], "CT", null)).toMatchObject({
      status: "not_needed",
      codes: [],
      missing: [],
    });
  });

  it("names the return's code a state's data doesn't give, and never offers a FIPS code as one", () => {
    const parts = [part("state", "45:39", 0.0575), part("county", "00:061", 0.015)];
    const reporting = reportingFor("OH", "street", parts, "39-061-00000", null)!;
    expect(reporting.status).toBe("partial");
    expect(reporting.codes).toEqual([]);
    expect(reporting.missing).toEqual(["Ohio's UST-1 county code (not the Census county code)"]);
  });

  it("gives Texas's local codes part by part, and leaves the outlet to the seller", () => {
    const parts = [part("state", "45:48", 0.0625), part("city", "x:2227013", 0.01), part("district", "kx:2227013>3227999", 0.01)];
    const reporting = reportingFor("TX", "map", parts, null, null)!;
    expect(reporting.status).toBe("complete");
    expect(reporting.codes.map((c) => c.value)).toEqual(["2227013", "3227999"]);
    expect(reporting.fromAccount[0]).toMatch(/outlet/);
  });

  it("offers another state's SER code as unverified", () => {
    const parts = [part("state", "45:20", 0.065), part("city", "01:00100", 0.01)];
    const reporting = reportingFor("KS", "street", parts, "20-001-00100", "ABIC1")!;
    expect(reporting.status).toBe("partial");
    expect(reporting.codes).toEqual([{ scheme: "sst-ser", label: "Composite SER code", value: "ABIC1", parts: ["01:00100"], verified: false }]);
  });
});
