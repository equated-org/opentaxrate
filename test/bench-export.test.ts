/**
 * The public benchmark export (scripts/bench-data.mts): only dev rows, from
 * allow-listed fields, never an eval address, never another service's
 * answers, and each source in the file its licence allows. Runs on a
 * scratch artifacts folder; no database.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-export-"));
const artifacts = path.join(dir, "artifacts");
const out = path.join(dir, "out");
const config = path.join(dir, "benchmark.json");
const HEAD = "state,street,city,zip,date,expected,source,lon,lat,notes";
// Ids are sha256("STATE|street|city|zip|date") uppercased, first 16 hex.
const NAD = "AK,716 Buren Road,Ketchikan,99901,2026-10-21,,NAD,-131.687428,55.359371,easy";
const OSM = "NV,1 Main St,Reno,89501,2026-10-21,,OSM,-119.8,39.5,";
const MARIS = "MS,2 Pine St,Hattiesburg,39401,2026-10-21,,MS-MARIS-parcels,-89.3,31.3,";
const EVAL = "AK,9 Elm Street,Juneau,99801,2026-10-21,,NAD,-134.4,58.3,";

function split(name: string, rows: string[], answers: Record<string, string> = {}) {
  fs.mkdirSync(path.join(artifacts, "bench/pool/sets", name), { recursive: true });
  fs.writeFileSync(path.join(artifacts, "bench/pool/sets", name, "cases.csv"), [HEAD, ...rows].join("\n") + "\n");
  const labels = path.join(artifacts, "bench/pool/answers", name);
  fs.mkdirSync(labels, { recursive: true });
  for (const [file, text] of Object.entries(answers)) fs.writeFileSync(path.join(labels, file), text);
}
const label = (id: string, state: string, rate: number) =>
  JSON.stringify({ id, state, at: "2026-10-23T02:13:08Z", rate, raw: { oracle: "state service", detail: {} } }) + "\n";
const run = () => execFileSync("npx", ["tsx", "scripts/bench-data.mts", "export", out], {
  env: { ...process.env, BENCH_ARTIFACTS: artifacts, BENCH_CONFIG: config }, encoding: "utf8", stdio: "pipe",
});
const rows = (file: string) => fs.readFileSync(path.join(out, "dev", file), "utf8").trim().split("\n").map((l) => JSON.parse(l));

beforeEach(() => {
  fs.rmSync(artifacts, { recursive: true, force: true });
  fs.rmSync(out, { recursive: true, force: true });
  fs.writeFileSync(config, JSON.stringify({
    version: "test", repo: "x/y", canary: "canary-test", dev: ["d1"], eval: ["e1"],
    history: { dev: [], eval: [] }, typos: { dev: [] }, boundary: [],
  }));
  split("d1", [NAD, OSM, MARIS], {
    "official.jsonl": label("010df465b5c5ca67", "AK", 0.055) + label(idOf(OSM), "NV", 0.0838) + label(idOf(MARIS), "MS", 0.07),
    // Another service's answers sit beside the labels: never read.
    "avalara.jsonl": JSON.stringify({ id: "010df465b5c5ca67", rate: 0.06, raw: { secret: "COMMERCIAL-ANSWER" } }) + "\n",
  });
  split("e1", [EVAL], { "official.jsonl": label(idOf(EVAL), "AK", 0.05) });
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function idOf(row: string) {
  const [state, street, city, zip, date] = row.split(",");
  return createHash("sha256").update(`${state}|${street}|${city}|${zip}|${date}`.toUpperCase()).digest("hex").slice(0, 16);
}

describe("exporting the dev set", () => {
  it("writes each row to the file its source's licence allows, with the canary first", () => {
    run();
    const [meta, ketchikan] = rows("addresses.jsonl");
    expect(meta._meta.canary).toBe("canary-test");
    expect(ketchikan).toMatchObject({ id: "010df465b5c5ca67", street: "716 Buren Road", label: { rate: 0.055 } });
    expect(rows("addresses-osm.jsonl")[1]).toMatchObject({ state: "NV", source: { licence: expect.stringContaining("ODbL") } });
    // No stated licence: where to find it, not its text.
    const ref = rows("addresses-ref.jsonl")[1];
    expect(ref).toMatchObject({ state: "MS", zip: "39401", label: { rate: 0.07 } });
    expect(ref.street).toBeUndefined();
  });

  it("never carries another service's answers", () => {
    run();
    for (const file of fs.readdirSync(path.join(out, "dev")))
      expect(fs.readFileSync(path.join(out, "dev", file), "utf8")).not.toContain("COMMERCIAL-ANSWER");
  });

  it("refuses when a dev split holds an eval address, and writes nothing", () => {
    split("d1", [NAD, EVAL], { "official.jsonl": label("010df465b5c5ca67", "AK", 0.055) + label(idOf(EVAL), "AK", 0.05) });
    expect(run).toThrow(/is an eval address/);
    expect(fs.existsSync(path.join(out, "dev"))).toBe(false);
  });

  it("refuses when an eval split isn't here to check against", () => {
    fs.rmSync(path.join(artifacts, "bench/pool/sets/e1"), { recursive: true });
    expect(run).toThrow(/restore it before exporting/);
  });
});
