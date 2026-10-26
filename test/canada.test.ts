import { describe, expect, it } from "vitest";
import { addressRates } from "../src/rates/index.js";
import { postalCode, PROVINCES } from "../src/rates/canada.js";
import { parseAddress } from "../src/address-text.js";
import { AddressRateSchema } from "../src/api-schema.js";

const at = (state: string, date: string, zip?: string) => addressRates.at({ state, street: "1 Main St", city: "Town", zip }, date);

describe("Canada", () => {
  it("gives each province's rate today, as CRA's calculator lists it", async () => {
    const rates = Object.fromEntries(await Promise.all(Object.keys(PROVINCES).map(async (p) => [p, (await at(p, "2026-10-26")).rate])));
    expect(rates).toEqual({
      AB: 0.05, BC: 0.12, MB: 0.12, NB: 0.15, NL: 0.15, NS: 0.14, NT: 0.05,
      NU: 0.05, ON: 0.13, PE: 0.15, QC: 0.14975, SK: 0.11, YT: 0.05,
    });
  });

  it("names the federal tax and the province's own as parts", async () => {
    const bc = await at("BC", "2026-10-26");
    expect(AddressRateSchema.parse(bc)).toBeTruthy();
    expect(bc).toMatchObject({ stateRate: 0.12, localRate: 0, match: "statewide", jurisdictions: "settled" });
    expect(bc.parts.map((p) => [p.name, p.rate])).toEqual([["GST", 0.05], ["British Columbia PST", 0.07]]);
    expect(bc.reporting).toMatchObject({ agency: { name: "Canada Revenue Agency" }, form: "GST/HST return (GST34)" });
    expect(bc.reporting!.notes[0]).toMatch(/eTaxBC/);
    expect((await at("ON", "2026-10-26")).parts.map((p) => p.name)).toEqual(["Ontario HST"]);
    expect((await at("QC", "2026-10-26")).reporting).toMatchObject({ agency: { name: "Revenu Québec" } });
  });

  it("follows each dated change, and refuses before April 2013", async () => {
    const rate = async (state: string, date: string) => (await at(state, date)).rate;
    expect([await rate("NS", "2025-03-31"), await rate("NS", "2025-04-01")]).toEqual([0.15, 0.14]);
    expect([await rate("NB", "2016-06-30"), await rate("NB", "2016-07-01")]).toEqual([0.13, 0.15]);
    expect([await rate("PE", "2016-09-30"), await rate("PE", "2016-10-01")]).toEqual([0.14, 0.15]);
    expect([await rate("MB", "2019-06-30"), await rate("MB", "2019-07-01")]).toEqual([0.13, 0.12]);
    expect([await rate("SK", "2017-03-22"), await rate("SK", "2017-03-23")]).toEqual([0.1, 0.11]);
    await expect(at("ON", "2013-03-31")).rejects.toThrow(/only from 2013-04-01/);
  });

  it("checks a postal code against the province", async () => {
    expect((await at("ON", "2026-10-26", "m5v3l9")).rate).toBe(0.13);
    expect((await at("NU", "2026-10-26", "X0A 0H0")).rate).toBe(0.05);
    await expect(at("ON", "2026-10-26", "H3B 4W5")).rejects.toThrow(/isn't in Ontario/);
    await expect(at("ON", "2026-10-26", "98122")).rejects.toThrow(/isn't a Canadian postal code/);
    await expect(at("WA", "2026-10-26", "M5V 3L9")).rejects.toThrow(/Canadian postal code/);
    expect(postalCode("m5v-3l9")).toBe("M5V 3L9");
    expect(postalCode("D5V 3L9")).toBeNull();
  });

  it("reads a Canadian address on one line", () => {
    expect(parseAddress("290 Bremner Blvd, Toronto, ON M5V 3L9")).toEqual({
      ok: true,
      address: { street: "290 Bremner Blvd", city: "Toronto", state: "ON", zip: "M5V 3L9" },
    });
    expect(parseAddress("1000 Rue De La Gauchetiere O, Montreal, Québec H3B4W5, Canada")).toMatchObject({
      ok: true,
      address: { city: "Montreal", state: "QC", zip: "H3B 4W5" },
    });
    expect(parseAddress("123 Main St Halifax Nova Scotia")).toMatchObject({ ok: true, address: { city: "Halifax", state: "NS" } });
  });
});
