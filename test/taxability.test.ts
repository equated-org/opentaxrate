import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parentOf, parseCodes, ruleSet, TAX_CODES, taxabilityByCode, taxabilityOf, type Rule, type TaxCode } from "../src/taxability/index.js";
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
// A place with no rules at all.
const tx: RatePart[] = [
  { kind: "state", name: "Nowhere", code: "48", rate: 0.0625, ids: {} },
  { kind: "city", name: "Nowhere City", code: "05000", rate: 0.02, ids: {} },
];
const CODES = Object.keys(TAX_CODES) as TaxCode[];
// The reviewed files, read and checked as ingest reads them.
const { rules: rows } = readRuleFiles();
const RULES = ruleSet(rows as Rule[]);

describe("taxability", () => {
  it("never falls back: a state with no rules is not researched, with the general rate untouched", () => {
    const t = taxabilityOf({ state: "ZZ", parts: tx }, "food.catering", "2026-06-15", RULES);
    expect(t).toMatchObject({ treatment: "not_researched", rate: null });
    expect(t.taxes).toEqual([{ tax: "ZZ", parts: ["48", "05000"], treatment: "not_researched", rate: null, rule: null }]);
  });

  it("a nontaxable line is not taxed anywhere, without consulting a rule", () => {
    const t = taxabilityOf({ state: "ZZ", parts: tx }, "nontaxable", "2026-06-15", RULES);
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
    expect(Object.keys(taxabilityByCode({ state: "ZZ", parts: tx }, ["food.catering", "nontaxable"], "2026-06-15", RULES))).toEqual(["food.catering", "nontaxable"]);
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
      for (const code of CODES.filter((c) => !parentOf(c) && rows.some((r) => r.tax === "CA:GST/HST" && r.code === c)))
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

  it("a broad code with differing subcodes is conditional, and .other settles the rest by the broad rule", () => {
    const ky: RatePart[] = [{ kind: "state", name: "Kentucky", code: "21", rate: 0.06, ids: {} }];
    const broad = taxabilityOf({ state: "KY", parts: ky }, "service.professional", "2026-10-30", RULES);
    expect(broad).toMatchObject({ treatment: "conditional", rate: null });
    const when = broad.taxes[0].rule!.conditions.map((c) => [c.when.split(":")[0], c.treatment]);
    expect(when).toEqual(expect.arrayContaining([["service.professional.design", "taxable"], ["service.professional.lobbying", "taxable"], ["service.professional.other", "exempt"]]));
    expect(taxabilityOf({ state: "KY", parts: ky }, "service.professional.other", "2026-10-30", RULES)).toMatchObject({ treatment: "not_taxed", rate: 0 });
    expect(taxabilityOf({ state: "KY", parts: ky }, "service.professional.design", "2026-10-30", RULES)).toMatchObject({ treatment: "taxable", rate: 0.06 });
    // Before Kentucky taxed design, every kind it lists was exempt: the broad code settles.
    expect(taxabilityOf({ state: "KY", parts: ky }, "service.professional", "2022-06-01", RULES)).toMatchObject({ treatment: "not_taxed", rate: 0 });
  });

  it("refuses rule files that can't be right: an impossible day, a zero rate, overlaps, a special rate whose local parts go uncovered", () => {
    const cite = [{ title: "A bulletin", url: "https://example.gov/x", quote: "Groceries are exempt." }];
    const base = { fromIs: "effective", summary: "How groceries are taxed here.", conditions: [], citations: cite };
    const problems = (rules: object[]) => {
      const dir = mkdtempSync(path.join(tmpdir(), "otr-rules-"));
      writeFileSync(path.join(dir, "us-ZZ.json"), JSON.stringify(rules));
      try {
        readRuleFiles(dir);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(problems([{ ...base, tax: "ZZ", code: "food.grocery", from: "2021-01-01", treatment: "exempt" }])).toBe("");
    expect(problems([{ ...base, tax: "ZZ", code: "food.grocery", from: "2021-02-30", treatment: "exempt" }])).not.toBe("");
    expect(problems([{ ...base, tax: "ZZ", code: "food.grocery", from: "2021-01-01", treatment: "special_rate", rate: 0 }])).not.toBe("");
    expect(problems([
      { ...base, tax: "ZZ", code: "food.grocery", from: "2021-01-01", treatment: "exempt" },
      { ...base, tax: "ZZ", code: "food.grocery", from: "2022-01-01", treatment: "taxable" },
    ])).not.toBe("");
    // A state special rate needs its local parts settled for every day it's in force.
    const special = { ...base, tax: "ZZ", code: "food.grocery", from: "2021-01-01", treatment: "special_rate", rate: 0.02 };
    expect(problems([special, { ...base, tax: "ZZ:local", code: "food.grocery", from: "2021-01-01", treatment: "exempt" }])).toBe("");
    expect(problems([special, { ...base, tax: "ZZ:local", code: "food.grocery", from: "2022-01-01", treatment: "exempt" }])).toContain("ZZ:local");
    // Only a province's HST follows another rule.
    expect(problems([{ ...base, tax: "ZZ", code: "food.grocery", from: "2021-01-01", treatment: "exempt" }, { ...base, tax: "ZZ:local", code: "food.grocery", from: "2021-01-01", treatment: "follows", follows: "ZZ" }])).toContain("HST");
  });

  it("before a rule's earliest verified day, a code isn't researched rather than inheriting a broader rule", () => {
    const cite = [{ title: "A bulletin", url: "https://example.gov/x", quote: "q" }];
    const r = (tax: string, code: string, from: string, fromIs: "effective" | "earliest_verified", treatment: Rule["treatment"]) =>
      ({ tax, code, from, fromIs, treatment, summary: "s", conditions: [], citations: cite }) as Rule;
    const zz: RatePart[] = [{ kind: "state", name: "Z", code: "ZZ", rate: 0.07, ids: {} }];
    const set = ruleSet([r("ZZ", "construction.real_property", "2001-01-01", "effective", "exempt"), r("ZZ", "construction.real_property.improvement.flooring", "2025-02-05", "earliest_verified", "taxable")]);
    expect(taxabilityOf({ state: "ZZ", parts: zz }, "construction.real_property.improvement.flooring", "2024-06-15", set).treatment).toBe("not_researched");
    expect(taxabilityOf({ state: "ZZ", parts: zz }, "construction.real_property.improvement.flooring", "2025-06-15", set)).toMatchObject({ treatment: "taxable", rate: 0.07 });
    // A change in law (fromIs effective) leaves the broader rule in force before it.
    const law = ruleSet([r("ZZ", "construction.real_property", "2001-01-01", "effective", "exempt"), r("ZZ", "construction.real_property.improvement.flooring", "2025-02-05", "effective", "taxable")]);
    expect(taxabilityOf({ state: "ZZ", parts: zz }, "construction.real_property.improvement.flooring", "2024-06-15", law).treatment).toBe("not_taxed");
  });

  it("a local tax's own rule for a narrower code makes the broad code conditional", () => {
    const cite = [{ title: "A bulletin", url: "https://example.gov/x", quote: "q" }];
    const r = (tax: string, code: string, treatment: Rule["treatment"]) => ({ tax, code, from: "2021-01-01", fromIs: "effective", treatment, summary: "s", conditions: [], citations: cite }) as Rule;
    const set = ruleSet([r("ZZ", "service.professional", "exempt"), r("ZZ:local", "service.professional.design", "taxable")]);
    const zz: RatePart[] = [{ kind: "state", name: "Z", code: "ZZ", rate: 0.05, ids: {} }, { kind: "city", name: "Zc", code: "ZZ1", rate: 0.02, ids: {} }];
    expect(taxabilityOf({ state: "ZZ", parts: zz }, "service.professional", "2026-01-01", set)).toMatchObject({ treatment: "conditional", rate: null });
    expect(taxabilityOf({ state: "ZZ", parts: zz }, "service.professional.design", "2026-01-01", set)).toMatchObject({ rate: 0.02 });
  });

  it("a parent settled from its subcodes sees their own narrower codes", () => {
    const cite = [{ title: "A bulletin", url: "https://example.gov/x", quote: "q" }];
    const r = (code: string, treatment: Rule["treatment"]) => ({ tax: "ZZ", code, from: "2021-01-01", fromIs: "effective", treatment, summary: "s", conditions: [], citations: cite }) as Rule;
    const set = ruleSet([r("construction.real_property.improvement", "exempt"), r("construction.real_property.improvement.flooring", "taxable"), r("construction.real_property.repair", "exempt")]);
    const zz: RatePart[] = [{ kind: "state", name: "Z", code: "ZZ", rate: 0.07, ids: {} }];
    expect(taxabilityOf({ state: "ZZ", parts: zz }, "construction.real_property", "2026-01-01", set).treatment).toBe("conditional");
    expect(taxabilityOf({ state: "ZZ", parts: zz }, "construction.real_property.improvement.flooring", "2026-01-01", set)).toMatchObject({ treatment: "taxable", rate: 0.07 });
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

  it("a subcode answers from its parent's rule; a parent with only subcode rules is settled from them", () => {
    const base = { fromIs: "effective" as const, summary: "A test rule, nothing more.", conditions: [], citations: [{ title: "t", url: "https://example.gov/t" }] };
    const set = ruleSet([
      { ...base, tax: "ZZ", code: "food.prepared", from: "2020-01-01", treatment: "taxable" },
      { ...base, tax: "ZZ", code: "food.prepared.bakery", from: "2020-01-01", treatment: "exempt" },
      { ...base, tax: "ZZ", code: "service.professional.legal", from: "2020-01-01", treatment: "exempt" },
      { ...base, tax: "ZZ", code: "service.professional.accounting", from: "2020-01-01", treatment: "exempt" },
    ] as Rule[]);
    const at = (code: TaxCode) => taxabilityOf({ state: "ZZ", parts: [{ kind: "state", code: "ZZ", rate: 0.05 }] }, code, "2026-06-15", set);
    expect(at("food.prepared.hot")).toMatchObject({ treatment: "taxable", rate: 0.05 });
    expect(at("food.prepared.bakery")).toMatchObject({ treatment: "not_taxed", rate: 0 });
    expect(at("service.professional.legal").treatment).toBe("not_taxed");
    // Some professional subcodes have no rule: the parent can't be settled.
    expect(at("service.professional").treatment).toBe("not_researched");
  });

  it("charges a reduced rate on the state part only", () => {
    const base = { fromIs: "effective" as const, summary: "A test rule, nothing more.", conditions: [], citations: [{ title: "t", url: "https://example.gov/t" }] };
    const set = ruleSet([
      { ...base, tax: "ZZ", code: "food.grocery", from: "2020-01-01", treatment: "special_rate", rate: 0.04 },
      { ...base, tax: "ZZ:local", code: "food.grocery", from: "2020-01-01", treatment: "taxable" },
    ] as Rule[]);
    const t = taxabilityOf({ state: "ZZ", parts: [{ kind: "state", code: "ZZ", rate: 0.07 }, { kind: "city", code: "ZZ-C", rate: 0.0225 }] }, "food.grocery", "2026-06-15", set);
    expect(t).toMatchObject({ treatment: "partial", rate: 0.0625 });
    // A reduced local rule's rate is for all the local parts together, charged once.
    const local = ruleSet([
      { ...base, tax: "ZZ", code: "food.grocery", from: "2020-01-01", treatment: "special_rate", rate: 0.0175 },
      { ...base, tax: "ZZ:local", code: "food.grocery", from: "2020-01-01", treatment: "special_rate", rate: 0.0125 },
    ] as Rule[]);
    const three = [{ kind: "state" as const, code: "ZZ", rate: 0.0485 }, { kind: "county" as const, code: "ZZ-1", rate: 0.01 }, { kind: "city" as const, code: "ZZ-2", rate: 0.01 }, { kind: "district" as const, code: "ZZ-3", rate: 0.0025 }];
    expect(taxabilityOf({ state: "ZZ", parts: three }, "food.grocery", "2026-06-15", local).rate).toBe(0.03);
  });

  it("keeps its promises for every place, every code and dates from 2013 to 2027, on the real rules", () => {
    const provinces = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
    // Every US state with rules ("CA" here is California; Canada's federal
    // rules are reached through the provinces).
    const places = [...new Set(rows.map((r) => r.tax.slice(0, 2)))].filter((p) => !provinces.includes(p));
    const dates = ["2013-06-01", "2016-01-01", "2019-07-01", "2021-03-15", "2023-01-01", "2024-12-20", "2025-07-01", "2025-10-15", "2026-06-15", "2026-10-30", "2027-03-01"];
    let answers = 0;
    for (const date of dates)
      for (const place of [...places, ...provinces]) {
        const parts: RatePart[] = provinces.includes(place)
          ? provinceParts(place, date)
          : [{ kind: "state", code: `${place}-S`, rate: 0.05 }, { kind: "county", code: `${place}-C`, rate: 0.01 }, { kind: "city", code: `${place}-T`, rate: 0.015 }];
        const general = parts.reduce((sum, p) => sum + p.rate, 0);
        for (const code of CODES) {
          const t = taxabilityOf({ state: place, parts }, code, date, RULES);
          answers++;
          const where = `${place} ${code} ${date}`;
          expect(t.rate === null, where).toBe(t.treatment === "conditional" || t.treatment === "not_researched");
          expect(t.taxes.flatMap((g) => g.parts).sort(), where).toEqual(parts.map((p) => p.code).sort());
          for (const g of t.taxes) {
            expect(g.rate === null, where).toBe(g.treatment === "conditional" || g.treatment === "not_researched");
            if (g.treatment === "not_researched") expect(g.rule, where).toBeNull();
            else expect(g.rule?.citations.length, where).toBeGreaterThan(code === "nontaxable" ? -1 : 0);
          }
          // A settled broad code never hides a narrower code taxed
          // differently. (A narrower code researched only from a later day
          // is not researched before it, which hides nothing.)
          if (t.rate !== null)
            for (const narrower of CODES.filter((c) => c.startsWith(`${code}.`))) {
              const n = taxabilityOf({ state: place, parts }, narrower, date, RULES);
              if (n.treatment !== "not_researched") expect(n.rate, `${where} vs ${narrower}`).toBe(t.rate);
            }
          if (t.rate !== null) {
            const special = t.taxes.some((g) => g.treatment === "special_rate");
            if (!special) expect(t.rate, where).toBeLessThanOrEqual(general + 1e-9);
            expect(t.rate, where).toBeGreaterThanOrEqual(0);
            if (t.treatment === "taxable") expect(t.rate, where).toBeCloseTo(general, 9);
            if (t.treatment === "not_taxed") expect(t.rate, where).toBe(0);
          }
        }
      }
    expect(answers).toBeGreaterThan(20_000);
  });
});
