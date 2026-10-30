import { describe, expect, it } from "vitest";
import { parseCodes, ruleSet, TAX_CODES, taxabilityByCode, taxabilityOf, type Rule, type TaxCode } from "../src/taxability/index.js";
import { pageText, quoteOnPage } from "../src/taxability/fetch.js";
import { readRuleFiles } from "../src/taxability/rules/index.js";
import { answerKey } from "../src/cache.js";
import { AddressRateSchema, TaxabilitySchema } from "../src/api-schema.js";
import { provinceParts } from "../src/rates/canada.js";
import type { RatePart } from "../src/rates/types.js";

const ny: RatePart[] = [
  { kind: "state", name: "New York", code: "45:36", rate: 0.04, ids: {} },
  { kind: "county", name: "Kings", code: "00:047", rate: 0.04875, ids: {} },
];
const tx: RatePart[] = [
  { kind: "state", name: "Texas", code: "48", rate: 0.0625, ids: {} },
  { kind: "city", name: "Austin", code: "05000", rate: 0.02, ids: {} },
];
const CODES = Object.keys(TAX_CODES) as TaxCode[];
// The reviewed files, read and checked as ingest reads them.
const { rules: rows } = readRuleFiles();
const RULES = ruleSet(rows as Rule[]);

describe("taxability", () => {
  it("never falls back: a state with no rules is not researched, with the general rate untouched", () => {
    const t = taxabilityOf({ state: "TX", parts: tx }, "food.catering", "2026-06-15", RULES);
    expect(t).toMatchObject({ treatment: "not_researched", rate: null });
    expect(t.taxes).toEqual([{ tax: "TX", parts: ["48", "05000"], treatment: "not_researched", rate: null, rule: null }]);
  });

  it("a nontaxable line is not taxed anywhere, without consulting a rule", () => {
    const t = taxabilityOf({ state: "TX", parts: tx }, "nontaxable", "2026-06-15", RULES);
    expect(t).toMatchObject({ treatment: "not_taxed", rate: 0 });
    expect(t.taxes[0]).toMatchObject({ tax: "*", parts: ["48", "05000"], treatment: "not_a_sale", rate: 0 });
  });

  it("rate is null exactly when conditional or not researched, and every part is in one group", () => {
    const places: Array<[string, RatePart[]]> = [["NY", ny], ["TX", tx], ["BC", provinceParts("BC", "2026-06-15")], ["ON", provinceParts("ON", "2026-06-15")]];
    for (const [state, parts] of places)
      for (const code of CODES)
        for (const date of ["2014-06-15", "2026-06-15"]) {
          const t = taxabilityOf({ state, parts }, code, date, RULES);
          expect(t.rate === null).toBe(t.treatment === "conditional" || t.treatment === "not_researched");
          expect(t.taxes.flatMap((g) => g.parts).sort()).toEqual(parts.map((p) => p.code).sort());
          expect(TaxabilitySchema.parse(t)).toBeTruthy();
          if (t.rate !== null) {
            const general = parts.reduce((s, p) => s + p.rate, 0);
            expect(t.rate).toBeLessThanOrEqual(general + 1e-9);
            if (t.treatment === "taxable") expect(t.rate).toBeCloseTo(general, 9);
            if (t.treatment === "not_taxed") expect(t.rate).toBe(0);
          }
        }
  });

  it("groups a US state's parts under one rule", () => {
    const t = taxabilityOf({ state: "NY", parts: ny }, "food.catering", "2026-06-15", RULES);
    expect(t.taxes).toHaveLength(1);
    expect(t.taxes[0].parts).toEqual(["45:36", "00:047"]);
    expect(t.taxes[0].rule?.citations.length).toBeGreaterThan(0);
  });

  it("decides each Canadian tax by its own rule", () => {
    const t = taxabilityOf({ state: "BC", parts: provinceParts("BC", "2026-06-15") }, "food.prepared", "2026-06-15", RULES);
    expect(t.taxes.map((g) => g.parts)).toEqual([["CA:GST"], ["BC:PST"]]);
  });

  it("answers one entry per code asked, and parses a code list", () => {
    expect(Object.keys(taxabilityByCode({ state: "TX", parts: tx }, ["food.catering", "nontaxable"], "2026-06-15", RULES))).toEqual(["food.catering", "nontaxable"]);
    expect(parseCodes("food.catering, nontaxable,food.catering")).toEqual({ codes: ["food.catering", "nontaxable"] });
    expect(parseCodes("food.cattering")).toEqual({ unknown: "food.cattering" });
  });

  it("keys the cache on the codes asked, and not at all without them", () => {
    const q = { state: "NY", street: "488 14th St", city: "Brooklyn", zip: "11215", date: "2026-10-08" };
    expect(answerKey({ ...q, codes: [] }, [])).toBe(answerKey(q, []));
    expect(answerKey({ ...q, codes: ["food.catering", "nontaxable"] }, [])).toBe(answerKey({ ...q, codes: ["nontaxable", "food.catering"] }, []));
    expect(answerKey({ ...q, codes: ["food.catering"] }, [])).not.toBe(answerKey(q, []));
  });

  it("reads every reviewed rule file cleanly: dated, cited, no overlaps, every follows resolved", () => {
    expect(rows.length).toBeGreaterThan(100);
    for (const r of rows) expect(r.citations.every((c) => /^https?:\/\//.test(c.url)), `${r.tax} ${r.code}`).toBe(true);
    // Every HST province reads a rule of its own for every researched code.
    for (const p of ["ON", "NS", "NB", "NL", "PE"])
      for (const code of CODES.filter((c) => c !== "nontaxable"))
        expect(rows.some((r) => r.tax === `${p}/CA:HST` && r.code === code), `${p} ${code}`).toBe(true);
  });

  it("an HST province follows the federal base only through its own checked rule", () => {
    const ns = taxabilityOf({ state: "NS", parts: provinceParts("NS", "2026-06-15") }, "food.catering", "2026-06-15", RULES);
    expect(ns).toMatchObject({ treatment: "taxable", rate: 0.14 });
    expect(ns.taxes[0].tax).toBe("CA:GST/HST");
    expect(ns.taxes[0].rule?.citations.some((c) => c.url.includes("reason-code-16"))).toBe(true);
    const without = ruleSet(rows.filter((r) => r.tax !== "NS/CA:HST") as Rule[]);
    expect(taxabilityOf({ state: "NS", parts: provinceParts("NS", "2026-06-15") }, "food.catering", "2026-06-15", without).treatment).toBe("not_researched");
  });

  it("fits the API schema with and without a code", () => {
    const base = {
      state: "NY", rate: 0.08875, stateRate: 0.04, localRate: 0.04875,
      byType: { general: 0.08875, generalInterstate: null, foodDrug: null, foodDrugInterstate: null },
      parts: ny, match: "map", locationCode: "36-047", jurisdictions: "settled", alternatives: [], locationIds: {}, zip4: null,
      source: "test", reporting: null,
    } as const;
    expect(AddressRateSchema.parse(base)).toBeTruthy();
    expect(AddressRateSchema.parse({ ...base, taxability: taxabilityByCode(base, ["food.catering", "nontaxable"], "2026-10-08", RULES) })).toBeTruthy();
  });

  it("reads a page's text the way its quotes were copied: entities decoded once, daily columns ignored", () => {
    const html = new TextEncoder().encode("<html><body><p>Under Tax Law &sect;1105(c) the caterer&#8217;s charge &mdash; staff &amp; rentals &#x2013; is taxable; &amp;sect; stays.</p><script>x()</script></body></html>");
    expect(pageText(html)).toBe("Under Tax Law §1105(c) the caterer’s charge — staff & rentals – is taxable; &sect; stays.");
    const csv = (days: string) => new TextEncoder().encode(`"Id","Title","New","daydiff"\n"2","Clothing, Footwear","FALSE","${days}"\n`);
    expect(pageText(csv("2626"), { ignoreColumns: ["New", "daydiff"] })).toBe(pageText(csv("2627"), { ignoreColumns: ["New", "daydiff"] }));
    expect(pageText(csv("2626"), { ignoreColumns: ["New", "daydiff"] })).toBe("Id,Title\n2,Clothing, Footwear");
    // A tag before punctuation leaves a space in the text; the quote is still found as the page writes it.
    const abbr = pageText(new TextEncoder().encode("<html><body><p>Sales (excluding <abbr>HST</abbr>) of not more than $4.</p></body></html>"))!;
    expect(quoteOnPage(abbr, "Sales (excluding HST) of not more than $4.")).toBe(true);
    expect(quoteOnPage(abbr, "Sales (excluding GST) of not more than $4.")).toBe(false);
  });
});
