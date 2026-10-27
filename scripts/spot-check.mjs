#!/usr/bin/env node
// A quick, reproducible accuracy check that needs nothing but Node 22 and a
// network: it samples addresses from the public benchmark dataset (the
// version bench/benchmark.json pins), asks an OpenTaxRate API for each on
// the case's own date, and scores the answers against the states' official
// rates the same way the full benchmark does.
//
//   node scripts/spot-check.mjs                    30 addresses, the hosted API, no key
//   node scripts/spot-check.mjs --n 100 --seed 7   a different, larger sample
//   node scripts/spot-check.mjs --api http://localhost:8080
//
// OPENTAXRATE_API_KEY, when set, is sent as the key. Without one the hosted
// API allows 10 lookups a minute, so the script waits between lookups; 30
// addresses take about three minutes. The same --seed gives the same sample.
// docs/benchmarks.md describes the full benchmark this samples from.
import { readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []),
);
const n = Number(args.n ?? 30);
const seed = Number(args.seed ?? Date.now() % 100000);
const api = (args.api ?? "https://api.opentaxrate.com").replace(/\/+$/, "");
const key = process.env.OPENTAXRATE_API_KEY;
const hosted = api === "https://api.opentaxrate.com";
// The public tier's per-minute limit, with room to spare.
const pause = hosted && !key ? 6500 : 0;

const config = JSON.parse(readFileSync(new URL("../bench/benchmark.json", import.meta.url), "utf8"));
const base = `https://raw.githubusercontent.com/${config.repo}/v${config.version}/dev`;

async function cases(file) {
  const response = await fetch(`${base}/${file}`);
  if (!response.ok) throw new Error(`${base}/${file}: HTTP ${response.status}`);
  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((c) => c.street && c.state && typeof c.label?.rate === "number");
}

// mulberry32: a small seeded generator, so a sample can be repeated.
function random(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const all = [...(await cases("addresses.jsonl")), ...(await cases("addresses-osm.jsonl"))];
const next = random(seed);
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(next() * (i + 1));
  [all[i], all[j]] = [all[j], all[i]];
}
const sample = all.slice(0, n);
console.log(`Dataset v${config.version}: ${all.length} labelled addresses; asking ${api} about ${sample.length} (seed ${seed}).\n`);

const pct = (r) => `${(r * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
const tally = { right: 0, wrong: 0, declined: 0, unanswered: 0 };
for (const [i, c] of sample.entries()) {
  if (i > 0 && pause) await new Promise((resolve) => setTimeout(resolve, pause));
  const params = new URLSearchParams({ state: c.state, street: c.street, city: c.city ?? "", zip: (c.zip ?? "").slice(0, 5), date: c.date });
  const headers = { accept: "application/json", ...(key ? { "x-api-key": key } : {}) };
  let outcome, detail;
  try {
    const response = await fetch(`${api}/v1/rate?${params}`, { headers });
    const body = await response.json().catch(() => ({}));
    if (response.ok && typeof body.rate === "number") {
      outcome = Math.abs(body.rate - c.label.rate) < 0.00005 ? "right" : "wrong";
      detail = `${pct(body.rate)} (${body.match})${outcome === "wrong" ? `, official ${pct(c.label.rate)}` : ""}`;
    } else if (response.status === 422) {
      outcome = "declined";
      detail = body.code ?? body.error;
    } else {
      outcome = "unanswered";
      detail = `HTTP ${response.status} ${body.code ?? ""}`.trim();
    }
  } catch (error) {
    outcome = "unanswered";
    detail = String(error);
  }
  tally[outcome]++;
  console.log(`${outcome.padEnd(10)} ${c.state} ${c.street}, ${c.city} ${c.zip} on ${c.date}: ${detail}`);
}

const asked = sample.length - tally.unanswered;
console.log(`\n${tally.right} right, ${tally.wrong} wrong, ${tally.declined} declined of ${asked} answered${tally.unanswered ? ` (${tally.unanswered} not answered: rate limit or network)` : ""}.`);
console.log("Right means within 0.00005 of the state's official combined rate. These are dev addresses, which the engine was tuned on.");
