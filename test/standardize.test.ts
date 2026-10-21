/**
 * Standardizing an address: only one confident, in-state Geocodio match with
 * exactly one ZIP+4 is used, so a vague or doubled answer is no answer.
 *
 * Setup: none; response bodies shaped like Geocodio's geocode with the zip4
 * field (v1.7).
 */
import { describe, expect, it } from "vitest";
import { fromGeocodio } from "../src/standardize/index.js";

const result = (over: Record<string, unknown> = {}, zip4: Record<string, unknown> = { plus4: ["2310"], exact_match: true }) => ({
  accuracy: 1,
  accuracy_type: "rooftop",
  address_components: { number: "350", formatted_street: "N State St", city: "Salt Lake City", state: "UT", zip: "84114" },
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
      source: "Geocodio",
    });
  });

  it.each([
    ["two matches", { results: [result(), result()] }],
    ["a ZIP-level match", { results: [result({ accuracy_type: "place" })] }],
    ["a weak match", { results: [result({ accuracy: 0.6 })] }],
    ["another state", { results: [result({ address_components: { number: "350", formatted_street: "N State St", state: "ID", zip: "83201" } })] }],
    ["several ZIP+4s", { results: [result({}, { plus4: ["2310", "2311"] })] }],
    ["no ZIP+4", { results: [result({}, {})] }],
    ["an inexact ZIP+4", { results: [result({}, { plus4: ["2310"], exact_match: false })] }],
    ["nothing", {}],
  ])("is no answer with %s", (_, body) => {
    expect(fromGeocodio(body, "UT")).toBeNull();
  });
});
