/**
 * The taxability rules scored against cases taken from the agencies' own
 * worked examples and statements (artifacts/taxability/evals/**.json), each with the
 * sentence that settles it. The cases were written apart from the rules,
 * so a rule and its test don't share a reading.
 *
 * A case expects an outcome per tax it names: `sales` for a US sale as a
 * whole, `state` and `local` where a state's local taxes treat the code
 * differently, `federal` and `provincial` in Canada, and `rate` where a
 * rebate sets the sale's rate. It is right when every one comes out as
 * the source says; wrong when a tax is charged that the source says isn't,
 * or the reverse; "kind" when the tax due agrees but zero-rated and exempt
 * are swapped; declined when a rule turns on facts the code doesn't fix;
 * and not researched when no rule covers it. Only wrong answers cost: a
 * decline sends the caller to the facts, a wrong rate charges the wrong
 * tax.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isProvince, provinceParts } from "../rates/canada.js";
import type { RatePart } from "../rates/types.js";
import { isTaxCode, taxabilityOf, type RuleSet, type Taxability } from "./index.js";

type Expected = "taxed" | "zero_rated" | "not_taxed";

export interface TaxabilityCase {
  id: string;
  place: string;
  date: string;
  code: string;
  facts: string;
  expected: { sales?: Expected; state?: Expected; local?: Expected; federal?: Expected; provincial?: Expected; rate?: number };
  source?: { title: string; url: string; quote: string };
  sources?: Array<{ title: string; url: string; quote: string }>;
  notes?: string;
}

export const OUTCOMES = ["right", "wrong", "kind", "declined", "not_researched"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export interface Scored {
  case: TaxabilityCase;
  outcome: Outcome;
  /** What came back, per expectation. */
  got: string;
}

/** The cases live outside the repository with the other benchmark sets
 *  (artifacts/, git-ignored, backed up by `pnpm bench backup`). */
const DEFAULT_DIR = new URL("../../artifacts/taxability/evals", import.meta.url).pathname;

/** The parts a case is scored on. A US state gets a state part and one
 *  local part, so a case can expect them apart; the rates are nominal. */
function partsAt(place: string, date: string): RatePart[] {
  if (isProvince(place)) return provinceParts(place, date);
  return [
    { kind: "state", name: place, code: `${place}:state`, rate: 0.04 },
    { kind: "city", name: `${place} local`, code: `${place}:local`, rate: 0.02 },
  ];
}

/** The treatment of the group holding a part. */
const treatmentOf = (t: Taxability, partCode: string) => t.taxes.find((g) => g.parts.includes(partCode))?.treatment ?? "not_researched";

/** How one tax's answer compares with what the source expects. */
function compare(treatment: string, expected: Expected): Outcome {
  if (treatment === "not_researched") return "not_researched";
  if (treatment === "conditional") return "declined";
  const got: Expected = treatment === "taxable" ? "taxed" : treatment === "zero_rated" ? "zero_rated" : "not_taxed";
  if (got === expected) return "right";
  return (got === "taxed") !== (expected === "taxed") ? "wrong" : "kind";
}

const WORST: Outcome[] = ["wrong", "kind", "not_researched", "declined", "right"];

export function scoreCase(c: TaxabilityCase, rules: RuleSet): Scored {
  if (!isTaxCode(c.code)) throw new Error(`${c.id}: unknown code ${c.code}`);
  const parts = partsAt(c.place, c.date);
  const t = taxabilityOf({ state: c.place, parts }, c.code, c.date, rules);
  const outcomes: Outcome[] = [];
  const got: string[] = [];
  const expect = (label: string, treatment: string, expected: Expected | undefined) => {
    if (!expected) return;
    outcomes.push(compare(treatment, expected));
    got.push(`${label} ${treatment}`);
  };
  const e = c.expected;
  // The sale as a whole: taxed if any part taxes it.
  expect("sales", t.treatment === "taxable" || t.treatment === "partial" ? "taxable" : t.treatment === "not_taxed" ? treatmentOf(t, parts[0].code) : t.treatment, e.sales);
  expect("state", treatmentOf(t, `${c.place}:state`), e.state);
  expect("local", treatmentOf(t, `${c.place}:local`), e.local);
  const federal = parts.find((p) => p.code === "CA:GST" || p.code === "CA:HST");
  const provincial = parts.find((p) => /:(PST|QST|RST)$/.test(p.code));
  if (e.federal && !federal) throw new Error(`${c.id}: ${c.place} has no federal tax`);
  if (e.provincial && !provincial) throw new Error(`${c.id}: ${c.place} has no provincial tax`);
  if (federal) expect("federal", treatmentOf(t, federal.code), e.federal);
  if (provincial) expect("provincial", treatmentOf(t, provincial.code), e.provincial);
  if (e.rate !== undefined) {
    outcomes.push(t.rate === null ? compare(t.treatment, "taxed") : Math.abs(t.rate - e.rate) < 1e-9 ? "right" : "wrong");
    got.push(`rate ${t.rate}`);
  }
  if (!outcomes.length) throw new Error(`${c.id}: expects nothing`);
  return { case: c, outcome: WORST.find((o) => outcomes.includes(o))!, got: got.join(", ") };
}

/** Every *.json under `dir`, including subdirectories. */
export function loadCases(dir = DEFAULT_DIR): TaxabilityCase[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((f) => (f.isDirectory() ? loadCases(join(dir, f.name)) : f.name.endsWith(".json") ? (JSON.parse(readFileSync(join(dir, f.name), "utf8")) as TaxabilityCase[]) : []));
}

/** Every case scored against `rules`: the database's, as lookups read them. */
export const scoreTaxability = (rules: RuleSet, dir?: string) => loadCases(dir).map((c) => scoreCase(c, rules));

export function printScore(scored: Scored[], options: { list?: boolean } = {}) {
  const count = (rows: Scored[]) => Object.fromEntries(OUTCOMES.map((o) => [o, rows.filter((r) => r.outcome === o).length]));
  const places = [...new Set(scored.map((s) => s.case.place))].sort();
  const row = (label: string, rows: Scored[]) => {
    const n = count(rows);
    return `${label.padEnd(6)} ${String(rows.length).padStart(5)} ${OUTCOMES.map((o) => String(n[o]).padStart(o.length + 2)).join("")}`;
  };
  console.log(`${"place".padEnd(6)} ${"cases".padStart(5)} ${OUTCOMES.map((o) => `  ${o}`).join("")}`);
  for (const p of places) console.log(row(p, scored.filter((s) => s.case.place === p)));
  console.log(row("all", scored));
  for (const s of scored)
    if (s.outcome === "wrong" || s.outcome === "kind" || options.list)
      console.log(`  ${s.outcome.padEnd(14)} ${s.case.id.padEnd(7)} ${s.case.code.padEnd(27)} ${s.case.date}  expected ${JSON.stringify(s.case.expected)}, got ${s.got}`);
}
