/**
 * How a code (codes.ts) is taxed at an answered address on a date: each
 * part of the rate matched to the dated, cited rule for the code (rules/),
 * the parts grouped by the rule that decided them, and the rate on that
 * sale added up from the parts that tax it.
 *
 * A US state's rule covers every part of its answer, state and local,
 * unless the state has a separate "XX:local" rule for its local parts, or
 * one local part has its own ("CO:local:01:ttr17", Denver's city tax, by
 * the part's code): the most specific rule decides each part. A state's
 * "XX:administered" rule decides its state part and the local taxes it
 * administers, but not a self-collected home-rule city's part
 * (self-collected.ts), which is then not researched unless it has a rule
 * of its own. In
 * Canada each tax has its own rules: the GST reads the federal base; an
 * HST province's HST reads its own rule, which is either the province's
 * own treatment (Ontario's prepared-food rebate) or "follows" the federal
 * base, as checked for that code; the PST, QST or RST is its own. The
 * rules come from the database (rules/index.ts), passed in, and are
 * resolved once per rule set into a table (compile.ts): a part's rule is a
 * lookup by its chain of keys, the code and the date.
 *
 * A part with no rule in force on the date is "not_researched", and then
 * the sale has no rate: it never falls back to the general rate. A rule
 * whose outcome turns on facts the code doesn't fix is "conditional", and
 * lists them; the rate is null until the caller settles them.
 *
 * A special-rate rule may name a class of sale (rateClass: "restaurant",
 * "grocery") instead of a rate: each part it decides is then taxed at that
 * part's own rate for the class, from the state's rate table
 * (RatePart.classRates), so one Arizona rule gives every city its own
 * restaurant rate. A part with no rate for the class on the date is not
 * researched, as a part with no rule is; it never takes its general rate.
 *
 * The rest of the module, behind this file:
 *   codes.ts        the codes, and what each covers
 *   compile.ts      the rules resolved into the table the lookup reads:
 *                   chains of keys, codes, dated segments
 *   rules/          the reviewed rule files (one per place), the watch list
 *                   and certificates the monthly fetch uses, and the table
 *                   loader the lookup reads (index.ts)
 *   ingest.ts       files → checked → taxability_rules, cited pages archived
 *   fetch.ts        the monthly re-download of cited and watched pages
 *   evaluate.ts     the benchmark: the rules against the agencies' examples
 */
import type { AddressRate, RatePart } from "../rates/index.js";
import { TAX_CODES, type TaxCode } from "./codes.js";
import { compiledOf, differs, keysFor } from "./compile.js";
import { loadRules as loadRuleSet, type Condition, type Rule, type RuleSet, type PartTreatment } from "./rules/index.js";

export { TAX_CODES, isTaxCode, parentOf, subcodesOf, type TaxCode } from "./codes.js";
export { ruleSet, type Rule, type RuleSet, type PartTreatment, type Citation, type Condition } from "./rules/index.js";
export { caseWordsOf, compiledOf, type CaseWords, type CompiledRules, type Segment } from "./compile.js";

/** Every rule in the database, read once, and resolved (compiledOf) as it
 *  loads, so no request pays for it. */
export const loadRules = (): Promise<RuleSet> => loadRuleSet().then((rules) => (compiledOf(rules), rules));

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
  /** On a conditional answer, each case the rules list with the sale's
   *  combined rate in it, and the narrower code that is that case, where
   *  one is. Where several taxes turn on facts, their cases are combined
   *  only where they describe the same case (outcomesOf); else each case
   *  is listed for its own tax, and `independent` is set. */
  outcomes?: Outcome[];
  /** The undecided taxes turn on their facts independently: each outcome
   *  is one tax's case (its `tax`), at that case's rate for its tax plus
   *  the settled taxes; combine one case per tax. */
  independent?: true;
}

export interface Outcome {
  when: string;
  rate: number;
  code?: string;
  /** On an independent answer: the tax this case is for. */
  tax?: string;
}

/** At most this many combinations are listed; past it, none are. */
const MOST_OUTCOMES = 24;

const NOT_A_SALE: ShownRule = {
  from: "0000-01-01",
  fromIs: "effective",
  treatment: "not_a_sale",
  summary: "Not a sale of anything, as the caller says; no jurisdiction's rules are consulted.",
  conditions: [],
  citations: [],
};

/** What `parts` add to the sale's rate under a rule or case `k`, on the
 *  whole charge: each part's rate when taxable; a fixed special rate once
 *  for all of them (Utah's 1.25% for all its local taxes on food); each
 *  part's own rate for a class a special rate names; nothing when exempt or
 *  zero-rated; times `base` where only a share of the charge is taxed.
 *  Null when conditional, or when a special rate has no rate, or a part
 *  lacks the class's rate: never the general rate instead. Added part by
 *  part, rounded at each step after the first. */
function rateOf(k: Pick<Rule, "rate" | "rateClass" | "base"> & { treatment: string }, parts: RatePart[]): number | null {
  const base = k.base ?? 1;
  const shareOf = (part: RatePart, i: number): number | null => {
    if (k.treatment === "taxable") return part.rate * base;
    if (k.treatment === "special_rate" && k.rateClass) {
      const own = part.classRates?.[k.rateClass];
      return own === undefined ? null : own * base;
    }
    if (k.treatment === "special_rate") return k.rate === undefined ? null : i ? 0 : k.rate * base;
    return k.treatment === "conditional" ? null : 0;
  };
  let sum: number | null = null;
  for (const [i, part] of parts.entries()) {
    const add = shareOf(part, i);
    if (add === null) return null;
    sum = i ? round(sum! + add) : add;
  }
  return sum ?? (k.treatment === "special_rate" && k.rate !== undefined ? k.rate * base : 0);
}

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
  const members = new Map<string, { rule: Rule | null; parts: RatePart[] }>();
  for (const part of answer.parts) {
    const found = compiledOf(rules).ruleFor(state, part, code, date);
    // A rule naming a class answers only for a part with that class's rate,
    // or conditionally on the cases its rate turns on (classCases).
    const cases = found?.treatment === "special_rate" && found.rateClass && rateOf(found, [part]) === null ? part.classCases?.[found.rateClass] : undefined;
    const rule = cases?.length ? onCases(found!, cases) : found && (found.treatment !== "special_rate" || rateOf(found, [part]) !== null) ? found : null;
    // Unresearched parts group by the broadest key they'd answer to: a
    // state's parts together, each Canadian tax on its own.
    const broadest = keysFor(state, part).at(-1)!;
    // One rule decides each group; a rule made for this part (conditional
    // on a narrower code's local rule) shares its tax and day, not its answer.
    // A part conditional on its own class cases is a group of its own.
    const key = rule ? `${rule.tax}/${rule.from}/${rule.treatment}${cases?.length ? `/${part.code}` : ""}` : `?${broadest}`;
    const group = groups.get(key);
    if (group) {
      group.parts.push(part.code);
      members.get(key)!.parts.push(part);
      continue;
    }
    members.set(key, { rule, parts: [part] });
    if (!rule) groups.set(key, { tax: broadest, parts: [part.code], treatment: "not_researched", rate: null, rule: null });
    else {
      const { tax, code: _code, notes: _notes, follows: _follows, treatment, ...rest } = rule;
      const decided = treatment as PartTreatment;
      groups.set(key, { tax, parts: [part.code], treatment: decided, rate: null, rule: { ...rest, treatment: decided } });
    }
  }
  // The first part's rule rates the group, as it is shown.
  for (const [key, { rule, parts }] of members) if (rule) groups.get(key)!.rate = rateOf(rule, parts);
  return answerOf([...groups.values()], answer.parts);
}

/** The sale's answer from its groups: its treatment, its rate when every
 *  group is settled, and a conditional answer's cases. */
function answerOf(taxes: TaxGroup[], parts: RatePart[]): Taxability {
  const settled = taxes.every((t) => t.rate !== null);
  const rate = settled ? round(taxes.reduce((sum, t) => sum + t.rate!, 0)) : null;
  const general = round(parts.reduce((sum, p) => sum + p.rate, 0));
  const treatment = taxes.some((t) => t.treatment === "not_researched")
    ? "not_researched"
    : !settled
      ? "conditional"
      : rate === 0
        ? "not_taxed"
        : rate === general
          ? "taxable"
          : "partial";
  const cases = treatment === "conditional" ? outcomesOf(taxes, parts) : undefined;
  return { treatment, rate, taxes, ...(cases?.outcomes.length ? { outcomes: cases.outcomes, ...(cases.independent ? { independent: true as const } : {}) } : {}) };
}

/** A conditional answer's cases, each with the sale's combined rate: the
 *  settled taxes' rates plus, for each undecided tax, one of its
 *  conditions at that tax's parts' rate (a condition's own rate when it
 *  sets one, counted once; nothing when exempt or zero-rated; times its
 *  base where only a share of the charge is taxed).
 *
 *  Where several taxes are undecided, their conditions are combined only
 *  where they describe the same case (sameCase): never a state's "whole
 *  uncooked pizza" with a local "taxable meal". When every condition of
 *  every undecided tax pairs that way, each outcome is one such case.
 *  Otherwise the taxes turn on their facts independently, and each
 *  condition is its own outcome, for its tax, with the settled taxes. */
/** A rule naming a class, for a part whose rate for it turns on the cases
 *  its publisher states: conditional on them, each at its own rate. */
const onCases = (rule: Rule, cases: Array<{ when: string; rate: number }>): Rule => {
  const { rateClass: _, ...rest } = rule;
  return { ...rest, treatment: "conditional", conditions: cases.map((c) => ({ when: c.when, treatment: "special_rate", rate: c.rate, ...(rule.base !== undefined ? { base: rule.base } : {}) })) };
};

/** What one undecided tax adds to the sale's rate in case `k` (rateOf on
 *  its parts); null where it can't be computed. */
const shareOf = (t: TaxGroup, k: Condition, parts: RatePart[]) => rateOf(k, t.parts.flatMap((code) => parts.find((p) => p.code === code) ?? []));

function outcomesOf(taxes: TaxGroup[], parts: RatePart[]): { outcomes: Outcome[]; independent?: true } {
  const none = { outcomes: [] };
  const fixed = taxes.reduce((sum, t) => sum + (t.rate ?? 0), 0);
  const share = (t: TaxGroup, k: Condition) => shareOf(t, k, parts) ?? NaN;
  const open = taxes.filter((t) => t.treatment === "conditional").map((t) => ({ tax: t, conditions: t.rule?.conditions ?? [] }));
  if (!open.length || open.some((o) => !o.conditions.length)) return none;
  const done = (outcomes: Outcome[], independent?: true) =>
    outcomes.length > MOST_OUTCOMES || outcomes.some((o) => Number.isNaN(o.rate)) ? none : { outcomes: outcomes.map((o) => ({ ...o, rate: round(o.rate) })), ...(independent ? { independent } : {}) };
  const paired = pairedCases(open.map((o) => o.conditions));
  if (paired)
    return done(paired.map((picked) => {
      const codes = new Set(picked.map((k) => k.code));
      const [only] = codes;
      return {
        when: whenOf(picked, open.map((o) => o.tax.tax)),
        rate: fixed + picked.reduce((sum, k, i) => sum + share(open[i].tax, k), 0),
        ...(codes.size === 1 && only ? { code: only } : {}),
      };
    }));
  return done(
    open.flatMap(({ tax, conditions }) =>
      conditions.map((k) => ({ when: `${tax.tax}: ${k.when}`, rate: fixed + share(tax, k), ...(k.code ? { code: k.code } : {}), tax: tax.tax })),
    ),
    true,
  );
}

const normal = (when: string) => when.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

/** `narrow` is `broad` with a further fact after a semicolon: "A taxable
 *  meal ...; in a town that levies the 1% local option meals tax" is a
 *  case of "A taxable meal ...". */
const refines = (narrow: string, broad: string) => {
  const pieces = narrow.split(";");
  return pieces.slice(1).some((_, i) => normal(pieces.slice(0, i + 1).join(";")) === normal(broad));
};

/** Two taxes' conditions say the same case in the same words (normalized),
 *  or one says it with a further fact. */
const sameWords = (a: Condition, b: Condition) => normal(a.when) === normal(b.when) || refines(a.when, b.when) || refines(b.when, a.when);

/** Each tax's conditions combined case by case, where every condition of
 *  each tax pairs with the cases built so far: in the same words, else (no
 *  condition of that tax in the same words) the same narrower code. Null
 *  where some condition pairs with none, or some case with no condition of
 *  a tax: then the taxes are independent. */
function pairedCases(lists: Condition[][]): Condition[][] | null {
  let cases: Condition[][] = lists[0].map((k) => [k]);
  for (const list of lists.slice(1)) {
    const next: Condition[][] = [];
    const used = new Set<Condition>();
    for (const c of cases) {
      let found = list.filter((k) => c.every((p) => sameWords(p, k) && (!p.code || !k.code || p.code === k.code)));
      if (!found.length) found = list.filter((k) => k.code && c.every((p) => p.code === k.code));
      if (!found.length) return null;
      for (const k of found) {
        used.add(k);
        next.push([...c, k]);
      }
    }
    if (used.size < list.length) return null;
    cases = next;
  }
  return cases;
}

/** A paired case's words: its one wording, or the most specific where one
 *  refines the others; else each tax's, joined. */
function whenOf(picked: Condition[], taxNames: string[]): string {
  if (picked.length === 1) return picked[0].when;
  const longest = [...picked].sort((a, b) => b.when.length - a.when.length)[0];
  if (picked.every((k) => k === longest || normal(k.when) === normal(longest.when) || refines(longest.when, k.when))) return longest.when;
  return picked.map((k, i) => `${taxNames[i]}: ${k.when}`).join("; and ");
}

/** A conditional answer's undecided taxes (by index in `taxes`) and the
 *  cases a description can settle them by, as outcomesOf combines them:
 *  "paired", one list of cases for all of them together, each case one
 *  condition per tax; or "independent", each tax's conditions on their
 *  own. Null when nothing is undecided, or a tax lists no conditions. */
export type OpenCases =
  | { kind: "paired"; taxes: number[]; cases: Condition[][] }
  | { kind: "independent"; taxes: number[]; cases: Condition[][] };

export function openCasesOf(t: Taxability): OpenCases | null {
  const taxes = t.taxes.flatMap((g, i) => (g.treatment === "conditional" ? [i] : []));
  const lists = taxes.map((i) => t.taxes[i].rule?.conditions ?? []);
  if (!taxes.length || lists.some((l) => !l.length)) return null;
  const paired = pairedCases(lists);
  return paired ? { kind: "paired", taxes, cases: paired } : { kind: "independent", taxes, cases: lists };
}

/** What settling tax group `t` by case `k` adds to the sale's rate: the
 *  same share its outcome counts. Null where it can't be computed. */
export function caseRate(t: TaxGroup, k: Condition, parts: RatePart[]): number | null {
  const share = shareOf(t, k, parts);
  return share === null ? null : round(share);
}

/** `t` with some taxes settled, each by one of its own rule's cases
 *  (index in `t.taxes` → condition): an undecided tax's case, or the
 *  exception a settled rule lists. That tax's treatment and rate become
 *  the case's, its rule stays as cited, and the sale's treatment, rate and
 *  outcomes are recomputed from the groups, exactly as an outcome counts
 *  them. A case whose rate can't be computed leaves its tax as it was. */
export function settleCases(t: Taxability, parts: RatePart[], picks: Map<number, Condition>): Taxability {
  const taxes = t.taxes.map((g, i) => {
    const k = picks.get(i);
    const rate = k && g.rule && g.treatment !== "not_a_sale" && g.treatment !== "not_researched" ? caseRate(g, k, parts) : null;
    return k && rate !== null ? { ...g, treatment: k.treatment, rate } : g;
  });
  return answerOf(taxes, parts);
}

/** `t` with some settled taxes made conditional on their rule's usual
 *  case (`usual`, at the rule's own treatment) or one of the exceptions it
 *  lists: where a description makes an exception likely without settling
 *  it. The sale's treatment, rate and outcomes are recomputed. */
export function reopenCases(t: Taxability, parts: RatePart[], reopen: Set<number>, usual: string): Taxability {
  const taxes = t.taxes.map((g, i) => {
    const rule = g.rule;
    if (!reopen.has(i) || !rule || !["taxable", "special_rate", "exempt", "zero_rated"].includes(rule.treatment)) return g;
    const main: Condition = {
      when: usual,
      treatment: rule.treatment as Condition["treatment"],
      ...(rule.rate !== undefined ? { rate: rule.rate } : {}),
      ...(rule.rateClass ? { rateClass: rule.rateClass } : {}),
      ...(rule.base !== undefined ? { base: rule.base } : {}),
    };
    const exceptions = rule.conditions.filter((k) => differs(k, rule as Rule));
    return { ...g, treatment: "conditional" as const, rate: null, rule: { ...rule, treatment: "conditional" as const, conditions: [main, ...exceptions] } };
  });
  return answerOf(taxes, parts);
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
