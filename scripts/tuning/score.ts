// Score a run against the states' official labels.
//
//   npx tsx scripts/tuning/score.ts NAME [BASE]
//
// Prints right / wrong / declined / disputed over the labelled addresses of
// $SPLITS, and the one-sided 95% Clopper-Pearson upper bound on the wrong
// rate among answered ones; with BASE, every address whose grade changed
// from that run. LIST=1 lists every wrong rate, decline and dispute.
//
// Two rules sit beside the labels, which come from each state's lookup or map:
//   - In a Streamlined state, the state's address database is official too:
//     an answer read exactly from its street ranges (not a corrected spelling
//     or a house between listed ones) is right even where the state's map
//     gives another rate. Sellers are told to rely on that database. These
//     are counted, and listed with LIST=1, as "right by the address database".
//   - An address in disputes.json, where official sources disagree with each
//     other, is disputed: neither right nor wrong.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { SST_FIPS } from "../../src/coverage.ts";
import { csv as parseCsv, jsonl as readJsonl, upper } from "./stats.ts";

const ROOT = new URL("../..", import.meta.url).pathname;
const POOL = path.join(ROOT, "artifacts/bench/pool");
const TUNE = process.env.TUNE_DIR || path.join(ROOT, "artifacts/tuning");
const SPLITS = (process.env.SPLITS || "batch1 batch-dev batch2 batch3 batch4 batch5 round2").split(/\s+/).filter(Boolean);
const disputed = new Set<string>(JSON.parse(fs.readFileSync(new URL("disputes.json", import.meta.url), "utf8")).disputes.map((d: { id: string }) => d.id));

type Case = Record<string, string>;
type Answer = { id: string; rate?: number; refused?: string; raw?: { match?: string; source?: string } };
type Grade = "right" | "right*" | "wrong" | "declined" | "disputed" | "missing";

const jsonl = (file: string) => readJsonl<Answer>(file, fs);
const csv = (file: string): Case[] => parseCsv(fs.readFileSync(file, "utf8"));
const caseId = (r: Case) => createHash("sha256")
  .update(`${r.state.trim()}|${r.street.trim()}|${r.city.trim()}|${r.zip.trim()}|${(r.date || "2026-10-21").trim()}`.toUpperCase())
  .digest("hex").slice(0, 16);

const cases = new Map<string, Case>();
const official = new Map<string, number>();
for (const split of SPLITS) {
  for (const r of csv(path.join(POOL, "sets", split, "cases.csv"))) cases.set(caseId(r), r);
  for (const a of jsonl(path.join(POOL, "answers", split, "official.jsonl"))) if (a.rate !== undefined) official.set(a.id, a.rate);
}

/** A run's answers by id, from every split it was asked on. */
function run(name: string) {
  const answers = new Map<string, Answer>();
  const dir = path.join(TUNE, name);
  if (fs.existsSync(dir))
    for (const split of fs.readdirSync(dir))
      if (fs.statSync(path.join(dir, split)).isDirectory())
        for (const file of fs.readdirSync(path.join(dir, split)).filter((f) => f.endsWith(".jsonl")))
          for (const a of jsonl(path.join(dir, split, file))) answers.set(a.id, a);
  return answers;
}

/** An exact read of a Streamlined state's street ranges. */
function byAddressDatabase(id: string, a: Answer) {
  const source = a.raw?.source ?? "";
  return cases.get(id)!.state in SST_FIPS && a.raw?.match === "street"
    && !source.includes("street read as") && !source.includes("between listed houses");
}

function grade(id: string, a: Answer | undefined, want: number): Grade {
  if (!a) return "missing";
  if (disputed.has(id)) return "disputed";
  if (a.refused !== undefined) return "declined";
  if (Math.abs(a.rate! - want) < 5e-5) return "right";
  return byAddressDatabase(id, a) ? "right*" : "wrong";
}

const pct = (r: number) => `${+(r * 100).toFixed(4)}%`;
const why = (a: Answer | undefined) => (a?.refused ?? a?.raw?.source ?? "").slice(0, 170);
const line = (g: string, id: string, want: number, a?: Answer) => {
  const c = cases.get(id)!;
  const got = g === "declined" || a?.rate === undefined ? "" : ` got ${pct(a.rate)}`;
  return `  ${g.padEnd(8)} ${c.state} ${c.street}, ${c.city} ${c.zip} official ${pct(want)}${got} | ${why(a)}`;
};

const [name, base] = process.argv.slice(2);
if (!name) { console.error("usage: score.ts NAME [BASE]"); process.exit(1); }
const answers = run(name);
const grades = new Map([...official].map(([id, want]) => [id, grade(id, answers.get(id), want)]));
const count = (g: Grade) => [...grades.values()].filter((x) => x === g).length;
const right = count("right") + count("right*");
const n = official.size - count("disputed");
const answered = right + count("wrong");
console.log(`${name}: n=${n} right ${right} (${(100 * right / n).toFixed(2)}%) wrong ${count("wrong")} declined ${count("declined")} `
  + `missing ${count("missing")} | wrong-rate upper95 ${(100 * upper(count("wrong"), answered)).toFixed(2)}% of answered`
  + ` | ${count("right*")} right by the address database, ${count("disputed")} disputed`);
// A split that stopped early has fewer wrong rates, not more right ones.
if (count("missing")) console.error(`  ${count("missing")} labelled addresses have no answer: a split stopped early; see its log`);
if (base) {
  const before = run(base);
  for (const [id, want] of official) {
    const was = grade(id, before.get(id), want), now = grades.get(id)!;
    if (was === now) continue;
    const c = cases.get(id)!;
    console.log(`  ${was.padEnd(8)} -> ${now.padEnd(8)} ${c.state} ${c.street}, ${c.city} ${c.zip} official ${pct(want)} | ${why(answers.get(id))}`);
  }
}
if (process.env.LIST)
  for (const [id, want] of official)
    if (["wrong", "declined", "right*", "disputed"].includes(grades.get(id)!)) console.log(line(grades.get(id)!, id, want, answers.get(id)));
if (count("missing")) process.exit(1);
