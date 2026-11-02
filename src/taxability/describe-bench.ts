/**
 * The describe= benchmark: each case's own `facts` sentence sent as the
 * description, scored by evaluate.ts as code= is, twice:
 *
 *   code   with the case's code, as a caller who sends both would;
 *   text   with no code, so the picker chooses the code too.
 *
 * In the text run the code step is counted on its own as well: the
 * accepted code is the case's (exact), broader or narrower than it, some
 * other code (wrong, even where its tax happens to agree), or none.
 *
 * The picker's answers are kept in a JSON file under artifacts/taxability
 * (cachedPicker), so a rerun asks nothing new and gives the same numbers;
 * without TYPESAFE_API_KEY it replays that file only. Tune on the dev
 * cases; score the held-out cases once, with everything frozen.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { isTaxCode, taxabilityOf, type RuleSet } from "./index.js";
import { describedTaxability, type Described } from "./describe.js";
import { cachedPicker, DESCRIBE_MODEL, fileStore, jevPicker, type Picker } from "./picker.js";
import { loadCases, OUTCOMES, partsAt, scoreAnswer, type Outcome, type Scored } from "./evaluate.js";

export const PICKS_FILE = new URL("../../artifacts/taxability/describe-picks.json", import.meta.url).pathname;

export interface DescribedScore extends Scored {
  mode: "code" | "text";
  interpreted: Described["interpreted"];
  needs?: Described["needs"];
  /** Settled at a rate another of the code's cases charges differently
   *  (both positive), and the case states no exact rate to check it by. */
  rateUnchecked?: true;
}

/** The longest description the API takes (api-schema.ts). */
export const API_MAX = 200;

/** A deterministic half of the cases, by a hash of place and id: tune on
 *  A, confirm on B. */
export const halfOf = (c: { place: string; id: string }): "A" | "B" =>
  createHash("sha256").update(`${c.place}|${c.id}`).digest()[0] % 2 ? "B" : "A";

/** A picker that only replays the file: no answer for anything new. */
const replayOnly: Picker = { model: DESCRIBE_MODEL, pick: async () => null };

async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]);
      }
    }),
  );
  return out;
}

export async function scoreDescribed(rules: RuleSet, options: { dir?: string; picker?: Picker; picksFile?: string; half?: "A" | "B" } = {}): Promise<{ scored: DescribedScore[]; asked: number }> {
  const store = fileStore(options.picksFile ?? PICKS_FILE);
  const picker = cachedPicker(options.picker ?? jevPicker({ timeoutMs: 20_000 }) ?? replayOnly, store);
  const cases = loadCases(options.dir).filter((c) => !options.half || halfOf(c) === options.half);
  const scored: DescribedScore[] = [];
  try {
    for (const mode of ["code", "text"] as const) {
      const results = await inBatches(cases, 6, async (c) => {
        if (!isTaxCode(c.code)) throw new Error(`${c.id}: unknown code ${c.code}`);
        const parts = partsAt(c.place, c.date);
        const t = await describedTaxability({ state: c.place, parts }, { ...(mode === "code" ? { code: c.code } : {}), text: c.facts }, c.date, rules, picker);
        const { interpreted, needs, ...answer } = t;
        const scored = scoreAnswer(c, parts, answer);
        // No one code (candidates): conditional on which it is, a decline;
        // the scorer would read its empty taxes as not researched.
        const outcome = answer.treatment === "conditional" && !answer.taxes.length ? "declined" : scored.outcome;
        // The scorer reads taxed or not per tax; where the code's cases tax
        // at different positive rates, only an exact expected rate checks it.
        const code = mode === "code" ? c.code : interpreted.code;
        const others = answer.rate !== null && answer.rate > 0 && code && isTaxCode(code) ? (taxabilityOf({ state: c.place, parts }, code, c.date, rules).outcomes ?? []) : [];
        const rateUnchecked = c.expected.rate === undefined && others.some((o) => o.rate > 0 && Math.abs(o.rate - answer.rate!) > 1e-9);
        return { ...scored, outcome, mode, interpreted, ...(needs ? { needs } : {}), ...(rateUnchecked ? { rateUnchecked: true as const } : {}) };
      });
      scored.push(...results);
      store.save();
    }
  } finally {
    store.save();
  }
  return { scored, asked: store.added };
}

/** How the text's code compares with the case's. */
export function codeStep(s: DescribedScore): "exact" | "broader" | "narrower" | "wrong" | "listed" | "none" {
  const got = s.interpreted.code;
  const want = s.case.code;
  if (got === null) return s.interpreted.candidates?.includes(want as never) ? "listed" : "none";
  if (got === want) return "exact";
  if (want.startsWith(`${got}.`)) return "broader";
  if (got.startsWith(`${want}.`)) return "narrower";
  return "wrong";
}

export function printDescribed(scored: DescribedScore[], options: { list?: boolean; out?: string } = {}) {
  const count = (rows: Scored[]) => Object.fromEntries(OUTCOMES.map((o) => [o, rows.filter((r) => r.outcome === o).length])) as Record<Outcome, number>;
  console.log(`${"mode".padEnd(10)} ${"cases".padStart(5)} ${OUTCOMES.map((o) => `  ${o}`).join("")}  unavailable  settled-by-text  rate-unchecked`);
  for (const mode of ["code", "text"] as const)
    for (const [slice, keep] of [["", () => true], [" api", (r: DescribedScore) => r.case.facts.length <= API_MAX]] as const) {
      const rows = scored.filter((s) => s.mode === mode && keep(s));
      if (!rows.length) continue;
      const n = count(rows);
      const unavailable = rows.filter((r) => r.interpreted.unavailable).length;
      const byText = rows.filter((r) => r.interpreted.conditions?.length).length;
      const unchecked = rows.filter((r) => r.outcome === "right" && r.rateUnchecked).length;
      console.log(`${(mode + slice).padEnd(10)} ${String(rows.length).padStart(5)} ${OUTCOMES.map((o) => String(n[o]).padStart(o.length + 2)).join("")}  ${String(unavailable).padStart(11)}  ${String(byText).padStart(15)}  ${String(unchecked).padStart(14)}`);
    }
  console.log(`(api: descriptions of at most ${API_MAX} characters, as the API takes them; rate-unchecked: right answers whose rate the scorer can't tell from another positive rate)`);
  const text = scored.filter((s) => s.mode === "text");
  if (text.length) {
    const steps = ["exact", "broader", "narrower", "listed", "none", "wrong"] as const;
    console.log(`text-mode code step: ${steps.map((k) => `${k} ${text.filter((s) => codeStep(s) === k).length}`).join(", ")}`);
  }
  console.log(`code-mode flagged mismatch: ${scored.filter((s) => s.mode === "code" && s.interpreted.mismatch).length}`);
  for (const mode of ["code", "text"] as const) {
    const needs = new Map<string, number>();
    for (const s of scored.filter((s) => s.mode === mode && s.outcome === "declined")) for (const n of s.needs ?? []) needs.set(n, (needs.get(n) ?? 0) + 1);
    console.log(`${mode}-mode declines naming needs: ${[...needs].map(([n, k]) => `${n} ${k}`).join(", ") || "none"}`);
  }
  for (const s of scored)
    if (s.outcome === "wrong" || s.outcome === "kind" || options.list)
      console.log(
        `  ${s.mode.padEnd(5)} ${s.outcome.padEnd(14)} ${s.case.id.padEnd(9)} ${s.case.place} ${s.case.code.padEnd(27)} → ${String(s.interpreted.code).padEnd(27)} expected ${JSON.stringify(s.case.expected)}, got ${s.got}`,
      );
  if (options.out)
    writeFileSync(
      options.out,
      JSON.stringify(scored.map((s) => ({ mode: s.mode, id: s.case.id, place: s.case.place, code: s.case.code, facts: s.case.facts, expected: s.case.expected, outcome: s.outcome, got: s.got, interpreted: s.interpreted, needs: s.needs, rateUnchecked: s.rateUnchecked, half: halfOf(s.case) })), null, 1),
    );
}
