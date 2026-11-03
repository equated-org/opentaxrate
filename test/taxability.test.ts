import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parentOf, parseCodes, ruleSet, TAX_CODES, taxabilityByCode, taxabilityOf, type Rule, type TaxCode } from "../src/taxability/index.js";
import { looseForTest, pageText, quoteOnPage, quoteSpan } from "../src/taxability/fetch.js";
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

/** No outcome pairs conditions of different cases. Where several taxes are
 *  undecided, a combined outcome is one wording every undecided tax's rule
 *  states (one may add a further fact after "; "), or each tax's case
 *  joined, all of one narrower code. An independent answer lists each
 *  tax's cases on their own, each naming its tax. */
function expectSameCases(t: ReturnType<typeof taxabilityOf>, where: string) {
  const open = t.taxes.filter((g) => g.treatment === "conditional");
  if (t.independent) {
    expect(open.length, where).toBeGreaterThan(1);
    expect(t.outcomes!.every((o) => o.tax && o.when.startsWith(`${o.tax}: `)), where).toBe(true);
    expect(t.outcomes!.length, where).toBe(open.reduce((n, g) => n + g.rule!.conditions.length, 0));
    return;
  }
  for (const o of t.outcomes ?? []) {
    expect(o.tax, where).toBeUndefined();
    if (open.length < 2) continue;
    const normal = (when: string) => when.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
    const heads = o.when.split(";").map((_, i, all) => normal(all.slice(0, i + 1).join(";")));
    const worded = open.every((g) => g.rule!.conditions.some((k) => heads.includes(normal(k.when))));
    const coded = o.code !== undefined && open.every((g) => g.rule!.conditions.some((k) => k.code === o.code && o.when.includes(`${g.tax}: ${k.when}`)));
    expect(worded || coded, `${where}: ${o.when}`).toBe(true);
  }
}

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
    // A taxed share of the charge is a fraction, and only of a taxed case.
    const taxed = { ...base, tax: "ZZ", code: "food.grocery", from: "2021-01-01", treatment: "taxable" };
    expect(problems([{ ...taxed, base: 0.8 }])).toBe("");
    expect(problems([{ ...taxed, base: 1 }])).not.toBe("");
    expect(problems([{ ...taxed, treatment: "exempt", base: 0.8 }])).toContain("base");
    expect(problems([{ ...taxed, treatment: "conditional", conditions: [{ when: "Data processing", treatment: "taxable", base: 0.8 }] }])).toBe("");
    expect(problems([{ ...taxed, treatment: "conditional", conditions: [{ when: "Consulting", treatment: "exempt", base: 0.8 }] }])).toContain("base");
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

  it("a conditional answer lists each case with its combined rate, and the code to send where a case is one", () => {
    const ky: RatePart[] = [{ kind: "state", name: "Kentucky", code: "21", rate: 0.06, ids: {} }];
    const broad = taxabilityOf({ state: "KY", parts: ky }, "service.professional", "2026-10-30", RULES);
    expect(broad.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ rate: 0.06, code: "service.professional.lobbying" }),
      expect.objectContaining({ rate: 0, code: "service.professional.other" }),
    ]));
    // Sending the code an outcome names gives that outcome's rate, settled.
    for (const o of broad.outcomes!.filter((o) => o.code === "service.professional.lobbying" || o.code === "service.professional.other"))
      expect(taxabilityOf({ state: "KY", parts: ky }, o.code as TaxCode, "2026-10-30", RULES).rate).toBe(o.rate);
    // Two taxes, one undecided: the settled federal 5% is in every case.
    const mb = taxabilityOf({ state: "MB", parts: provinceParts("MB", "2026-10-31") }, "food.prepared.sandwich", "2026-10-31", RULES);
    expect(mb.outcomes?.map((o) => o.rate).sort()).toEqual([0.05, 0.12]);
    // A settled answer has none.
    expect(taxabilityOf({ state: "KY", parts: ky }, "service.professional.other", "2026-10-30", RULES).outcomes).toBeUndefined();
  });

  it("combines two undecided taxes' conditions only where they describe the same case, else lists each tax's on its own", () => {
    const base = { from: "2020-01-01", fromIs: "effective" as const, summary: "A test rule, nothing more.", citations: [{ title: "t", url: "https://example.gov/t" }] };
    const pizza = "A whole uncooked pizza for take-out";
    const kit = "Other food to cook, prepackaged";
    const meal = "Other food to cook, sold by a restaurant";
    const state = { ...base, tax: "ZZ", code: "food.uncooked", treatment: "conditional", conditions: [
      { when: pizza, treatment: "exempt" }, { when: kit, treatment: "exempt" }, { when: meal, treatment: "special_rate", rate: 0.09 },
    ] };
    // The local rule says the state's cases in its words, the meal split by a fact of the town's.
    const mirrored = { ...base, tax: "ZZ:local", code: "food.uncooked", treatment: "conditional", conditions: [
      { when: `${pizza}.`, treatment: "exempt" }, { when: kit.toUpperCase(), treatment: "exempt" },
      { when: `${meal}; in a town with the meals tax`, treatment: "special_rate", rate: 0.01 }, { when: `${meal}; in a town without it`, treatment: "exempt" },
    ] };
    const zz: RatePart[] = [{ kind: "state", name: "Z", code: "ZZ", rate: 0.06, ids: {} }, { kind: "city", name: "Zc", code: "ZZ1", rate: 0.01, ids: {} }];
    const paired = taxabilityOf({ state: "ZZ", parts: zz }, "food.uncooked", "2026-01-01", ruleSet([state, mirrored] as Rule[]));
    expect(paired.independent).toBeUndefined();
    expect(paired.outcomes?.map((o) => [o.when, o.rate])).toEqual([
      [`${pizza}.`, 0], [kit, 0], [`${meal}; in a town with the meals tax`, 0.1], [`${meal}; in a town without it`, 0.09],
    ]);
    expectSameCases(paired, "mirrored");
    // Worded otherwise, the cases can't be paired: never a pizza with a taxable meal.
    const other = { ...mirrored, conditions: [
      { when: "Not a taxable meal (a whole uncooked pizza, or other food to cook prepackaged)", treatment: "exempt" },
      { when: "A taxable meal other than a whole uncooked pizza, in a town with the meals tax", treatment: "special_rate", rate: 0.01 },
    ] };
    const apart = taxabilityOf({ state: "ZZ", parts: zz }, "food.uncooked", "2026-01-01", ruleSet([state, other] as Rule[]));
    expect(apart).toMatchObject({ treatment: "conditional", rate: null, independent: true });
    expect(apart.outcomes?.map((o) => [o.tax, o.rate])).toEqual([["ZZ", 0], ["ZZ", 0], ["ZZ", 0.09], ["ZZ:local", 0], ["ZZ:local", 0.01]]);
    expect(apart.outcomes?.[3].when).toBe(`ZZ:local: ${other.conditions[0].when}`);
    expectSameCases(apart, "apart");
    expect(TaxabilitySchema.parse(apart)).toBeTruthy();
  });

  it("a broad code answers a local part from the local tax's own rules for its kinds, not from the state's alone", () => {
    const base = { from: "2020-01-01", fromIs: "effective" as const, summary: "A test rule, nothing more.", citations: [{ title: "t", url: "https://example.gov/t" }] };
    // The state has a rule per kind; the local tax only for platters.
    const set = ruleSet([
      ...(["hot", "dine_in", "sandwich", "cold", "cold_restaurant", "bakery"] as const).map((k) => ({ ...base, tax: "ZZ", code: `food.prepared.${k}`, treatment: "taxable", conditions: [] })),
      { ...base, tax: "ZZ", code: "food.prepared.platter", treatment: "exempt", conditions: [] },
      { ...base, tax: "ZZ:local", code: "food.prepared.platter", treatment: "taxable", conditions: [] },
    ] as Rule[]);
    const zz: RatePart[] = [{ kind: "state", name: "Z", code: "ZZ", rate: 0.06, ids: {} }, { kind: "city", name: "Zc", code: "ZZ1", rate: 0.02, ids: {} }];
    const t = taxabilityOf({ state: "ZZ", parts: zz }, "food.prepared", "2026-01-01", set);
    expect(t.taxes.map((g) => g.tax)).toEqual(["ZZ", "ZZ:local"]);
    // Locally every kind is taxable, the platter by the local rule: settled.
    expect(t.taxes.find((g) => g.tax === "ZZ:local")).toMatchObject({ treatment: "taxable", rate: 0.02 });
    expect(t.taxes.find((g) => g.tax === "ZZ")!.rule!.conditions.find((k) => k.code === "food.prepared.platter")!.treatment).toBe("exempt");
    // The platter outcome is the state's exemption plus the local tax.
    expect(t.outcomes?.find((o) => o.code === "food.prepared.platter")?.rate).toBe(0.02);
  });

  it("pairs Montpelier's take-and-bake pizza with its own local case: 4 outcomes, not 9", () => {
    const vt: RatePart[] = [{ kind: "state", name: "Vermont", code: "VT-S", rate: 0.06, ids: {} }, { kind: "city", name: "Montpelier", code: "VT-C", rate: 0.01, ids: {} }];
    const t = taxabilityOf({ state: "VT", parts: vt }, "food.uncooked", "2026-11-02", RULES);
    expect(t.independent).toBeUndefined();
    expect(t.outcomes?.map((o) => o.rate)).toEqual([0, 0, 0.1, 0.09]);
    expect(t.outcomes?.[0].when).toMatch(/^A whole uncooked pizza/);
    expectSameCases(t, "VT food.uncooked");
  });

  it("taxes a share of the charge where the law does (base), on the whole charge", () => {
    const base = { from: "2020-01-01", fromIs: "effective" as const, summary: "A test rule, nothing more.", citations: [{ title: "t", url: "https://example.gov/t" }] };
    const zz: RatePart[] = [{ kind: "state", name: "Z", code: "ZZ", rate: 0.0625, ids: {} }, { kind: "city", name: "Zc", code: "ZZ1", rate: 0.02, ids: {} }];
    const set = ruleSet([
      { ...base, tax: "ZZ", code: "software.saas", treatment: "taxable", base: 0.8, conditions: [] },
      { ...base, tax: "ZZ", code: "service.professional.it", treatment: "conditional", conditions: [{ when: "Data processing", treatment: "taxable", base: 0.8 }, { when: "Consulting", treatment: "exempt" }] },
    ] as Rule[]);
    const saas = taxabilityOf({ state: "ZZ", parts: zz }, "software.saas", "2026-01-01", set);
    expect(saas).toMatchObject({ treatment: "partial", rate: 0.066 });
    expect(saas.taxes[0]).toMatchObject({ treatment: "taxable", rate: 0.066, rule: { base: 0.8 } });
    expect(taxabilityOf({ state: "ZZ", parts: zz }, "service.professional.it", "2026-01-01", set).outcomes?.map((o) => o.rate)).toEqual([0.066, 0]);
    // Texas's SaaS and data processing, on 8.25%.
    const tx: RatePart[] = [{ kind: "state", name: "Texas", code: "TX-S", rate: 0.0625, ids: {} }, { kind: "city", name: "Austin", code: "TX-C", rate: 0.02, ids: {} }];
    expect(taxabilityOf({ state: "TX", parts: tx }, "software.saas", "2026-11-02", RULES)).toMatchObject({ treatment: "partial", rate: 0.066 });
    expect(taxabilityOf({ state: "TX", parts: tx }, "service.professional.it", "2026-11-02", RULES).outcomes?.map((o) => o.rate)).toEqual([0.066, 0.0825, 0]);
    expect(TaxabilitySchema.parse(saas)).toBeTruthy();
  });

  it("lists every utensil case Michigan's statute states for a bakery item", () => {
    const mi: RatePart[] = [{ kind: "state", name: "Michigan", code: "MI-S", rate: 0.06, ids: {} }];
    const t = taxabilityOf({ state: "MI", parts: mi }, "food.prepared.bakery", "2026-11-02", RULES);
    const cases = t.outcomes!.map((o) => [o.when, o.rate] as const);
    const has = (pattern: RegExp, rate: number) => expect(cases.some(([when, r]) => pattern.test(when) && r === rate), `${pattern}`).toBe(true);
    has(/over 75%: the item is 4 or more servings packaged as 1 item sold for a single price/, 0);
    has(/over 75%: it makes no eating utensils available/, 0);
    has(/over 75%: it gives or hands an eating utensil \(a napkin counts\)/, 0.06);
    has(/75% or less: its business practice is to give or hand/, 0.06);
    has(/places an eating utensil in the package/, 0.06);
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
    expect(AddressRateSchema.parse({ ...base, state: "KY", taxability: taxabilityByCode({ ...base, state: "KY" }, ["service.professional"], "2026-10-30", RULES) })).toBeTruthy();
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

  it("reads a page in its own encoding: windows-1252, UTF-16 and Word .doc copies have no U+FFFD runs", () => {
    const bytes = (...parts: Array<string | number[]>) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...Buffer.from(p, "latin1")] : p)));
    // Pennsylvania's code: windows-1252 curly quotes, no charset said.
    const pa = pageText(bytes("<html><body><p>Used in the person", [0x92], "s business by ", [0x91, 0x91], "D", [0x92, 0x92], " ", [0x95], " is subject to tax.</p></body></html>"))!;
    expect(pa).not.toContain("\ufffd");
    expect(quoteOnPage(pa, "Used in the person’s business by ‘‘D’’ • is subject to tax.")).toBe(true);
    // Nevada's: a declared windows-1252 page with a non-breaking space run.
    const nv = pageText(bytes('<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"></head><body><p>seller:', [0xa0, 0xa0, 0xa0], "(1) Two</p></body></html>"))!;
    expect(nv).not.toContain("\ufffd");
    expect(quoteOnPage(nv, "seller: (1) Two")).toBe(true);
    // Valid UTF-8 stays UTF-8 whatever the page declares; a stray windows-1252 byte in it is read as one.
    const mixed = pageText(new Uint8Array([...new TextEncoder().encode('<html><head><meta charset="iso-8859-1"></head><body><p>Caf\u00e9 food \u2014 the buyer'), 0x92, ...new TextEncoder().encode("s tax</p></body></html>")]))!;
    expect(mixed).toBe("Café food — the buyer’s tax");
    expect(pageText(new TextEncoder().encode('<html><head><meta charset="windows-1252"></head><body><p>Caf\u00e9 \u2014 ok</p></body></html>'))).toBe("Café — ok");
    // A UTF-8 byte-order mark, and HTML's &#146; (a windows-1252 quote by number).
    expect(pageText(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("<html><body><p>the buyer&#146;s</p></body></html>")]))).toBe("the buyer’s");
    // South Dakota's rule: a Word page saved as UTF-16LE HTML, no mark.
    const sd = pageText(new Uint8Array(Buffer.from("<html><body><p>The following are taxable: (2) Designing of computer systems;</p></body></html>", "utf16le")))!;
    expect(sd).toBe("The following are taxable: (2) Designing of computer systems;");
    expect(pageText(new Uint8Array([0xff, 0xfe, ...Buffer.from("plain text, marked", "utf16le")]))).toBe("plain text, marked");
    // Florida's rule: an OLE2 Word .doc, its text in windows-1252, paragraphs ending in CR.
    const doc = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], new Array(64).fill(0), new Array(40).fill(0xff), [0, 0], "12A-1.032 Computer Software.\rHowever, where the vendor, at the customer", [0x92], "s request, modifies a program, it is not subject to tax.\r", [0, 0, 0], "Times New Roman", [0, 1, 2], ...[Buffer.from("Title", "utf16le")].map((b) => [...b]));
    const fl = pageText(doc)!;
    expect(fl).not.toContain("\ufffd");
    expect(fl).not.toMatch(/\xff/);
    expect(quoteOnPage(fl, "However, where the vendor, at the customer’s request, modifies a program, it is not subject to tax.")).toBe(true);
    expect(fl).toContain("12A-1.032 Computer Software.\n");
  });

  it("finds a quote whose line-end hyphen pdftotext dropped, and loosens nothing else", () => {
    // pdftotext joins "39-26-" and "717(2)(n)" at a line break without the hyphen.
    const statute = "Exempt under section 39-26717(2)(n), C.R.S., are sales of shortterm rentals of\nfarm equipment.";
    expect(quoteOnPage(statute, "Exempt under § 39-26-717(2)(n)")).toBe(false); // the § isn't on the page
    expect(quoteOnPage(statute, "section 39-26-717(2)(n), C.R.S.")).toBe(true);
    expect(quoteOnPage("Under § 39-26717(2)(n) of the statute", "§ 39-26-717(2)(n)")).toBe(true);
    expect(quoteOnPage(statute, "sales of short-term rentals of farm equipment.")).toBe(true);
    // Either side may have the hyphen.
    expect(quoteOnPage("sales of short-term rentals", "sales of shortterm rentals")).toBe(true);
    // Unrelated text, and other numbers, still don't match.
    expect(quoteOnPage(statute, "section 39-26-718(2)(n)")).toBe(false);
    expect(quoteOnPage(statute, "sales of long-term rentals of farm equipment.")).toBe(false);
    expect(quoteOnPage(statute, "short term rentals")).toBe(false);
    expect(quoteOnPage("No dashes on this page.", "-")).toBe(false);
  });

  it("says where a quote is in the original text: the same match quoteOnPage accepts, as the page prints it", () => {
    const at = (text: string, quote: string) => {
      const span = quoteSpan(text, quote);
      return span && text.slice(...span);
    };
    // Case, spacing, line breaks, curly quotes and dashes don't count; the span is the page's own words.
    const page = "Title\n\n  The SALE of “prepared food”\n  —  heated —  is   taxable.\nNext.";
    expect(at(page, 'the sale of "prepared food" - heated - is taxable.')).toBe("The SALE of “prepared food”\n  —  heated —  is   taxable.");
    // The first place it is, as quoteOnPage's includes.
    expect(quoteSpan("ab food. food.", "food.")).toEqual([3, 8]);
    // A space a tag left before punctuation, or after a bracket.
    const abbr = "Sales (excluding HST ) of not more than $4 .";
    expect(at(abbr, "Sales (excluding HST) of not more than $4.")).toBe(abbr);
    expect(at("see ( a ) here", "(a)")).toBe("( a )");
    // The hyphenless fallback only when the quote isn't there with its hyphens.
    const statute = "Exempt under section 39-26717(2)(n), C.R.S., are sales of shortterm rentals of\nfarm equipment.";
    expect(at(statute, "section 39-26-717(2)(n), C.R.S.")).toBe("section 39-26717(2)(n), C.R.S.");
    expect(at(statute, "sales of short-term rentals of farm equipment.")).toBe("sales of shortterm rentals of\nfarm equipment.");
    expect(at("a short-term rental, a shortterm one", "short-term")).toBe("short-term");
    // Characters lower case makes longer, and ones outside the BMP, keep their places.
    expect(at("İstanbul 𝐀 tax is due.", "tax is due.")).toBe("tax is due.");
    expect(at("x İSTANBUL y", "i̇stanbul")).toBe("İSTANBUL");
    // Not on the page, or nothing to find: no span, exactly where quoteOnPage says no.
    for (const [text, quote] of [[statute, "section 39-26-718(2)(n)"], [statute, "short term rentals"], ["No dashes on this page.", "-"], ["text", "   "]] as const) {
      expect(quoteSpan(text, quote)).toBeNull();
      if (quote.trim()) expect(quoteOnPage(text, quote)).toBe(false);
    }
  });

  it("finds spans with the very normalization quoteOnPage uses", () => {
    const samples = ["A  b\t\nC", " ( x ) , y ; z ] ", "‘single’ “double” – en — em", "ΑΒΓ İ ß ﬁ", "-a - b -- c-", "\u00a0nbsp\u2028line\ufeff", "𝐀𝐁 ( [ ] )"];
    for (const s of samples) expect(looseForTest(s).mapped).toBe(looseForTest(s).loose);
    for (const s of samples) for (let i = 0; i < s.length; i++) for (let j = i + 1; j <= s.length; j++) {
      const quote = s.slice(i, j);
      if (!quote.trim()) continue;
      const span = quoteSpan(s, quote);
      expect(Boolean(span)).toBe(quoteOnPage(s, quote));
      if (span) expect(quoteOnPage(s.slice(...span), quote)).toBe(true);
    }
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

  it("a rule for one local part decides that part alone, at its own special rate", () => {
    const base = { from: "2020-01-01", fromIs: "effective" as const, summary: "A test rule, nothing more.", conditions: [], citations: [{ title: "t", url: "https://example.gov/t" }] };
    const set = ruleSet([
      { ...base, tax: "ZZ", code: "food.prepared", treatment: "taxable" },
      { ...base, tax: "ZZ:local", code: "food.grocery", treatment: "taxable" },
      { ...base, tax: "ZZ", code: "food.grocery", treatment: "exempt" },
      { ...base, tax: "ZZ:local:01:7", code: "food.prepared", treatment: "special_rate", rate: 0.04 },
      { ...base, tax: "ZZ:local:01:7", code: "food.grocery", treatment: "exempt" },
    ] as Rule[]);
    const parts: RatePart[] = [
      { kind: "state", code: "45:1", rate: 0.03 },
      { kind: "city", code: "01:7", rate: 0.05 },
      { kind: "district", code: "d:9", rate: 0.01 },
    ];
    const hot = taxabilityOf({ state: "ZZ", parts }, "food.prepared.hot", "2026-01-01", set);
    expect(hot).toMatchObject({ treatment: "partial", rate: 0.08 });
    expect(hot.taxes.map((g) => [g.tax, g.parts])).toEqual([["ZZ", ["45:1", "d:9"]], ["ZZ:local:01:7", ["01:7"]]]);
    // The most specific rule wins over "ZZ:local" too; the other local part keeps it.
    const grocery = taxabilityOf({ state: "ZZ", parts }, "food.grocery", "2026-01-01", set);
    expect(grocery.taxes.map((g) => [g.tax, g.parts, g.rate])).toEqual([["ZZ", ["45:1"], 0], ["ZZ:local:01:7", ["01:7"], 0], ["ZZ:local", ["d:9"], 0.01]]);
    // Another city's part is untouched.
    const other = taxabilityOf({ state: "ZZ", parts: [parts[0], { kind: "city", code: "01:8", rate: 0.05 }] }, "food.prepared.hot", "2026-01-01", set);
    expect(other).toMatchObject({ treatment: "taxable", rate: 0.08 });
  });

  it("taxes Denver's food and drink at its own 4.00%, and exempts pop sold for home consumption (Topic 32, Rule 002)", () => {
    // 200 E Colfax Ave, Denver, CO 80203, as the rate lookup answers it.
    const denver: RatePart[] = [
      { kind: "state", name: "Colorado", code: "45:1", rate: 0.029 },
      { kind: "city", name: "Denver, City and County", code: "01:ttr17", rate: 0.0515 },
      { kind: "district", name: "Colorado RTD", code: "d:ttr528", rate: 0.01 },
      { kind: "district", name: "Scientific and Cultural Facilities District", code: "d:ttr555", rate: 0.001 },
    ];
    // Hot takeaway lasagna: CO 2.9% + RTD 1% + SCFD 0.1% + Denver 4%.
    const hot = taxabilityOf({ state: "CO", parts: denver }, "food.prepared.hot", "2026-11-03", RULES);
    expect(hot).toMatchObject({ treatment: "partial", rate: 0.08 });
    expect(hot.taxes.find((g) => g.parts.includes("01:ttr17"))).toMatchObject({ tax: "CO:local:01:ttr17", parts: ["01:ttr17"], treatment: "special_rate", rate: 0.04 });
    // An unopened six-pack of ginger ale from a store: state and district taxes only.
    const pop = taxabilityOf({ state: "CO", parts: denver }, "food.soft_drink", "2026-11-03", RULES);
    expect(pop).toMatchObject({ treatment: "partial", rate: 0.04 });
    expect(pop.taxes.find((g) => g.parts.includes("01:ttr17"))).toMatchObject({ treatment: "exempt", rate: 0 });
    // A general sale is still at Denver's general rate.
    expect(taxabilityOf({ state: "CO", parts: denver }, "goods.general", "2026-11-03", RULES)).toMatchObject({ treatment: "taxable", rate: 0.0915 });
    // Another Colorado city's part keeps the CO rules.
    const elsewhere = denver.map((p) => (p.code === "01:ttr17" ? { ...p, code: "01:ttr999999" } : p));
    expect(taxabilityOf({ state: "CO", parts: elsewhere }, "food.prepared.hot", "2026-11-03", RULES)).toMatchObject({ treatment: "taxable", rate: 0.0915 });
  });

  it("keeps its promises for every place, every code and dates from 2013 to 2027, on the real rules", () => {
    const provinces = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
    // Every US state with rules ("CA" here is California; Canada's federal
    // rules are reached through the provinces).
    const places = [...new Set(rows.map((r) => r.tax.slice(0, 2)))].filter((p) => !provinces.includes(p));
    const ownParts = (place: string) => [...new Set(rows.flatMap((r) => (r.tax.startsWith(`${place}:local:`) ? [r.tax.slice(`${place}:local:`.length)] : [])))];
    const dates = ["2013-06-01", "2016-01-01", "2019-07-01", "2021-03-15", "2023-01-01", "2024-12-20", "2025-07-01", "2025-10-15", "2026-06-15", "2026-10-30", "2027-03-01"];
    let answers = 0;
    for (const date of dates)
      for (const place of [...places, ...provinces]) {
        const parts: RatePart[] = provinces.includes(place)
          ? provinceParts(place, date)
          : [
              { kind: "state", code: `${place}-S`, rate: 0.05 },
              { kind: "county", code: `${place}-C`, rate: 0.01 },
              { kind: "city", code: `${place}-T`, rate: 0.015 },
              // Each local part a rule of its own is keyed to ("CO:local:01:ttr17").
              ...ownParts(place).map((code) => ({ kind: "city" as const, code, rate: 0.03 })),
            ];
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
          // An outcome that names a code is what sending that code gives,
          // wherever that answer is settled.
          if (t.treatment !== "conditional") expect(t.outcomes, where).toBeUndefined();
          // On an independent answer an outcome is one tax's case: what
          // sending its code gives that tax, plus the settled taxes.
          const fixed = t.taxes.reduce((sum, g) => sum + (g.rate ?? 0), 0);
          for (const o of t.outcomes ?? []) {
            if (!o.code || t.outcomes!.some((p) => p !== o && p.code === o.code && p.tax === o.tax)) continue;
            const sent = taxabilityOf({ state: place, parts }, o.code as TaxCode, date, RULES);
            if (!t.independent) {
              if (sent.rate !== null) expect(sent.rate, `${where} → ${o.code}`).toBe(o.rate);
              continue;
            }
            const own = sent.taxes.find((g) => g.tax === o.tax);
            if (own?.rate != null) expect(fixed + own.rate, `${where} → ${o.tax} ${o.code}`).toBeCloseTo(o.rate, 9);
          }
          expectSameCases(t, where);
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

describe("a broad code whose kinds are treated alike", () => {
  const BASE = { from: "2020-01-01", fromIs: "effective" as const, summary: "A test rule, nothing more.", citations: [{ title: "t", url: "https://example.gov/t" }] };
  const ZZ = [{ kind: "state" as const, name: "Z", code: "ZZ", rate: 0.06, ids: {} }];
  const exception = { when: "The floor is ceramic tile", treatment: "exempt" as const };
  it("keeps each kind's exceptions, from the kinds alone or beside the broad code's own rule", () => {
    const kinds = [
      { ...BASE, tax: "ZZ", code: "construction.real_property.improvement.flooring", treatment: "taxable", conditions: [exception] },
      { ...BASE, tax: "ZZ", code: "construction.real_property.improvement.other", treatment: "taxable", conditions: [] },
    ];
    for (const rules of [kinds, [...kinds, { ...BASE, tax: "ZZ", code: "construction.real_property.improvement", treatment: "taxable", conditions: [] }]]) {
      const t = taxabilityOf({ state: "ZZ", parts: ZZ }, "construction.real_property.improvement", "2026-11-02", ruleSet(rules as Rule[]));
      expect(t).toMatchObject({ treatment: "taxable", rate: 0.06 });
      expect(t.taxes[0].rule?.conditions).toEqual([
        { when: "construction.real_property.improvement.flooring: " + TAX_CODES["construction.real_property.improvement.flooring"].replace(/\.$/, "") + ", except the floor is ceramic tile", treatment: "exempt", code: "construction.real_property.improvement.flooring" },
      ]);
    }
  });
});
