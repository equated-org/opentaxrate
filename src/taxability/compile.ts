/**
 * The rules resolved ahead of time: a lookup table, built once per rule set
 * (loadRules builds it as the rules load), so that a request only looks its
 * rule up. Conditions stay data; nothing here is evaluated per request.
 *
 * A part asks a **chain** of keys, most specific first (keysFor; only the
 * keys that have rules): a state part "XX:state", "XX:administered", "XX";
 * a local part its own "XX:local:<part code>", then "XX:local",
 * "XX:administered" (not for a self-collected city), "XX"; a Canadian tax
 * its own key. Parts with no rule of their own share their state's chain.
 *
 * For each chain and code the table holds **segments**: the days over which
 * the rule deciding that code doesn't change, and that rule (null where none
 * does). A segment starts on every day a rule that can change the answer
 * starts or stops: one under a key of the chain, or a key one of them
 * follows, for the code, a broader code or a narrower one. Adjacent equal
 * segments are merged.
 *
 * What a segment holds is decided by one procedure, resolverOn, asked on the
 * segment's first day:
 *   1. one key's rule for a code (keyRule): the code's own rule, else its
 *      nearest broader code's, unless a code on the way is researched only
 *      from a later day (then none); combined with the narrower kinds' own
 *      rules (withKinds): settled where every kind is treated as the broad
 *      rule, keeping the kinds' exceptions, else conditional on the kind.
 *      With no rule above it, a code with subcodes is settled from them
 *      (fromKinds), alike or conditional on the kind;
 *   2. the chain's rule (chainRule): the most specific key with a rule,
 *      a "follows" rule settled as the rule it follows, combined with the
 *      more specific keys' own rules for narrower kinds (withKinds again);
 *      but where that key answers only from its kinds while a more specific
 *      key has a rule for one of them, kind by kind from the chain
 *      (fromKinds), as the most specific such key's; and none at all
 *      before a one-jurisdiction key's earliest verified day.
 */
import type { RatePart } from "../rates/index.js";
import { isTaxCode, parentOf, subcodesOf, TAX_CODES, type TaxCode } from "./codes.js";
import { SELF_COLLECTED, selfCollected } from "./self-collected.js";
import { parseTaxKey, ruleOn, type Condition, type Rule, type RuleSet } from "./rules/index.js";

const CODES = Object.keys(TAX_CODES) as TaxCode[];

/** The rule keys a part answers to, most specific first. */
export function keysFor(state: string, part: Pick<RatePart, "kind" | "code">): string[] {
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

/** The days a chain's rule for a code holds unchanged: from `from` (absent:
 *  always before) to `to` (absent: open-ended), and that rule, null where
 *  none decides. */
export interface Segment {
  from?: string;
  to?: string;
  rule: Rule | null;
}

/** The compiled table. */
export interface CompiledRules {
  /** The rule deciding `part` for `code` on `date`. */
  ruleFor(state: string, part: RatePart, code: TaxCode, date: string): Rule | null;
  /** The chain `part` asks. */
  chainOf(state: string, part: Pick<RatePart, "kind" | "code">): string[];
  /** The segments for a chain and code (compiled on first use for a chain
   *  not listed in `chains`). */
  segments(chain: string[], code: TaxCode): Segment[];
  /** Every chain a part can ask, each compiled for every code. */
  chains: string[][];
}

/** Two rules don't settle a code the same way. */
export const differs = (a: Pick<Rule, "treatment" | "rate" | "rateClass" | "base" | "follows">, b: Pick<Rule, "treatment" | "rate" | "rateClass" | "base" | "follows">) =>
  a.treatment !== b.treatment || a.rate !== b.rate || a.rateClass !== b.rateClass || a.base !== b.base || a.follows !== b.follows || a.treatment === "conditional";

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

/** `rule` with the exceptions of `kinds`, narrower codes it settles alike,
 *  each named by its kind and code. */
function withKindExceptions(rule: Rule, kinds: Array<{ code: TaxCode; rule: Rule }>): Rule {
  const more = kinds.flatMap((k) => (k.rule.treatment === "conditional" ? [] : conditionsOf(kind(k.code), k.rule, k.code).slice(1)));
  if (!more.length) return rule;
  const all = [rule, ...kinds.map((k) => k.rule)];
  return { ...rule, ...windowOf(all), conditions: [...rule.conditions, ...more], citations: citationsOf(all) };
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
  // The residual kind withKinds makes ("<code>.other: any other kind of
  // <code>", "Any other kind of <code>"): what the listed kinds aren't.
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

/** The keys whose rules are one jurisdiction's or one set of taxes' own,
 *  so that an unverified earlier period isn't filled from a broader key:
 *  "XX:local:<part code>" and "XX:administered". */
const ownScope = (key: string) => ["part", "administered"].includes(parseTaxKey(key)?.scope ?? "");

/** Each code's narrower codes at every depth, in TAX_CODES order. */
const NARROWER = new Map(CODES.map((code) => [code, CODES.filter((c) => c.startsWith(`${code}.`))]));
/** Each code with its broader and narrower codes: every code whose rules
 *  can change its answer. */
const RELATED = new Map(CODES.map((code) => [code, CODES.filter((c) => c === code || code.startsWith(`${c}.`) || c.startsWith(`${code}.`))]));

/** How the rules decide on one day. See the top of this file. */
function resolverOn(rules: RuleSet, date: string) {
  const own = (key: string, code: TaxCode) => ruleOn(rules, key, code, date);
  /** Researched only from a later day (fromIs "earliest_verified"): before
   *  it, how the code was treated isn't known, so it isn't inherited from a
   *  broader rule either. */
  const unknown = (key: string, code: TaxCode) => {
    const first = rules.get(`${key}|${code}`)?.[0];
    return first !== undefined && date < first.from && first.fromIs === "earliest_verified";
  };

  /** `key`'s own rule for `code` or its nearest broader code; "unknown"
   *  where a code on the way is researched only from a later day. */
  const inherited = (key: string, code: TaxCode): Rule | "unknown" | null => {
    for (let c: TaxCode | null = code; c; c = parentOf(c)) {
      const rule = own(key, c);
      if (rule) return rule;
      if (unknown(key, c)) return "unknown";
    }
    return null;
  };

  /** The narrower codes with a rule of their own under one of `keys`. */
  const ownKinds = (keys: string[], code: TaxCode) =>
    NARROWER.get(code)!.flatMap((c) =>
      keys.flatMap((k) => {
        const rule = own(k, c);
        return rule ? [{ code: c, rule }] : [];
      }),
    );

  /** A "follows" rule as the rule it follows, with its citations added (null
   *  when that's missing); any other rule as it is. */
  const settle = (rule: Rule, code: TaxCode): Rule | null => {
    if (rule.treatment !== "follows") return rule;
    const followed = keyRule(rule.follows!, code);
    return followed && followed.treatment !== "follows" ? { ...followed, citations: [...followed.citations, ...rule.citations] } : null;
  };

  /** `broad` for `code` as `tax` decides it, unless a narrower code's own
   *  rule under one of `keys` treats it differently (Kentucky's lobbying,
   *  taxed under exempt professional services; a local tax's own rule for
   *  one kind): then conditional on which kind it is, any other kind as
   *  `broad`. A kind treated as `broad` is keeps its exceptions. */
  const withKinds = (keys: string[], tax: string, code: TaxCode, broad: Rule): Rule | null => {
    const owns = ownKinds(keys, code);
    const rule = withKindExceptions(broad, owns.filter((n) => !differs(n.rule, broad)));
    const narrower = owns.filter((n) => differs(n.rule, broad));
    if (!narrower.length) return rule;
    const rest = settle(rule, code);
    const kinds = narrower.map((n) => [kind(n.code), settle(n.rule, n.code), n.code] as const);
    if (!rest || kinds.some(([, r]) => !r)) return null;
    const otherCode = `${code}.other`;
    const other: Kind = isTaxCode(otherCode) ? [`${otherCode}: any other kind of ${code}`, rest, otherCode] : [`Any other kind of ${code}`, rest];
    return dependsOn(tax, code, [...(kinds as unknown as Kind[]), other], [rest, ...kinds.map(([, r]) => r!)]);
  };

  /** A broad code's rule from one rule per subcode (`each`), null where
   *  one is missing or the code has none: settled where every kind is
   *  treated alike, else conditional on which kind it is. */
  const fromKinds = (tax: string, code: TaxCode, each: (sub: TaxCode) => Rule | null): Rule | null => {
    const subs = subcodesOf(code);
    if (!subs.length) return null;
    const found: Rule[] = [];
    for (const sub of subs) {
      const rule = each(sub);
      if (!rule) return null;
      found.push(rule);
    }
    const first = found[0];
    if (found.every((r) => !differs(r, first)))
      return withKindExceptions(
        { tax, code, ...windowOf(found), treatment: first.treatment, ...(first.rate !== undefined ? { rate: first.rate } : {}), ...(first.rateClass ? { rateClass: first.rateClass } : {}), ...(first.base !== undefined ? { base: first.base } : {}), summary: `Every kind of ${code} is treated alike here: ${first.summary}`, conditions: [], citations: citationsOf(found) },
        found.map((r, i) => ({ code: subs[i], rule: r })),
      );
    return dependsOn(tax, code, found.map((r, i): Kind => [kind(subs[i]), r, subs[i]]));
  };

  /** 1. One key's rule for a code. */
  const byKey = new Map<string, Rule | null>();
  const keyRule = (key: string, code: TaxCode): Rule | null => {
    const id = `${key}|${code}`;
    if (byKey.has(id)) return byKey.get(id)!;
    const base = inherited(key, code);
    // With no rule above it, the subcode as asked directly, its own
    // narrower codes included.
    const rule =
      base === "unknown"
        ? null
        : base
          ? withKinds([key], key, code, base)
          : fromKinds(key, code, (sub) => {
              const r = keyRule(key, sub);
              return r && settle(r, sub);
            });
    byKey.set(id, rule);
    return rule;
  };

  /** 2. A chain's rule for a code. */
  const byChain = new Map<string, Rule | null>();
  const chainRule = (keys: string[], code: TaxCode): Rule | null => {
    const id = `${keys.join(" ")}|${code}`;
    if (byChain.has(id)) return byChain.get(id)!;
    let rule: Rule | null = null;
    for (const [i, key] of keys.entries()) {
      const found = keyRule(key, code);
      // Before a one-jurisdiction rule's earliest verified day, that
      // jurisdiction's treatment isn't known: the part isn't researched,
      // rather than answered by a broader key (Boulder's food rules, verified
      // from 2026-06-01, don't fall back to Colorado's before it).
      if (!found && ownScope(key) && RELATED.get(code)!.some((c) => unknown(key, c))) break;
      if (!found) continue;
      const more = keys.slice(0, i);
      // A broad code this key answers only from its subcodes' rules, while
      // a more specific key has a rule for one of them (a local platter
      // rule): each kind answers from its own most specific rule, and the
      // result is the most specific such key's, so this part isn't grouped
      // with the parts the broader key decides alone.
      const specific = inherited(key, code) === null ? more.find((k) => ownKinds([k], code).length) : undefined;
      if (specific) rule = fromKinds(specific, code, (sub) => chainRule(keys, sub));
      else {
        const settled = settle(found, code);
        rule = settled && more.length ? withKinds(more, key, code, settled) : settled;
      }
      break;
    }
    byChain.set(id, rule);
    return rule;
  };

  return { chainRule };
}

/** A segment's start as a lookup compares it: the day itself, or, after a
 *  rule's last day, that day and "\u0000", the first string after it, so
 *  any date string falls where ruleOn's comparisons put it. "" is before
 *  every day. */
const AFTER = "\u0000";
const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A rule as compared when merging segments: itself, and how each of its
 *  cases was put together (caseWordsOf). */
const printOf = (rule: Rule | null) =>
  JSON.stringify(rule, (_k, v) => {
    const words = v && typeof v === "object" && !Array.isArray(v) ? caseWords.get(v) : undefined;
    return words ? { ...v, "#words": words } : v;
  });

/** `rule` with its own copy of each case put together from a narrower
 *  kind's rule (caseWordsOf), as when it was resolved per request: describe
 *  marks the cases it read in one request by identity (describe.ts), so no
 *  two answers share them. A rule as filed is shared, as it always was. */
function ownCases(rule: Rule | null): Rule | null {
  if (!rule?.conditions.some((k) => caseWords.has(k))) return rule;
  const copies = new Map<Condition, Condition>();
  const copy = (k: Condition) => {
    const words = caseWords.get(k);
    if (!words) return k;
    let own = copies.get(k);
    if (!own) copies.set(k, (own = { ...k })), caseWords.set(own, words);
    return own;
  };
  return { ...rule, conditions: rule.conditions.map(copy) };
}

const compiled = new WeakMap<RuleSet, CompiledRules>();

/** `rules` compiled: once per rule set, on first use. */
export function compiledOf(rules: RuleSet): CompiledRules {
  let c = compiled.get(rules);
  if (!c) compiled.set(rules, (c = compile(rules)));
  return c;
}

function compile(rules: RuleSet): CompiledRules {
  const keys = new Set([...rules.keys()].map((k) => k.slice(0, k.indexOf("|"))));
  const chainOf = (state: string, part: Pick<RatePart, "kind" | "code">) => keysFor(state, part).filter((k) => keys.has(k));
  const table = new Map<string, Map<TaxCode, { starts: string[]; segments: Segment[] }>>();
  // One resolver per day asked, shared by every chain and code while the
  // table is built.
  let resolvers = new Map<string, ReturnType<typeof resolverOn>>();
  const resolver = (start: string) => resolvers.get(start) ?? resolvers.set(start, resolverOn(rules, start)).get(start)!;

  /** Every day a rule that can change `code`'s answer on `chain` starts or
   *  stops: under the chain's keys and the keys they follow, for the code,
   *  its broader codes and its narrower ones. */
  const startsOf = (chain: string[], code: TaxCode) => {
    const starts = new Set([""]);
    const seen = new Set<string>();
    const queue = [...chain];
    for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
      if (seen.has(key)) continue;
      seen.add(key);
      for (const c of RELATED.get(code)!)
        for (const r of rules.get(`${key}|${c}`) ?? []) {
          starts.add(r.from);
          if (r.to) starts.add(`${r.to}${AFTER}`);
          if (r.follows) queue.push(r.follows);
        }
    }
    return [...starts].sort();
  };

  const entry = (chain: string[], code: TaxCode) => {
    const id = chain.join(" ");
    const byCode = table.get(id) ?? table.set(id, new Map()).get(id)!;
    let e = byCode.get(code);
    if (e) return e;
    const starts: string[] = [];
    const ruled: Array<Rule | null> = [];
    let last: string | undefined;
    for (const start of startsOf(chain, code)) {
      const rule = resolver(start).chainRule(chain, code);
      const print = printOf(rule);
      if (print === last) continue;
      last = print;
      starts.push(start);
      ruled.push(rule);
    }
    const segments = starts.map((start, i): Segment => {
      const next = starts[i + 1];
      return {
        ...(start ? { from: start.endsWith(AFTER) ? shiftDay(start.slice(0, -1), 1) : start } : {}),
        ...(next !== undefined ? { to: next.endsWith(AFTER) ? next.slice(0, -1) : shiftDay(next, -1) } : {}),
        rule: ruled[i],
      };
    });
    byCode.set(code, (e = { starts, segments }));
    return e;
  };

  const lookup = (chain: string[], code: TaxCode, date: string): Rule | null => {
    if (!chain.length) return null;
    const { starts, segments } = entry(chain, code);
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= date) lo = mid;
      else hi = mid - 1;
    }
    return segments[lo].rule;
  };

  // Every chain a part can ask: a state's state part and its local parts
  // (with and without a one-part key, self-collected or not), each Canadian
  // tax's, and every key a rule follows.
  const chains = new Map<string, string[]>();
  const add = (chain: string[]) => chain.length && chains.set(chain.join(" "), chain);
  for (const key of keys) {
    const t = parseTaxKey(key);
    if (!t?.state || t.scope === "hst" || t.scope === "provincial") add([key]);
    else {
      const s = t.state;
      add(chainOf(s, { kind: "state", code: "" }));
      add(chainOf(s, { kind: "city", code: "" }));
      for (const code of Object.keys(SELF_COLLECTED[s]?.parts ?? {})) add(chainOf(s, { kind: "city", code }));
      if (t.scope === "part") add(chainOf(s, { kind: "city", code: t.part }));
    }
  }
  for (const list of rules.values()) for (const r of list) if (r.follows) add([r.follows]);
  for (const chain of chains.values()) for (const code of CODES) entry(chain, code);
  resolvers = new Map();

  return {
    ruleFor: (state, part, code, date) => ownCases(lookup(chainOf(state, part), code, date)),
    chainOf,
    segments: (chain, code) => (chain.length ? entry(chain, code).segments : [{ rule: null }]),
    chains: [...chains.values()],
  };
}
