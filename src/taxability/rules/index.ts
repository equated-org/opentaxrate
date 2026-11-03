/**
 * The rules, in their two forms. The reviewed files beside this one
 * (us-NY.json, ca-BC.json, ca-federal.json: one per place), read and
 * checked by readRuleFiles, are what people edit and what ingest loads.
 * The table `taxability_rules` is what a release carries and the resolver
 * reads: every row, once per process, indexed by tax and code. A data
 * release replaces the table and restarts the API, so the copy here is
 * never stale for long.
 *
 * `tax` is what a rule covers:
 *   "NY"           every part of a New York answer, state and local;
 *   "GA:local"     only the local parts there, where they differ from the
 *                  state's ("GA" then covers the state part alone);
 *   "CO:local:01:ttr17"
 *                  one local part, named by its code in the answer's
 *                  `parts` (Denver's city tax): where one jurisdiction
 *                  sets its own base or rate; the other local parts keep
 *                  "CO:local" or "CO";
 *   "AK:state"     only the state part, leaving local parts to an
 *                  "AK:local" rule or unresearched;
 *   "CA:GST/HST"   the federal base, GST or HST;
 *   "ON/CA:HST"    a province's HST, which either has its own rule (Ontario's
 *                  prepared-food rebate) or "follows" the federal base, as
 *                  checked for that code;
 *   "BC:PST"       a provincial tax, by its part code.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { db } from "../../db/client.js";
import { taxabilityRules } from "../../db/schema.js";
import { parentOf, TAX_CODES, type TaxCode } from "../codes.js";
import { RATE_CLASSES, type RateClass } from "../../rates/types.js";

/** This folder in the source tree, also from a build in dist/: the files
 *  aren't compiled, and only ingest and the tests read them. */
export const RULES_DIR = new URL("../../../src/taxability/rules/", import.meta.url).pathname;

/** special_rate: taxed at the rule's own `rate` instead of the part's general rate
 *  (a state's lower rate on groceries). */
export type PartTreatment = "taxable" | "special_rate" | "exempt" | "zero_rated" | "conditional" | "not_a_sale";

export interface Citation {
  title: string;
  url: string;
  /** The sentence on that page the rule rests on, verbatim. */
  quote?: string;
  /** Set at ingest, never in rule files: OpenTaxRate's archived copy that
   *  shows the quote (evidence.opentaxrate.com, pinned to its SHA-256 and
   *  opening at the sentence), and that copy's hash. */
  archived?: string;
  sha256?: string;
  /** For a PDF: the page the quote is on (1-based), set at ingest. */
  page?: number;
}

export interface Condition {
  when: string;
  treatment: "taxable" | "special_rate" | "exempt" | "zero_rated";
  /** The part's rate in this case, where it isn't the part's full rate. */
  rate?: number;
  /** In place of `rate`: each part is taxed at its own rate for this class
   *  in this case (its classRates entry), as on a rule. */
  rateClass?: RateClass;
  /** The share of the charge taxed in this case, where the law taxes only
   *  part of it (0 < base < 1; Texas taxes 80% of a data processing
   *  charge): the rate applies to that share, so the rate on the whole
   *  charge is the rate times base. */
  base?: number;
  /** In an answer for a broad code: the narrower code this case is, which
   *  the caller can send instead. Never in rule files. */
  code?: string;
}

export interface Rule {
  tax: string;
  code: TaxCode;
  /** First day in force. */
  from: string;
  /** Last day in force; open-ended when absent. */
  to?: string;
  /** effective: the sources give `from` as the day the rule took effect;
   *  earliest_verified: the rule may be older, but isn't read before it. */
  fromIs: "effective" | "earliest_verified";
  /** "follows": the rule for `follows` applies, as checked for this code. */
  treatment: Exclude<PartTreatment, "not_a_sale"> | "follows";
  /** For "special_rate": the rate charged on the code instead, for all the
   *  parts the rule decides together (a state part; every local part of
   *  an "XX:local" rule, Utah's 1.25% across its local taxes on food; or
   *  the one part of an "XX:local:<part code>" rule, Denver's 4.00% on
   *  food and drink). */
  rate?: number;
  /** For "special_rate", in place of `rate`: each part the rule decides is
   *  taxed at its own rate for this class (RatePart.classRates, loaded from
   *  the state's own rate table: Arizona's city restaurant rates), so one
   *  rule serves every city. A part with no rate for the class on the date
   *  is not researched; never taxed at its general rate instead. */
  rateClass?: RateClass;
  /** For "taxable" or "special_rate": the share of the charge taxed, where
   *  the law taxes only part of it (0 < base < 1), as on a condition. */
  base?: number;
  follows?: string;
  summary: string;
  /** The facts the outcome turns on, for a conditional rule; exceptions
   *  worth knowing, for a settled one. */
  conditions: Condition[];
  citations: Citation[];
  /** What couldn't be verified, for the reviewer; not shown in answers. */
  notes?: string;
}

/** The rules by `${tax}|${code}`, each list in date order. */
export type RuleSet = Map<string, Rule[]>;

export function ruleSet(rules: Rule[]): RuleSet {
  const set: RuleSet = new Map();
  for (const r of rules) set.set(`${r.tax}|${r.code}`, [...(set.get(`${r.tax}|${r.code}`) ?? []), r]);
  for (const list of set.values()) list.sort((a, b) => a.from.localeCompare(b.from));
  return set;
}

/** The rule for `tax` and `code` in force on `date`, or null. */
export function ruleOn(rules: RuleSet, tax: string, code: TaxCode, date: string): Rule | null {
  return rules.get(`${tax}|${code}`)?.find((r) => r.from <= date && (!r.to || date <= r.to)) ?? null;
}

let loaded: Promise<RuleSet> | null = null;

/** Every rule in the database, read once. */
export function loadRules(): Promise<RuleSet> {
  loaded ??= db
    .select()
    .from(taxabilityRules)
    .then((rows) =>
      ruleSet(
        rows.map((r) => ({
          tax: r.tax,
          code: r.code as TaxCode,
          from: r.startsOn,
          ...(r.endsOn === "9999-12-31" ? {} : { to: r.endsOn }),
          fromIs: r.fromIs as Rule["fromIs"],
          treatment: r.treatment as Rule["treatment"],
          ...(r.rate !== null ? { rate: r.rate } : {}),
          ...(r.rateClass ? { rateClass: r.rateClass as RateClass } : {}),
          ...(r.base !== null ? { base: r.base } : {}),
          ...(r.follows ? { follows: r.follows } : {}),
          summary: r.summary,
          conditions: r.conditions as Condition[],
          citations: r.citations,
          ...(r.notes ? { notes: r.notes } : {}),
        })),
      ),
    )
    .catch((error) => {
      loaded = null;
      throw error;
    });
  return loaded;
}

/** A place's rule file: us-NY.json, ca-BC.json, ca-federal.json. */
export const RULE_FILE = /^(us|ca)-[A-Za-z]+\.json$/;

// A real calendar day: 2020-02-31 fails here, not at load.
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "not a calendar date");
// The share of a charge taxed, where the law taxes only part of it.
const share = z.number().gt(0).lt(1);
const rateClass = z.enum(RATE_CLASSES);
const RuleFile = z.array(
  z
    .object({
      tax: z.string().regex(/^([A-Z]{2}(:local|:state)?|[A-Z]{2}:local:[A-Za-z0-9._-]+:[A-Za-z0-9._-]+|CA:GST\/HST|[A-Z]{2}\/CA:(GST|HST)|[A-Z]{2}:(PST|QST|RST))$/),
      code: z.enum(Object.keys(TAX_CODES) as [keyof typeof TAX_CODES]).refine((c) => c !== "nontaxable", "nontaxable is never a rule"),
      from: day,
      to: day.optional(),
      fromIs: z.enum(["effective", "earliest_verified"]),
      treatment: z.enum(["taxable", "special_rate", "exempt", "zero_rated", "conditional", "follows"]),
      rate: z.number().gt(0).max(0.3).optional(),
      rateClass: rateClass.optional(),
      base: share.optional(),
      follows: z.string().optional(),
      summary: z.string().min(10),
      conditions: z.array(
        z
          .object({ when: z.string().min(3), treatment: z.enum(["taxable", "special_rate", "exempt", "zero_rated"]), rate: z.number().min(0).max(1).optional(), rateClass: rateClass.optional(), base: share.optional() })
          .strict()
          .refine((c) => c.rateClass === undefined || (c.treatment === "special_rate" && c.rate === undefined), "rateClass is a special_rate case's rate: never beside rate")
          .refine((c) => c.base === undefined || c.treatment === "taxable" || c.treatment === "special_rate", "base is a share of the charge taxed: only on a taxable or special_rate case"),
      ),
      citations: z.array(z.object({ title: z.string().min(2), url: z.string().url(), quote: z.string().optional() }).strict()).min(1),
      notes: z.string().optional(),
    })
    .strict()
    .refine((r) => !r.to || r.to >= r.from, "to is before from")
    .refine((r) => (r.treatment === "follows") === Boolean(r.follows), "follows is set exactly when treatment is follows")
    // Only a province's HST follows the federal base. A US local rule that
    // followed its state's would join the state's parts and lose its rate.
    .refine((r) => r.treatment !== "follows" || r.tax.includes("/"), "only a province's HST rule (\"XX/CA:HST\") may follow another")
    .refine((r) => (r.treatment === "special_rate") === (r.rate !== undefined || r.rateClass !== undefined), "rate or rateClass is set exactly when treatment is special_rate")
    .refine((r) => r.rate === undefined || r.rateClass === undefined, "a special rate is a rate or a class's rates, not both")
    .refine((r) => r.treatment !== "conditional" || r.conditions.length > 0, "a conditional rule lists its conditions")
    .refine((r) => r.base === undefined || r.treatment === "taxable" || r.treatment === "special_rate", "base is a share of the charge taxed: only on a taxable or special_rate rule"),
);

export type RuleRow = z.infer<typeof RuleFile>[number] & { file: string };

/** Every rule in `dir`, checked; throws naming every problem found. */
export function readRuleFiles(dir = RULES_DIR): { rules: RuleRow[]; files: Array<{ file: string; rules: number; sha256: string }> } {
  const problems: string[] = [];
  const rules: RuleRow[] = [];
  const files: Array<{ file: string; rules: number; sha256: string }> = [];
  // One file per place (us-NY.json, ca-BC.json, ca-federal.json); watch.json
  // beside them is the monthly fetch's, not rules.
  for (const file of readdirSync(dir).filter((f) => RULE_FILE.test(f)).sort()) {
    const text = readFileSync(path.join(dir, file), "utf8");
    const parsed = RuleFile.safeParse(JSON.parse(text));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) problems.push(`${file} [${issue.path.join(".")}]: ${issue.message}`);
      continue;
    }
    rules.push(...parsed.data.map((r) => ({ ...r, file })));
    files.push({ file, rules: parsed.data.length, sha256: createHash("sha256").update(text).digest("hex") });
  }
  const end = (r: RuleRow) => r.to ?? "9999-12-31";
  const byKey = new Map<string, RuleRow[]>();
  for (const r of rules) byKey.set(`${r.tax}|${r.code}`, [...(byKey.get(`${r.tax}|${r.code}`) ?? []), r]);
  for (const [key, list] of byKey) {
    const sorted = [...list].sort((a, b) => a.from.localeCompare(b.from));
    for (let i = 1; i < sorted.length; i++)
      if (end(sorted[i - 1]) >= sorted[i].from) problems.push(`${key}: ${sorted[i - 1].from} (${sorted[i - 1].file}) overlaps ${sorted[i].from} (${sorted[i].file})`);
  }
  for (const r of rules) {
    if (r.follows && !(byKey.get(`${r.follows}|${r.code}`) ?? []).some((t) => t.from <= end(r) && end(t) >= r.from))
      problems.push(`${r.file}: ${r.tax} ${r.code} follows ${r.follows}, which has no rule for ${r.code} in ${r.from}..${end(r)}`);
    // A US state's special rate is the state part's; its local parts need a
    // rule of their own for every day of it (on the code or a broader one),
    // or they'd join the state's group and their own rate would vanish.
    if (r.treatment === "special_rate" && /^[A-Z]{2}$/.test(r.tax)) {
      const local: RuleRow[] = [];
      for (let c: TaxCode | null = r.code; c; c = parentOf(c)) local.push(...(byKey.get(`${r.tax}:local|${c}`) ?? []));
      const gap = uncovered(r.from, end(r), local.map((t) => [t.from, end(t)]));
      if (gap) problems.push(`${r.file}: ${r.tax} ${r.code} has a special rate from ${r.from}, but ${r.tax}:local has no rule for it on ${gap}`);
    }
  }
  if (problems.length) throw new Error(`The taxability rules have problems:\n  ${problems.join("\n  ")}`);
  return { rules, files };
}

/** The first day of [from, to] none of `spans` covers, or null. */
function uncovered(from: string, to: string, spans: Array<[string, string]>): string | null {
  const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  let day = from;
  for (const [a, b] of [...spans].sort((x, y) => x[0].localeCompare(y[0]))) {
    if (a > day) break;
    if (b >= to) return null;
    if (b >= day) day = next(b);
  }
  return day;
}
