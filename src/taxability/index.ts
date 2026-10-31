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
import { isTaxCode, parentOf, subcodesOf, TAX_CODES, type TaxCode } from "./codes.js";
import { ruleOn, type Rule, type RuleSet, type PartTreatment } from "./rules/index.js";

export { TAX_CODES, isTaxCode, parentOf, subcodesOf, type TaxCode } from "./codes.js";
export { loadRules, ruleSet, type Rule, type RuleSet, type PartTreatment, type Citation, type Condition } from "./rules/index.js";

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
  /** taxable: every part at its rate; partial: some parts, or a special
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
  if (part.code === "CA:GST") return ["CA:GST/HST"];
  // An HST province's own rule, or its "follows" rule; never the federal
  // base unchecked.
  if (part.code === "CA:HST") return [`${state}/CA:HST`];
  if (/^[A-Z]{2}:(PST|QST|RST)$/.test(part.code)) return [part.code];
  // "XX:state" and "XX:local" decide one side only; "XX" both, where
  // they share the base.
  return part.kind === "state" ? [`${state}:state`, state] : [`${state}:local`, state];
}

/** A rule researched only from a later day (fromIs "earliest_verified"):
 *  before it, how the code was treated isn't known, so it isn't
 *  inherited from a broader rule either. */
const unknownBefore = (rules: RuleSet, tax: string, code: TaxCode, date: string) => {
  const first = rules.get(`${tax}|${code}`)?.[0];
  return first !== undefined && date < first.from && first.fromIs === "earliest_verified";
};

/** The rule for `code` under one tax: the code's own, else its nearest
 *  parent's (a parent's rule covers every kind under it), else, for a
 *  code with subcodes and no rule of its own, one settled from them.
 *  Conditional on the kind when a narrower code is treated differently.
 *  Null when any of that is missing. */
function ruleForCode(rules: RuleSet, tax: string, code: TaxCode, date: string): Rule | null {
  let base: Rule | null = null;
  for (let c: TaxCode | null = code; c && !base; c = parentOf(c)) {
    base = ruleOn(rules, tax, c, date);
    if (!base && unknownBefore(rules, tax, c, date)) return null;
  }
  if (!base) return fromSubcodes(rules, tax, code, date);
  return withNarrower(rules, [tax], tax, code, date, base);
}

/** `rule` for `code`, unless a narrower code has a rule of its own under
 *  one of `taxes` that treats it differently (Kentucky's lobbying, taxed
 *  under exempt professional services; a local tax's own rule for one
 *  kind): then conditional on which kind it is. */
function withNarrower(rules: RuleSet, taxes: string[], tax: string, code: TaxCode, date: string, rule: Rule): Rule | null {
  const narrower = (Object.keys(TAX_CODES) as TaxCode[])
    .filter((c) => c.startsWith(`${code}.`))
    .flatMap((c) => taxes.flatMap((t) => {
      const own = ruleOn(rules, t, c, date);
      return own && differs(own, rule) ? [{ code: c, rule: own }] : [];
    }));
  if (!narrower.length) return rule;
  const rest = settle(rules, rule, code, date);
  const kinds = narrower.map((n) => [kind(n.code), settle(rules, n.rule, n.code, date)] as const);
  if (!rest || kinds.some(([, r]) => !r)) return null;
  const other = isTaxCode(`${code}.other`) ? `${code}.other: any other kind of ${code}` : `Any other kind of ${code}`;
  return dependsOn(tax, code, [...(kinds as Array<[string, Rule]>), [other, rest]], [rest, ...kinds.map(([, r]) => r!)]);
}

/** Two rules don't settle a code the same way. */
const differs = (a: Pick<Rule, "treatment" | "rate" | "follows">, b: Pick<Rule, "treatment" | "rate" | "follows">) =>
  a.treatment !== b.treatment || a.rate !== b.rate || a.follows !== b.follows || a.treatment === "conditional";

const kind = (c: TaxCode) => `${c}: ${TAX_CODES[c]}`;

/** A rule conditional on which kind of `code` it is, one labelled rule per
 *  kind; its dates are those all of `cited` share. */
function dependsOn(tax: string, code: TaxCode, kinds: Array<[label: string, rule: Rule]>, cited = kinds.map(([, r]) => r)): Rule {
  return {
    tax,
    code,
    ...windowOf(cited),
    treatment: "conditional",
    summary: `Depends on which kind of ${code} it is; send the narrower code to settle it.`,
    conditions: kinds.flatMap(([label, r]) => conditionsOf(label, r)),
    citations: citationsOf(cited),
  };
}

const citationsOf = (rules: Rule[]) => [...new Map(rules.flatMap((r) => r.citations).map((c) => [c.url + (c.quote ?? ""), c])).values()];

/** The dates every one of `rules` is in force together. */
function windowOf(rules: Rule[]): Pick<Rule, "from" | "to" | "fromIs"> {
  return {
    from: rules.map((r) => r.from).sort().at(-1)!,
    ...(rules.some((r) => r.to) ? { to: rules.flatMap((r) => (r.to ? [r.to] : [])).sort()[0] } : {}),
    fromIs: rules.every((r) => r.fromIs === "effective") ? "effective" : "earliest_verified",
  };
}

/** A rule as the conditions of a broader one: its own, labelled; or its
 *  settled treatment, then any exception it lists. */
function conditionsOf(label: string, r: Rule): Rule["conditions"] {
  if (r.treatment === "conditional") return r.conditions.map((c) => ({ ...c, when: `${label}: ${c.when}` }));
  return [
    { when: label, treatment: r.treatment as "taxable" | "exempt" | "zero_rated" | "special_rate", ...(r.rate !== undefined ? { rate: r.rate } : {}) },
    ...r.conditions.filter((c) => differs(c, r)).map((c) => ({ ...c, when: `${label}, except ${c.when}` })),
  ];
}

function fromSubcodes(rules: RuleSet, tax: string, code: TaxCode, date: string): Rule | null {
  const subs = subcodesOf(code);
  if (!subs.length) return null;
  const found: Rule[] = [];
  for (const sub of subs) {
    // The subcode as asked directly, its own narrower codes included (no
    // ancestor has a rule, so only its own and below count).
    const own = ruleForCode(rules, tax, sub, date);
    const settled = own && settle(rules, own, sub, date);
    if (!settled) return null;
    found.push(settled);
  }
  const first = found[0];
  if (found.every((r) => r.treatment === first.treatment && r.treatment !== "conditional" && r.rate === first.rate))
    return { tax, code, ...windowOf(found), treatment: first.treatment, ...(first.rate !== undefined ? { rate: first.rate } : {}), summary: `Every kind of ${code} is treated alike here: ${first.summary}`, conditions: [], citations: citationsOf(found) };
  return dependsOn(tax, code, found.map((r, i) => [kind(subs[i]), r]));
}

/** A "follows" rule as the rule it follows, with its citations added (null
 *  when that's missing); any other rule as it is. */
function settle(rules: RuleSet, rule: Rule, code: TaxCode, date: string): Rule | null {
  if (rule.treatment !== "follows") return rule;
  const followed = ruleForCode(rules, rule.follows!, code, date);
  return followed && followed.treatment !== "follows" ? { ...followed, citations: [...followed.citations, ...rule.citations] } : null;
}

/** The rule deciding `part`: the most specific key with one, conditional
 *  where a more specific key treats a narrower code differently. */
function ruleFor(rules: RuleSet, state: string, part: RatePart, code: TaxCode, date: string): Rule | null {
  const keys = keysFor(state, part);
  for (const [i, key] of keys.entries()) {
    const found = ruleForCode(rules, key, code, date);
    if (!found) continue;
    const settled = settle(rules, found, code, date);
    return settled && i ? withNarrower(rules, keys.slice(0, i), key, code, date, settled) : settled;
  }
  return null;
}

/** What one part adds to the sale's rate under `treatment`. A special-rate
 *  rule's rate is the rate of every part it decides together (Utah's 1.25%
 *  for all its local taxes on food), so only the first of them adds it. */
const partRate = (treatment: PartTreatment, part: RatePart, rule: Rule | null, first = true): number | null =>
  treatment === "taxable" ? part.rate : treatment === "special_rate" ? (first ? (rule?.rate ?? null) : 0) : treatment === "conditional" ? null : 0;

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** How `code` is taxed in `answer` on `date`. */
export function taxabilityOf(answer: Pick<AddressRate, "state" | "parts">, code: TaxCode, date: string, rules: RuleSet): Taxability {
  // Not a sale: no rule is consulted, every part in one group.
  if (code === "nontaxable")
    return { treatment: "not_taxed", rate: 0, taxes: answer.parts.length ? [{ tax: "*", parts: answer.parts.map((p) => p.code), treatment: "not_a_sale", rate: 0, rule: NOT_A_SALE }] : [] };
  const state = answer.state.toUpperCase();
  // Parts grouped by the rule that decided them, in the order the parts
  // come; a part with no rule is its own group.
  const groups = new Map<string, TaxGroup>();
  for (const part of answer.parts) {
    const rule = ruleFor(rules, state, part, code, date);
    // Unresearched parts group by the broadest key they'd answer to: a
    // state's parts together, each Canadian tax on its own.
    const broadest = keysFor(state, part).at(-1)!;
    // One rule decides each group; a rule made for this part (conditional
    // on a narrower code's local rule) shares its tax and day, not its answer.
    const key = rule ? `${rule.tax}/${rule.from}/${rule.treatment}` : `?${broadest}`;
    const group = groups.get(key);
    if (group) {
      group.parts.push(part.code);
      const add = partRate(group.treatment as PartTreatment, part, rule, false);
      group.rate = group.rate === null || add === null ? null : round(group.rate + add);
      continue;
    }
    if (!rule) groups.set(key, { tax: broadest, parts: [part.code], treatment: "not_researched", rate: null, rule: null });
    else {
      const { tax, code: _code, notes: _notes, follows: _follows, treatment, ...rest } = rule;
      const decided = treatment as PartTreatment;
      groups.set(key, { tax, parts: [part.code], treatment: decided, rate: partRate(decided, part, rule), rule: { ...rest, treatment: decided } });
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
