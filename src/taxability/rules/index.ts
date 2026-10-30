/**
 * The rules, in their two forms. The reviewed files beside this one
 * (us-NY.json, ca-BC.json, ca-federal.json: one per place), read and
 * checked by readRuleFiles, are what people edit and what ingest loads.
 * The table `taxability_rules` is what a release carries and the resolver
 * reads: every row, once per process, indexed by tax and code. A data
 * release replaces the table and restarts the API, so the copy here is
 * never stale for long; `forgetRules()` drops it for a process that
 * reloads in place.
 *
 * `tax` is what a rule covers:
 *   "NY"           every part of a New York answer, state and local;
 *   "GA:local"     only the local parts there, where they differ from the
 *                  state's ("GA" then covers the state part alone);
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
import { TAX_CODES, type TaxCode } from "../codes.js";

/** This folder in the source tree, also from a build in dist/: the files
 *  aren't compiled, and only ingest and the tests read them. */
export const RULES_DIR = new URL("../../../src/taxability/rules/", import.meta.url).pathname;

export type PartTreatment = "taxable" | "exempt" | "zero_rated" | "conditional" | "not_a_sale";

export interface Citation {
  title: string;
  url: string;
  /** The sentence on that page the rule rests on, verbatim. */
  quote?: string;
}

export interface Condition {
  when: string;
  treatment: "taxable" | "exempt" | "zero_rated";
  /** The part's rate in this case, where it isn't the part's full rate. */
  rate?: number;
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

export const forgetRules = () => {
  loaded = null;
};

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const RuleFile = z.array(
  z
    .object({
      tax: z.string().regex(/^([A-Z]{2}(:local)?|CA:GST\/HST|[A-Z]{2}\/CA:(GST|HST)|[A-Z]{2}:(PST|QST|RST))$/),
      code: z.enum(Object.keys(TAX_CODES) as [keyof typeof TAX_CODES]).refine((c) => c !== "nontaxable", "nontaxable is never a rule"),
      from: day,
      to: day.optional(),
      fromIs: z.enum(["effective", "earliest_verified"]),
      treatment: z.enum(["taxable", "exempt", "zero_rated", "conditional", "follows"]),
      follows: z.string().optional(),
      summary: z.string().min(10),
      conditions: z.array(
        z.object({ when: z.string().min(3), treatment: z.enum(["taxable", "exempt", "zero_rated"]), rate: z.number().min(0).max(1).optional() }).strict(),
      ),
      citations: z.array(z.object({ title: z.string().min(2), url: z.string().url(), quote: z.string().optional() }).strict()).min(1),
      notes: z.string().optional(),
    })
    .strict()
    .refine((r) => !r.to || r.to >= r.from, "to is before from")
    .refine((r) => (r.treatment === "follows") === Boolean(r.follows), "follows is set exactly when treatment is follows")
    .refine((r) => r.treatment !== "conditional" || r.conditions.length > 0, "a conditional rule lists its conditions"),
);

export type RuleRow = z.infer<typeof RuleFile>[number] & { file: string };

/** Every rule in `dir`, checked; throws naming every problem found. */
export function readRuleFiles(dir = RULES_DIR): { rules: RuleRow[]; files: Array<{ file: string; rules: number; sha256: string }> } {
  const problems: string[] = [];
  const rules: RuleRow[] = [];
  const files: Array<{ file: string; rules: number; sha256: string }> = [];
  // One file per place (us-NY.json, ca-BC.json, ca-federal.json); watch.json
  // beside them is the monthly fetch's, not rules.
  for (const file of readdirSync(dir).filter((f) => /^(us|ca)-[A-Za-z]+\.json$/.test(f)).sort()) {
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
  for (const r of rules)
    if (r.follows && !(byKey.get(`${r.follows}|${r.code}`) ?? []).some((t) => t.from <= end(r) && end(t) >= r.from))
      problems.push(`${r.file}: ${r.tax} ${r.code} follows ${r.follows}, which has no rule for ${r.code} in ${r.from}..${end(r)}`);
  if (problems.length) throw new Error(`The taxability rules have problems:\n  ${problems.join("\n  ")}`);
  return { rules, files };
}
