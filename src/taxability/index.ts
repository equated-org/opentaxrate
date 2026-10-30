/**
 * How a code (codes.ts) is taxed at an answered address on a date: each
 * part of the rate matched to the dated, cited rule for the code (rules/),
 * the parts grouped by the rule that decided them, and the rate on that
 * sale added up from the parts that tax it.
 *
 * A US state's rule covers every part of its answer, state and local,
 * unless the state has a separate "XX:local" rule for its local parts. In
 * Canada each tax has its own rules: the GST reads the federal base; an
 * HST province's HST reads its own rule, which is either the province's
 * own treatment (Ontario's prepared-food rebate) or "follows" the federal
 * base, as checked for that code; the PST, QST or RST is its own. The
 * rules come from the database (rules/index.ts), passed in, so the
 * resolver itself is a pure function.
 *
 * A part with no rule in force on the date is "not_researched", and then
 * the sale has no rate: it never falls back to the general rate. A rule
 * whose outcome turns on facts the code doesn't fix is "conditional", and
 * lists them; the rate is null until the caller settles them.
 *
 * The rest of the module, behind this file:
 *   codes.ts        the codes, and what each covers
 *   rules/          the reviewed rule files (one per place), the watch list
 *                   and certificates the monthly fetch uses, and the table
 *                   loader the lookup reads (index.ts)
 *   ingest.ts       files → checked → taxability_rules, cited pages archived
 *   fetch.ts        the monthly re-download of cited and watched pages
 *   evaluate.ts     the benchmark: the rules against the agencies' examples
 */
import type { AddressRate, RatePart } from "../rates/index.js";
import { TAX_CODES, type TaxCode } from "./codes.js";
import { ruleOn, type Rule, type RuleSet, type PartTreatment } from "./rules/index.js";

export { TAX_CODES, isTaxCode, type TaxCode } from "./codes.js";
export { loadRules, forgetRules, ruleSet, type Rule, type RuleSet, type PartTreatment, type Citation, type Condition } from "./rules/index.js";

/** A rule as an answer shows it: without the tax and code it's keyed by. */
export type ShownRule = Omit<Rule, "tax" | "code" | "notes" | "follows" | "treatment"> & { treatment: PartTreatment };

/** The answer's parts one rule decided, and what it decided. */
export interface TaxGroup {
  /** What the rule covers: "NY", "CA:GST/HST", "ON/CA:HST", "BC:PST"; "*"
   *  for a nontaxable line, which no rule decides. */
  tax: string;
  /** The codes of the parts, as in the answer's `parts`. */
  parts: string[];
  treatment: PartTreatment | "not_researched";
  /** What these parts add to the sale's rate; null when conditional or
   *  not researched. */
  rate: number | null;
  /** Null only when not researched. */
  rule: ShownRule | null;
}

export interface Taxability {
  /** taxable: every part at its rate; partial: some parts, or a reduced
   *  rate; not_taxed: no part; conditional: turns on the rules' listed
   *  facts; not_researched: a part has no rule for this code on this date. */
  treatment: "taxable" | "partial" | "not_taxed" | "conditional" | "not_researched";
  /** The combined rate on this sale; null unless every part is settled. */
  rate: number | null;
  taxes: TaxGroup[];
}

const NOT_A_SALE: ShownRule = {
  from: "0000-01-01",
  fromIs: "effective",
  treatment: "not_a_sale",
  summary: "Not a sale of anything, as the caller says; no jurisdiction's rules are consulted.",
  conditions: [],
  citations: [],
};

/** The rule keys a part answers to, most specific first. */
function keysFor(state: string, part: RatePart): string[] {
  if (part.code === "CA:GST") return [`${state}/CA:GST`, "CA:GST/HST"];
  // An HST province's own rule, or its "follows" rule; never the federal
  // base unchecked.
  if (part.code === "CA:HST") return [`${state}/CA:HST`];
  if (/^[A-Z]{2}:(PST|QST|RST)$/.test(part.code)) return [part.code];
  return part.kind === "state" ? [state] : [`${state}:local`, state];
}

/** The rule deciding `part`, a "follows" resolved to the rule it follows,
 *  whose citations it adds to. */
function ruleFor(rules: RuleSet, state: string, part: RatePart, code: TaxCode, date: string): Rule | null {
  for (const key of keysFor(state, part)) {
    const found = ruleOn(rules, key, code, date);
    if (!found) continue;
    if (found.treatment !== "follows") return found;
    const followed = ruleOn(rules, found.follows!, code, date);
    return followed && followed.treatment !== "follows" ? { ...followed, citations: [...followed.citations, ...found.citations] } : null;
  }
  return null;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** How `code` is taxed in `answer` on `date`. */
export function taxabilityOf(answer: Pick<AddressRate, "state" | "parts">, code: TaxCode, date: string, rules: RuleSet): Taxability {
  const state = answer.state.toUpperCase();
  // Parts grouped by the rule that decided them, in the order the parts
  // come; a part with no rule is its own group.
  const groups = new Map<string, TaxGroup>();
  for (const part of answer.parts) {
    const rule = code === "nontaxable" ? null : ruleFor(rules, state, part, code, date);
    // Unresearched parts group by the broadest key they'd answer to: a
    // state's parts together, each Canadian tax on its own.
    const broadest = keysFor(state, part).at(-1)!;
    const key = code === "nontaxable" ? "*" : rule ? `${rule.tax}/${rule.from}` : `?${broadest}`;
    const group = groups.get(key);
    if (group) {
      group.parts.push(part.code);
      if (group.rate !== null) group.rate = round(group.rate + (group.treatment === "taxable" ? part.rate : 0));
      continue;
    }
    if (code === "nontaxable") groups.set(key, { tax: "*", parts: [part.code], treatment: "not_a_sale", rate: 0, rule: NOT_A_SALE });
    else if (!rule) groups.set(key, { tax: broadest, parts: [part.code], treatment: "not_researched", rate: null, rule: null });
    else {
      const { tax, code: _code, notes: _notes, follows: _follows, treatment, ...rest } = rule;
      const decided = treatment as PartTreatment;
      const rate = decided === "taxable" ? part.rate : decided === "conditional" ? null : 0;
      groups.set(key, { tax, parts: [part.code], treatment: decided, rate, rule: { ...rest, treatment: decided } });
    }
  }
  const taxes = [...groups.values()];
  const settled = taxes.every((t) => t.rate !== null);
  const rate = settled ? round(taxes.reduce((sum, t) => sum + t.rate!, 0)) : null;
  const general = round(answer.parts.reduce((sum, p) => sum + p.rate, 0));
  const treatment = taxes.some((t) => t.treatment === "not_researched")
    ? "not_researched"
    : !settled
      ? "conditional"
      : rate === 0
        ? "not_taxed"
        : rate === general
          ? "taxable"
          : "partial";
  return { treatment, rate, taxes };
}

/** One entry per code asked. */
export function taxabilityByCode(answer: Pick<AddressRate, "state" | "parts">, codes: TaxCode[], date: string, rules: RuleSet): Record<string, Taxability> {
  return Object.fromEntries(codes.map((code) => [code, taxabilityOf(answer, code, date, rules)]));
}

/** "food.catering,nontaxable" → codes, or the first word that isn't one. */
export function parseCodes(text: string): { codes: TaxCode[] } | { unknown: string } {
  const codes = [...new Set(text.split(",").map((s) => s.trim()).filter(Boolean))];
  const unknown = codes.find((c) => !Object.hasOwn(TAX_CODES, c));
  return unknown !== undefined ? { unknown } : { codes: codes as TaxCode[] };
}

/** The codes with a rule in force on `date` for every tax a place has;
 *  nontaxable always. For /v1/coverage. */
export function researchedCodes(state: string, parts: RatePart[], date: string, rules: RuleSet): TaxCode[] {
  return (Object.keys(TAX_CODES) as TaxCode[]).filter((code) => taxabilityOf({ state, parts }, code, date, rules).treatment !== "not_researched");
}
