#!/usr/bin/env node
import { indexVerifiedPolygons } from "./ingest/verify-polygons.js";
/**
 * opentaxrate <command>
 *   serve                         start the HTTP API on PORT (default 8080)
 *   migrate                       create or update the tables
 *   refresh [STATE...] [--dir D] [--download-dir D] [--force]
 *                                 download and load each state's newest data
 *   ingest [STATE...] [--source ID] [--dir D]
 *                                 index supplemental polygons
 *   ingest --kind taxability [--dir D] [--no-fetch]
 *                                 load the taxability rules (src/taxability/rules) and archive their cited pages
 *   ingest --kind class-rates [STATE...] [--dir D]
 *                                 load the class rates (restaurant, grocery) from the files the loaded rates came from
 *   rate STATE "street" "city" [zip] [date] [--include regions] [--code CODES] [--describe TEXT]
 *                                 look one address up, and how each CODES sale is taxed there
 *   taxability score [--cases DIR] [--list | --gate] [--describe [--out FILE]]
 *                                 the loaded taxability rules against the agencies' own cases (artifacts/taxability/evals);
 *                                 --describe sends each case's facts as describe=, with and without its code
 *                                 (--half A|B: one deterministic half of the cases)
 *   taxability compiled STATE CODE [PART_CODE]
 *                                 the compiled rule table for a place and code: each chain its parts ask, and its dated segments
 *   taxability fetch [--out DIR]  download every cited and watched page again; report what changed (sources.txt, sources.json)
 *   taxability file URL PATH      file a page downloaded by hand in the archive, under its URL
 *   taxability file-answer URL PATH [--method M] [--body-file F] [--from P]
 *                                 file a saved lookup answer (a POST or query) under its request, dated by the file's time
 *   taxability verify [--since REF] [--dir D]
 *                                 the rules changed since REF (default origin/main): each citation archived and its quote on the page
 *   evidence                      upload every source copy the evidence archive lacks, and its catalog (src/evidence.ts)
 *   check --cases file.csv        published cases against the lookup
 *                                 (columns state,street,city,zip,date,expected)
 */
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { client, db } from "./db/client.js";
import { refreshAddressRates } from "./ingest/refresh.js";
import { lookUpRate } from "./lookup.js";
import { refreshSupplemental } from "./ingest/supplemental.js";
import { STATE_FIPS } from "./coverage.js";
import { SUPPLEMENTAL_POLYGONS } from "./ingest/supplemental-sources.js";
import { parseCodes, TAX_CODES } from "./taxability/index.js";

const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && args[i - 1] !== "--force"));

async function main() {
  switch (command) {
    case "serve": {
      const { app } = await import("./server.js");
      const port = Number(process.env.PORT || 8080);
      serve({ fetch: app.fetch, port });
      console.log(`opentaxrate listening on :${port}`);
      return "keep";
    }
    case "migrate":
      await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
      console.log("tables up to date");
      return;
    case "refresh":
      if (args.includes("--download-dir")) {
        const directory = flag("--download-dir");
        if (!directory || directory.startsWith("--")) throw new Error("--download-dir needs a local directory");
        process.env.OPENTAXRATE_DOWNLOAD_DIR = directory;
      }
      await refreshAddressRates({
        states: positional.map((s) => s.toUpperCase()),
        dir: flag("--dir"),
        force: args.includes("--force"),
      });
      return;
    case "ingest": {
      const states = positional.map((s) => s.toUpperCase());
      for (const state of states) if (!STATE_FIPS[state]) throw new Error(`Unknown state ${state}`);
      const kind = flag("--kind") ?? "polygons";
      if (kind === "taxability") {
        const { loadTaxabilityRules } = await import("./taxability/ingest.js");
        await loadTaxabilityRules({ dir: flag("--dir"), fetch: !args.includes("--no-fetch") });
        return;
      }
      if (kind === "class-rates") {
        const { refreshClassRates } = await import("./ingest/class-rates.js");
        await refreshClassRates({ states, dir: flag("--dir") });
        return;
      }
      if (kind !== "polygons") throw new Error("--kind is polygons (the default), taxability or class-rates");
      const source = flag("--source");
      if (source && ![...SUPPLEMENTAL_POLYGONS.map((s) => s.id), "wa-loccode_public", "wa-cities", "wa-ptba", "wa-rta", "mn-tax-areas"].includes(source))
        throw new Error(`Unknown supplemental source ${source}`);
      const sourceState = source?.startsWith("wa-") ? "WA" : source === "mn-tax-areas" ? "MN" : SUPPLEMENTAL_POLYGONS.find((s) => s.id === source)?.state;
      if (sourceState && states.length && !states.includes(sourceState)) throw new Error(`Source ${source} belongs to ${sourceState}`);
      await refreshSupplemental({ states, dir: flag("--dir"), sources: source ? [source] : [] });
      await indexVerifiedPolygons({ states });
      return;
    }
    case "rate": {
      const [state, street, city, zip, date] = positional;
      const include = (flag("--include") ?? "").split(",");
      const codes = parseCodes(flag("--code") ?? "");
      if ("unknown" in codes) throw new Error(`--code "${codes.unknown}" isn't one of: ${Object.keys(TAX_CODES).join(", ")}`);
      const describe = flag("--describe");
      if (describe && codes.codes.length > 1) throw new Error("--describe names one item: give it alone, or beside one code.");
      if (describe !== undefined && (!describe.trim() || describe.trim().length > 200)) throw new Error("--describe takes 1 to 200 characters, as the API does.");
      console.log(JSON.stringify(await lookUpRate({ state, street, city, zip, date, codes: codes.codes, ...(describe ? { describe } : {}) }, { regions: include.includes("regions") }), null, 2));
      return;
    }
    case "taxability": {
      if (positional[0] === "fetch") {
        const { fetchTaxabilitySources, describeSourceChecks } = await import("./taxability/fetch.js");
        const { mkdirSync, writeFileSync } = await import("node:fs");
        const out = flag("--out") ?? `artifacts/maintenance/taxability-${new Date().toISOString().slice(0, 10)}`;
        const checks = await fetchTaxabilitySources();
        const report = describeSourceChecks(checks);
        mkdirSync(out, { recursive: true });
        writeFileSync(`${out}/sources.json`, JSON.stringify(checks, null, 2) + "\n");
        writeFileSync(`${out}/sources.txt`, report);
        console.log(report.split("\n")[0]);
        console.log(`Report: ${out}/sources.txt`);
        return;
      }
      if (positional[0] === "file") {
        // A page downloaded by hand (a site that blocks scripts), filed in
        // the archive under the URL it came from.
        const [, url, file] = positional;
        if (!url || !file) throw new Error("taxability file URL PATH");
        const { keepLocalCopy } = await import("./ingest/archive.js");
        const { fileNameFor } = await import("./taxability/fetch.js");
        const { readFileSync } = await import("node:fs");
        if (!(await keepLocalCopy(url, file, fileNameFor(url, new Uint8Array(readFileSync(file)))))) throw new Error(`${file} wasn't filed.`);
        console.log(`Filed ${file} as ${url}`);
        return;
      }
      if (positional[0] === "file-answer") {
        // A lookup service's answer saved earlier (a POST or query), filed
        // under its request so different answers don't stack as versions of
        // one page; dated by the file's download time.
        const [, url, file] = positional;
        if (!url || !file) throw new Error("taxability file-answer URL PATH [--method POST] [--body-file F] [--from PATH]");
        const { fileAnswer } = await import("./ingest/archive.js");
        const { method } = await fileAnswer(url, file, { method: flag("--method"), bodyFile: flag("--body-file"), from: flag("--from") });
        console.log(`Filed ${file} as ${method} ${url}`);
        return;
      }
      if (positional[0] === "verify") {
        const { verifyChangedRules } = await import("./taxability/fetch.js");
        const ref = flag("--since") ?? "origin/main";
        const { changed, removed, problems } = verifyChangedRules(ref, flag("--dir"));
        console.log(`${changed.length} rules added or changed since ${ref}${changed.length ? ":" : "."}`);
        for (const c of changed) console.log(`  ${c}`);
        if (removed.length) {
          console.log(`${removed.length} rules removed since ${ref}; a person approves removals:`);
          for (const r of removed) console.log(`  ${r}`);
          process.exitCode = 1;
        }
        if (problems.length) {
          console.log(`${problems.length} citations don't check:`);
          for (const p of problems) console.log(`  ${p}`);
          process.exitCode = 1;
        }
        return;
      }
      if (positional[0] === "compiled") {
        // The compiled table (src/taxability/compile.ts) for one place and
        // code: each chain its parts ask, and that chain's dated segments.
        const [, place, code, partCode] = positional;
        if (!place || !code) throw new Error("taxability compiled STATE CODE [PART_CODE]");
        const { isTaxCode, loadRules, compiledOf } = await import("./taxability/index.js");
        if (!isTaxCode(code)) throw new Error(`${code} isn't a code: ${Object.keys(TAX_CODES).join(", ")}`);
        const { isProvince, provinceParts } = await import("./rates/canada.js");
        const { SELF_COLLECTED, selfCollected } = await import("./taxability/self-collected.js");
        const state = place.toUpperCase();
        const compiled = compiledOf(await loadRules());
        // A province's taxes; a state's state part and a local part (the one
        // named, else any local part without a rule of its own, and a
        // self-collected city's where the state has any).
        const self = Object.keys(SELF_COLLECTED[state]?.parts ?? {}).find((c) => !compiled.chainOf(state, { kind: "city", code: c }).includes(`${state}:local:${c}`));
        const parts: Array<{ kind: "state" | "city"; code: string; label: string }> = isProvince(state)
          ? provinceParts(state, new Date().toISOString().slice(0, 10)).map((p) => ({ kind: "state" as const, code: p.code, label: p.code }))
          : [
              { kind: "state", code: `${state}:state`, label: "state part" },
              ...(partCode
                ? [{ kind: "city" as const, code: partCode, label: `local part ${partCode}${selfCollected(state, partCode) ? " (self-collected)" : ""}` }]
                : [{ kind: "city" as const, code: "", label: "local part" }, ...(self ? [{ kind: "city" as const, code: self, label: `self-collected local part (${self}, ...)` }] : [])]),
            ];
        const pct = (n: number) => `${+(n * 100).toFixed(4)}%`;
        for (const part of parts) {
          const chain = compiled.chainOf(state, part);
          console.log(`${state} ${code}, ${part.label}: chain ${chain.join(" > ") || "(no key with rules)"}`);
          // A segment that holds no whole day (between a rule's last day and
          // the next one's first, for an impossible date) isn't shown.
          for (const { from, to, rule } of compiled.segments(chain, code).filter((s) => !s.from || !s.to || s.from <= s.to)) {
            const days = `${from ?? "..."} to ${to ?? "..."}`.padEnd(28);
            if (!rule) {
              console.log(`  ${days} not researched`);
              continue;
            }
            const how = [rule.treatment, rule.rate !== undefined ? pct(rule.rate) : "", rule.rateClass ? `${rule.rateClass} rate` : "", rule.base !== undefined ? `on ${pct(rule.base)} of the charge` : ""].filter(Boolean).join(" ");
            console.log(`  ${days} ${rule.tax} ${how} (rule ${rule.from}${rule.to ? ` to ${rule.to}` : ""}, ${rule.fromIs}): ${rule.summary.length > 110 ? `${rule.summary.slice(0, 110)}...` : rule.summary}`);
            for (const k of rule.conditions) console.log(`      ${k.treatment}${k.rate !== undefined ? ` ${pct(k.rate)}` : ""}${k.rateClass ? ` ${k.rateClass} rate` : ""}: ${k.when.length > 120 ? `${k.when.slice(0, 120)}...` : k.when}`);
          }
        }
        return;
      }
      if (positional[0] && positional[0] !== "score") throw new Error("taxability takes score, compiled, fetch, file, file-answer or verify");
      const { scoreTaxability, printScore } = await import("./taxability/evaluate.js");
      const { loadRules } = await import("./taxability/index.js");
      const rules = await loadRules();
      if (!rules.size) throw new Error("taxability_rules is empty: run `pnpm ingest --kind taxability` first.");
      if (args.includes("--describe")) {
        const { scoreDescribed, printDescribed } = await import("./taxability/describe-bench.js");
        const half = flag("--half");
        if (half && half !== "A" && half !== "B") throw new Error("--half is A or B");
        const { scored, asked, calls } = await scoreDescribed(rules, { dir: flag("--cases"), ...(half ? { half: half as "A" | "B" } : {}) });
        printDescribed(scored, { list: args.includes("--list"), out: flag("--out") });
        console.log(`picker answers added to the cache: ${asked} (${calls} calls)`);
        return;
      }
      const scored = scoreTaxability(rules, flag("--cases"));
      // --gate: one line for the monthly gate, the case set's fingerprint
      // and every wrong case's id (scripts/rates taxability-check).
      if (args.includes("--gate")) {
        const { casesHash } = await import("./taxability/evaluate.js");
        console.log(`taxability-wrong: ${casesHash(flag("--cases"))} ${scored.filter((s) => s.outcome === "wrong").map((s) => s.case.id).join(" ")}`.trimEnd());
        return;
      }
      printScore(scored, { list: args.includes("--list") });
      return;
    }
    case "evidence": {
      // The public evidence archive (src/evidence.ts): every source copy to R2, and its catalog.
      const { uploadEvidence } = await import("./evidence.js");
      const { uploaded, kept, bytes, texts, marks, crops } = await uploadEvidence();
      console.log(`Evidence: ${uploaded} copies uploaded (${(bytes / 1e6).toFixed(1)} MB), ${kept} already there; ${texts} texts sent (${marks} quotes marked); catalog updated.`);
      if (crops) console.log(`Crops: ${crops.cropped} pages' content picked out by a model, ${crops.unusable} unusable answers, ${crops.failed} failed, ${crops.waiting} left${crops.stopped ? " at the budget" : ""}; spent $${crops.spent.toFixed(4)}.`);
      else console.log("Crops: skipped (no OPENROUTER_API_KEY).");
      return;
    }
    case "check":
      return check(flag("--cases"));
    default:
      console.log(readFileSync(new URL(import.meta.url), "utf8").split("*/")[0].replace(/^[\s\S]*?\/\*\*\n/, "").replace(/^ \* ?/gm, ""));
  }
}

/** Each case through the same lookup the API answers with. */
async function check(file?: string) {
  if (!file) throw new Error("check needs --cases file.csv");
  const [header, ...lines] = readFileSync(file, "utf8").trim().split(/\r?\n/);
  const at = Object.fromEntries(header.split(",").map((h, i) => [h.trim(), i]));
  let agree = 0, refused = 0;
  const differ: string[] = [];
  for (const line of lines) {
    const c = line.split(",");
    const expected = Number(c[at.expected]);
    try {
      const found = await lookUpRate({ state: c[at.state], street: c[at.street], city: c[at.city], zip: c[at.zip] || undefined, date: c[at.date] || undefined });
      if (Math.abs(found.rate - expected) < 1e-6) agree++;
      else differ.push(`${c[at.street]}, ${c[at.city]}: ${found.rate} (${found.match}), expected ${expected}`);
    } catch {
      refused++;
    }
  }
  console.log(`${lines.length} cases: ${agree} agree, ${differ.length} differ, ${refused} refused`);
  for (const d of differ) console.log(`  ≠ ${d}`);
}

main()
  .then(async (keep) => {
    if (keep !== "keep") await client.end();
  })
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    await client.end();
  });
