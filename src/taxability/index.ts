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
 * rules come from the database (rules/index.ts), passed in, so the
 * resolver itself is a pure function.
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
 *   rules/          the reviewed rule files (one per place), the watch list
 *                   and certificates the monthly fetch uses, and the table
 *                   loader the lookup reads (index.ts)
 *   ingest.ts       files → checked → taxability_rules, cited pages archived
 *   fetch.ts        the monthly re-download of cited and watched pages
 *   evaluate.ts     the benchmark: the rules against the agencies' examples
 */
import type { AddressRate, RatePart } from "../rates/index.js";
import type { RateClass } from "../rates/types.js";
import { isTaxCode, parentOf, subcodesOf, TAX_CODES, type TaxCode } from "./codes.js";
import { selfCollected } from "./self-collected.js";
import { ruleOn, type Condition, type Rule, type RuleSet, type PartTreatment } from "./rules/index.js";

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

/** The rule keys a part answers to, most specific first. */
function keysFor(state: string, part: RatePart): string[] {
  if (part.code === "CA:GST") return ["CA:GST/HST"];
  // An HST province's own rule, or its "follows" rule; never the federal
  // base unchecked.
  if (part.code === "CA:HST") return [`${state}/CA:HST`];
  if (/^[A-Z]{2}:(PST|QST|RST)$/.test(part.code)) return [part.code];
  // "XX:state" and "XX:local" decide one side only; "XX" both, where
  // they share the base. "XX:local:<part code>" decides one local part,
  // where that jurisdiction sets its own base or rate (a home-rule city).
  // "XX:administered" decides the state part and the local taxes the state
  // administers, never a self-collected city's (self-collected.ts).
  if (part.kind === "state") return [`${state}:state`, `${state}:administered`, state];
  return [`${state}:local:${part.code}`, `${state}:local`, ...(selfCollected(state, part.code) ? [] : [`${state}:administered`]), state];
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
function withNarrower(rules: RuleSet, taxes: string[], tax: string, code: TaxCode, date: string, broad: Rule): Rule | null {
  const owns = (Object.keys(TAX_CODES) as TaxCode[])
    .filter((c) => c.startsWith(`${code}.`))
    .flatMap((c) => taxes.flatMap((t) => {
      const own = ruleOn(rules, t, c, date);
      return own ? [{ code: c, rule: own }] : [];
    }));
  // A kind treated as the broad code is still has its own exceptions:
  // they stay in the answer, as a settled rule's do.
  const rule = withKindExceptions(broad, owns.filter((n) => !differs(n.rule, broad)));
  const narrower = owns.filter((n) => differs(n.rule, broad));
  if (!narrower.length) return rule;
  const rest = settle(rules, rule, code, date);
  const kinds = narrower.map((n) => [kind(n.code), settle(rules, n.rule, n.code, date), n.code] as const);
  if (!rest || kinds.some(([, r]) => !r)) return null;
  const otherCode = `${code}.other`;
  const other: Kind = isTaxCode(otherCode) ? [`${otherCode}: any other kind of ${code}`, rest, otherCode] : [`Any other kind of ${code}`, rest];
  return dependsOn(tax, code, [...(kinds as unknown as Kind[]), other], [rest, ...kinds.map(([, r]) => r!)]);
}

/** `rule` with the exceptions of `kinds`, narrower codes it settles alike,
 *  each named by its kind and code. */
function withKindExceptions(rule: Rule, kinds: Array<{ code: TaxCode; rule: Rule }>): Rule {
  const more = kinds.flatMap((k) => (k.rule.treatment === "conditional" ? [] : conditionsOf(kind(k.code), k.rule, k.code).slice(1)));
  if (!more.length) return rule;
  const all = [rule, ...kinds.map((k) => k.rule)];
  return { ...rule, ...windowOf(all), conditions: [...rule.conditions, ...more], citations: citationsOf(all) };
}

/** Two rules don't settle a code the same way. */
const differs = (a: Pick<Rule, "treatment" | "rate" | "rateClass" | "base" | "follows">, b: Pick<Rule, "treatment" | "rate" | "rateClass" | "base" | "follows">) =>
  a.treatment !== b.treatment || a.rate !== b.rate || a.rateClass !== b.rateClass || a.base !== b.base || a.follows !== b.follows || a.treatment === "conditional";

const kind = (c: TaxCode) => `${c}: ${TAX_CODES[c].replace(/\.$/, "")}`;

/** One kind of a broad code: its label, its rule, and the code to send
 *  for it, where there is one. */
type Kind = readonly [label: string, rule: Rule, code?: TaxCode];

/** A rule conditional on which kind of `code` it is, one labelled rule per
 *  kind; its dates are those all of `cited` share. */
function dependsOn(tax: string, code: TaxCode, kinds: Kind[], cited = kinds.map(([, r]) => r)): Rule {
  return {
    tax,
    code,
    ...windowOf(cited),
    treatment: "conditional",
    summary: `Depends on which kind of ${code} it is; send the narrower code to settle it.`,
    conditions: kinds.flatMap(([label, r, c]) => conditionsOf(label, r, c)),
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
function conditionsOf(label: string, r: Rule, code?: TaxCode): Rule["conditions"] {
  const send = code ? { code } : {};
  // The residual kind withNarrower makes ("<code>.other: any other kind
  // of <code>", "Any other kind of <code>"): what the listed kinds aren't.
  const residual = /any other kind of ([a-z_.]+)$/i.exec(label)?.[1];
  const residualOf = residual && isTaxCode(residual) ? residual : undefined;
  const words = (k: Condition, inner?: Condition, exception?: true) => {
    caseWords.set(k, { kind: label, ...(code ? { code } : {}), ...(residualOf ? { residualOf } : {}), ...(inner ? { inner } : {}), ...(exception ? { exception } : {}) });
    return k;
  };
  if (r.treatment === "conditional") return r.conditions.map((c) => words({ ...c, when: `${label}: ${c.when}`, ...send }, c));
  return [
    words({ when: label, treatment: r.treatment as "taxable" | "exempt" | "zero_rated" | "special_rate", ...(r.rate !== undefined ? { rate: r.rate } : {}), ...(r.rateClass ? { rateClass: r.rateClass } : {}), ...(r.base !== undefined ? { base: r.base } : {}), ...send }),
    ...r.conditions.filter((c) => differs(c, r)).map((c) => words({ ...c, when: `${label}, except ${c.when.charAt(0).toLowerCase()}${c.when.slice(1)}`, ...send }, c, true)),
  ];
}

/** How a broad code's case was put together from a narrower kind's rule:
 *  the kind's label and code, and the kind's own case (`inner`), or the
 *  exception to its settled treatment. Kept beside the case, never in the
 *  answer, for reading the case as words (describe.ts). */
export interface CaseWords {
  kind: string;
  code?: TaxCode;
  /** The residual kind of this broad code: none of the kinds listed. */
  residualOf?: TaxCode;
  inner?: Condition;
  exception?: true;
}
const caseWords = new WeakMap<Condition, CaseWords>();
export const caseWordsOf = (k: Condition): CaseWords | undefined => caseWords.get(k);

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
  return fromKinds(tax, code, subs, found);
}

/** A broad code's rule from one rule per subcode: settled where every kind
 *  is treated alike, else conditional on which kind it is. */
function fromKinds(tax: string, code: TaxCode, subs: TaxCode[], found: Rule[]): Rule {
  const first = found[0];
  if (found.every((r) => r.treatment === first.treatment && r.treatment !== "conditional" && r.rate === first.rate && r.rateClass === first.rateClass && r.base === first.base))
    return withKindExceptions(
      { tax, code, ...windowOf(found), treatment: first.treatment, ...(first.rate !== undefined ? { rate: first.rate } : {}), ...(first.rateClass ? { rateClass: first.rateClass } : {}), ...(first.base !== undefined ? { base: first.base } : {}), summary: `Every kind of ${code} is treated alike here: ${first.summary}`, conditions: [], citations: citationsOf(found) },
      found.map((r, i) => ({ code: subs[i], rule: r })),
    );
  return dependsOn(tax, code, found.map((r, i): Kind => [kind(subs[i]), r, subs[i]]));
}

/** `key` has a rule of its own for `code` or a broader code on `date`. */
function hasOwn(rules: RuleSet, key: string, code: TaxCode, date: string): boolean {
  for (let c: TaxCode | null = code; c; c = parentOf(c)) if (ruleOn(rules, key, c, date)) return true;
  return false;
}

/** Some code narrower than `code` has a rule of its own under one of `keys`. */
const narrowerUnder = (rules: RuleSet, keys: string[], code: TaxCode, date: string) =>
  (Object.keys(TAX_CODES) as TaxCode[]).some((c) => c.startsWith(`${code}.`) && keys.some((k) => ruleOn(rules, k, c, date)));

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
    // A broad code this key answers only from its subcodes' rules, while a
    // more specific key has a rule for one of them (a local platter rule):
    // each kind answers from its own most specific rule, and the result is
    // the most specific such key's, so this part isn't grouped with the
    // parts the broader key decides alone (nor with parts another key does).
    const narrower = i && !hasOwn(rules, key, code, date) && subcodesOf(code).length ? keys.slice(0, i).find((k) => narrowerUnder(rules, [k], code, date)) : undefined;
    if (narrower) {
      const subs = subcodesOf(code);
      const each = subs.map((sub) => ruleFor(rules, state, part, sub, date));
      if (each.some((r) => !r)) return null;
      return fromKinds(narrower, code, subs, each as Rule[]);
    }
    const settled = settle(rules, found, code, date);
    return settled && i ? withNarrower(rules, keys.slice(0, i), key, code, date, settled) : settled;
  }
  return null;
}

/** What one part adds to the sale's rate under `treatment`, on the whole
 *  charge: where the rule taxes only a share of it (`base`), the rate times
 *  that share. A special-rate rule's rate is the rate of every part it
 *  decides together (Utah's 1.25% for all its local taxes on food), so only
 *  the first of them adds it; a rule naming a class adds each part's own
 *  rate for it. */
const partRate = (treatment: PartTreatment, part: RatePart, rule: Rule | null, first = true): number | null => {
  const base = rule?.base ?? 1;
  if (treatment === "taxable") return part.rate * base;
  if (treatment === "special_rate" && rule?.rateClass) return classRate(part, rule.rateClass) * base;
  if (treatment === "special_rate") return first ? (rule?.rate !== undefined ? rule.rate * base : null) : 0;
  return treatment === "conditional" ? null : 0;
};

/** A part's rate for a class of sale; NaN where none is loaded. */
const classRate = (part: RatePart, rateClass: RateClass) => part.classRates?.[rateClass] ?? NaN;

/** `rule` can answer for `part`: a rule naming a class needs the part's
 *  rate for it, which a part without one lacks (then not researched). */
const answers = (rule: Rule, part: RatePart) => !(rule.treatment === "special_rate" && rule.rateClass && part.classRates?.[rule.rateClass] === undefined);

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
    const found = ruleFor(rules, state, part, code, date);
    const rule = found && answers(found, part) ? found : null;
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
/** What one undecided tax adds to the sale's rate in case `k`: its parts'
 *  full rate when taxable, the case's own rate (once) when special, else
 *  nothing; times the case's base. NaN for a special case with no rate. */
function shareOf(t: TaxGroup, k: Condition, parts: RatePart[]): number {
  const these = t.parts.flatMap((code) => parts.find((p) => p.code === code) ?? []);
  const full = these.reduce((sum, p) => sum + p.rate, 0);
  // A case naming a class: each part's own rate for it, NaN where one lacks it.
  const special = k.rateClass ? these.reduce((sum, p) => sum + classRate(p, k.rateClass!), 0) : (k.rate ?? NaN);
  return (k.treatment === "taxable" ? full : k.treatment === "special_rate" ? special : 0) * (k.base ?? 1);
}

function outcomesOf(taxes: TaxGroup[], parts: RatePart[]): { outcomes: Outcome[]; independent?: true } {
  const none = { outcomes: [] };
  const fixed = taxes.reduce((sum, t) => sum + (t.rate ?? 0), 0);
  const share = (t: TaxGroup, k: Condition) => shareOf(t, k, parts);
  const open = taxes.filter((t) => t.treatment === "conditional").map((t) => ({ tax: t, conditions: t.rule?.conditions ?? [] }));
  if (open.some((o) => !o.conditions.length)) return none;
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
  return Number.isNaN(share) ? null : round(share);
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
