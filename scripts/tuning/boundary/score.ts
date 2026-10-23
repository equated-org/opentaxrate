// Score a boundary run against the states' own answers at each point.
//
//   npx tsx scripts/tuning/boundary/score.ts NAME [BASE] [STATE...]
//
// For each point and date the state labelled, the run's answer (run.mts) is
// graded twice:
//   - rate: right, wrong, or declined;
//   - jurisdictions, where the rate is answered: the same jurisdictions as the
//     state names; different but flagged (the answer marks its jurisdictions
//     uncertain and lists the state's among its alternatives); or different.
//     A right total from the wrong jurisdictions, unflagged, is still a wrong
//     breakdown: it files tax to the wrong place.
// Each is broken down by the point's distance to the nearest rated line as
// loaded today, and by date. Prints the one-sided 95% upper bound on the
// wrong rate of answered points. With BASE, lists every point whose grade
// changed. LIST=1 lists every wrong rate and wrong breakdown. Points the
// state couldn't answer are left out.
import fs from "node:fs";
import path from "node:path";
import { csv, jsonl, upper } from "../stats.ts";

const ROOT = new URL("../../..", import.meta.url).pathname;
const DIR = process.env.BOUNDARY_DIR || path.join(ROOT, "artifacts/bench/boundary");
const TODAY = process.env.BOUNDARY_TODAY || "2026-10-21";
const BANDS: Array<[number, number]> = [[0, 10], [10, 30], [30, 100], [100, Infinity]];

type Part = { kind?: string; code: string; name?: string; rate: number; ids?: Record<string, string> };
type Label = { id: string; rate: number; refused?: string; parts?: Part[] };
type Answer = { id: string; rate?: number; refused?: string; parts?: Part[]; jurisdictions?: string; alternatives?: Array<{ parts: Part[] }> };
type Row = Record<string, string> & {};
type Graded = { p: Row; grade: string; ident: string | null; label: Label; answer?: Answer };

const byId = <T extends { id: string }>(file: string) => new Map(jsonl<T>(file, fs).map((r) => [r.id, r]));
const fixed6 = (n: number) => n.toFixed(6);

/** The jurisdictions in OpenTaxRate's answer, keyed as the state's oracle keys them. */
function ours(state: string, answer: { parts?: Part[] }) {
  const keys = new Set<string>();
  for (const p of answer.parts ?? []) {
    const ids = p.ids ?? {}, code = p.code.split(":").slice(1).join(":") || p.code;
    // Arizona's county part carries the state's 5.6%, so it's named even at 0.
    if (state === "AZ" && p.kind === "county") { keys.add(ids.RegionCode || code); continue; }
    if (p.kind === "state" || !p.rate) continue;
    if (state === "TX") keys.add(ids.TAID || code.split(">").at(-1)!);
    else if (state === "CO" || state === "AK") keys.add(ids.placeId || code);
    else if (state === "AZ") keys.add(ids.RegionCode || `${p.kind}:${fixed6(p.rate)}`);
    else if (state === "VA") keys.add(code.split("@")[0]);
    else if (state === "SC") keys.add((p.name || code).toUpperCase());
  }
  return keys;
}

/** The jurisdictions the state names, without the state itself. */
function theirs(state: string, label: Label) {
  const stateCodes: Record<string, string> = { TX: "1", CO: "1", AK: "595", SC: "45" };
  const keys = new Set<string>();
  for (const p of label.parts ?? []) {
    if (!p.rate || p.code === stateCodes[state]) continue;
    keys.add(state === "AZ" && p.kind === "district" ? `district:${fixed6(p.rate)}` : p.code);
  }
  return keys;
}
const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));

function grade(state: string, label: Label, answer?: Answer): [string, string | null] {
  if (!answer) return ["missing", null];
  if (answer.refused !== undefined) return ["declined", null];
  if (Math.abs(answer.rate! - label.rate) >= 5e-5) return ["wrong", null];
  const official = theirs(state, label);
  if (same(ours(state, answer), official)) return ["right", "same"];
  if ((answer.alternatives ?? []).some((a) => same(ours(state, a), official))) return ["right", "flagged"];
  return ["right", "different"];
}

function run(name: string, states: string[]): Graded[] {
  const rows: Graded[] = [];
  for (const st of states) {
    const labels = byId<Label>(path.join(DIR, st, "official.jsonl"));
    const answers = byId<Answer>(path.join(DIR, st, "runs", `${name}.jsonl`));
    for (const p of csv(fs.readFileSync(path.join(DIR, st, "points.csv"), "utf8"))) {
      const label = labels.get(p.id);
      if (!label || label.refused !== undefined) continue;
      const [g, ident] = grade(st, label, answers.get(p.id));
      rows.push({ p, grade: g, ident, label, answer: answers.get(p.id) });
    }
  }
  return rows;
}

const bandName = ([lo, hi]: [number, number]) => (hi < Infinity ? `${lo}-${hi} m` : `${lo}+ m`);
function band(p: Row) {
  if (p.stratum === "control") return "control";
  const e = Number(p.edge_m);
  return bandName(BANDS.find(([lo, hi]) => lo <= e && e < hi)!);
}

const pad = (v: number | string, n: number) => String(v).padStart(n);
function line(label: string, rows: Graded[]) {
  if (!rows.length) return;
  const t = (g: string) => rows.filter((r) => r.grade === g).length;
  const i = (k: string) => rows.filter((r) => r.ident === k).length;
  const n = rows.length, answered = t("right") + t("wrong");
  // Right jurisdictions, yet marked uncertain: the cost of flagging.
  const needless = rows.filter((r) => r.ident === "same" && r.answer?.jurisdictions === "uncertain").length;
  console.log(`  ${label.padEnd(18)} n=${pad(n, 5)}  right ${pad(t("right"), 5)} (${pad((100 * t("right") / n).toFixed(1), 5)}%)  wrong ${pad(t("wrong"), 4)}  declined ${pad(t("declined"), 4)}`
    + `  | wrong upper95 ${pad((100 * upper(t("wrong"), answered)).toFixed(2), 5)}% of answered`
    + `  | breakdown differs ${pad(i("different"), 3)}, flagged ${pad(i("flagged"), 3)}, needlessly flagged ${pad(needless, 3)}`
    + (t("missing") ? `  missing ${t("missing")}` : ""));
}

const g4 = (v: number) => String(Number(v.toPrecision(4)));
const list = (keys: Set<string>) => `[${[...keys].sort().map((k) => `'${k}'`).join(", ")}]`;

const args = process.argv.slice(2);
const name = args.shift();
if (!name) { console.error("usage: score.ts NAME [BASE] [STATE...]"); process.exit(1); }
const base = args.length && !/^[A-Z]{2}$/.test(args[0]) ? args.shift() : undefined;
const states = args.length ? args
  : fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, "official.jsonl"))).sort();
const rows = run(name, states);
console.log(`${name}: ${rows.length} labelled points and dates in ${states.join(", ")}`);
line("all", rows);
console.log(" by state");
for (const st of states) line(st, rows.filter((r) => r.p.state === st));
console.log(" by distance to the nearest rated line");
for (const b of [...BANDS.map(bandName), "control"]) line(b, rows.filter((r) => band(r.p) === b));
console.log(" by date");
line("today", rows.filter((r) => r.p.date === TODAY));
for (const d of [...new Set(rows.map((r) => r.p.date))].filter((d) => d !== TODAY).sort()) line(d, rows.filter((r) => r.p.date === d));
if (base) {
  const before = new Map(run(base, states).map((r) => [`${r.p.state}|${r.p.id}`, r]));
  console.log(` changed from ${base}`);
  for (const r of rows) {
    const b = before.get(`${r.p.state}|${r.p.id}`);
    if (b && (b.grade !== r.grade || b.ident !== r.ident))
      console.log(`  ${b.grade}/${b.ident ?? "None"} -> ${r.grade}/${r.ident ?? "None"}  ${r.p.state} ${r.p.lon},${r.p.lat} ${r.p.date} edge ${r.p.edge_m} m`
        + `  official ${g4(100 * r.label.rate)}% | ${(r.answer?.refused ?? "").slice(0, 120)}`);
  }
}
if (process.env.LIST)
  for (const r of rows)
    if (r.grade === "wrong" || r.ident === "different")
      console.log(`  ${r.grade.padEnd(5)} ${(r.ident ?? "").padEnd(9)} ${r.p.state} ${r.p.lon},${r.p.lat} ${r.p.date} edge ${r.p.edge_m} m near ${r.p.near_name}`
        + `  official ${g4(100 * r.label.rate)}% ${list(theirs(r.p.state, r.label))}`
        + `  got ${g4(100 * r.answer!.rate!)}% ${list(ours(r.p.state, r.answer!))}`);
