/**
 * Standardizing an address: only one confident, in-state Geocodio match with
 * exactly one ZIP+4 is used, so a vague or doubled answer is no answer.
 *
 * Setup: none; response bodies shaped like Geocodio's geocode with the zip4
 * field (v2, checked live on 2026-10-21).
 */
import { describe, expect, it } from "vitest";
import { fromGeocodio } from "../src/standardize/index.js";

const result = (over: Record<string, unknown> = {}, zip4: Record<string, unknown> = { plus4: ["2310"], exact_match: true }) => ({
  accuracy: 1,
  accuracy_type: "rooftop",
  address_components: { number: "350", predirectional: "N", street: "State", suffix: "St", formatted_street: "N State St", city: "Salt Lake City", county: "Salt Lake County", state_province: "UT", postal_code: "84114", country: "US" },
  fields: { zip4 },
  ...over,
});

describe("a Geocodio answer", () => {
  it("gives the street as the Postal Service writes it and its ZIP+4", () => {
    expect(fromGeocodio({ results: [result()] }, "UT")).toEqual({
      street: "350 N State St",
      city: "Salt Lake City",
      state: "UT",
      zip5: "84114",
      plus4: "2310",
      exact: true,
      source: "Geocodio",
    });
  });

  it("reads v1's names for the state and ZIP too", () => {
    const v1 = result({ address_components: { number: "350", formatted_street: "N State St", city: "Salt Lake City", state: "UT", zip: "84114" } });
    expect(fromGeocodio({ results: [v1] }, "UT")).toMatchObject({ zip5: "84114", plus4: "2310" });
  });

  it("keeps a building's ZIP+4 when no unit was given, marked inexact", () => {
    expect(fromGeocodio({ results: [result({}, { plus4: ["4799"], exact_match: false })] }, "UT")).toMatchObject({
      plus4: "4799",
      exact: false,
    });
  });

  it("keeps the ZIP and street of an address with no ZIP+4", () => {
    expect(fromGeocodio({ results: [result({}, {})] }, "UT")).toMatchObject({ zip5: "84114", plus4: null });
  });

  it.each([
    ["two matches", { results: [result(), result()] }],
    ["a ZIP-level match", { results: [result({ accuracy_type: "place" })] }],
    ["a weak match", { results: [result({ accuracy: 0.6 })] }],
    ["another state", { results: [result({ address_components: { number: "350", formatted_street: "N State St", state_province: "ID", postal_code: "83201" } })] }],
    ["several ZIP+4s", { results: [result({}, { plus4: ["2310", "2311"] })] }],
    ["nothing", {}],
  ])("is no answer with %s", (_, body) => {
    expect(fromGeocodio(body, "UT")).toBeNull();
  });
});
