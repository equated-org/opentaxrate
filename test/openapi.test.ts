/**
 * /v1/openapi.json, and real answers read back through the schemas it's
 * generated from. Parsing strips what a schema doesn't name, so an answer
 * equal to its parse has no field the spec leaves out. No database: a
 * statewide state answers without one.
 */
import { describe, expect, it } from "vitest";
import { AddressRateSchema, ErrorSchema } from "../src/api-schema.js";

const { app } = await import("../src/server.js");
const DC = "/v1/rate?state=DC&street=1350+Pennsylvania+Ave+NW&city=Washington&date=2026-10-21";

describe("/v1/openapi.json", () => {
  it("describes the rate lookup, both ways of giving the address, and its answers", async () => {
    const response = await app.request("/v1/openapi.json");
    expect(response.status).toBe(200);
    const spec = await response.json();
    expect(spec.openapi).toBe("3.1.0");
    const rate = spec.paths["/v1/rate"].get;
    expect(rate.parameters.map((p: { name: string }) => p.name)).toEqual(["address", "state", "street", "city", "zip", "date", "code", "include"]);
    expect(Object.keys(rate.responses)).toEqual(["200", "400", "401", "402", "422", "429", "502", "504"]);
    expect(rate.responses["200"].content["application/json"].schema).toEqual({ $ref: "#/components/schemas/AddressRate" });
    expect(spec.paths["/v1/coverage"].get.responses["200"]).toBeDefined();
    expect(Object.keys(spec.components.schemas)).toEqual(expect.arrayContaining(["AddressRate", "RatePart", "Taxability", "Regions", "Trace", "Error", "Coverage"]));
    expect(Object.keys(spec.components.securitySchemes)).toEqual(["bearer", "apiKey"]);
  });
});

describe("answers fit the spec", () => {
  const fits = async (url: string) => {
    const body = await (await app.request(url)).json();
    expect(AddressRateSchema.parse(body)).toEqual(body);
  };

  it("a rate", () => fits(DC));
  it("a rate with its trace and regions", () => fits(`${DC}&include=trace,regions`));
  it("a rate asked as one line", () => fits(`/v1/rate?address=${encodeURIComponent("1350 Pennsylvania Ave NW, Washington, DC")}&date=2026-10-21`));

  it("a refusal and a bad request", async () => {
    for (const [url, status] of [
      ["/v1/rate?state=ZZ&street=1+Main+St&city=Unknown", 422],
      ["/v1/rate?street=1+Main+St", 400],
      [`/v1/rate?address=${encodeURIComponent("1 Main St")}`, 400],
    ] as const) {
      const response = await app.request(url);
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(ErrorSchema.parse(body)).toEqual(body);
    }
  });
});
