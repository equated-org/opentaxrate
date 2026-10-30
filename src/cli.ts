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
 *   rate STATE "street" "city" [zip] [date] [--include regions] [--code CODES]
 *                                 look one address up, and how each CODES sale is taxed there
 *   taxability score [--cases DIR] [--list]
 *                                 the loaded taxability rules against the agencies' own cases (artifacts/taxability/evals)
 *   taxability fetch [--out DIR]  download every cited and watched page again; report what changed (sources.txt, sources.json)
 *   taxability verify [--since REF]
 *                                 the rules changed since REF (default origin/main): each citation archived and its quote on the page
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
      if (kind !== "polygons") throw new Error("--kind is polygons (the default) or taxability");
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
      console.log(JSON.stringify(await lookUpRate({ state, street, city, zip, date, codes: codes.codes }, { regions: include.includes("regions") }), null, 2));
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
      if (positional[0] === "verify") {
        const { verifyChangedRules } = await import("./taxability/fetch.js");
        const ref = flag("--since") ?? "origin/main";
        const { changed, problems } = verifyChangedRules(ref);
        console.log(`${changed.length} rules added or changed since ${ref}${changed.length ? ":" : "."}`);
        for (const c of changed) console.log(`  ${c}`);
        if (problems.length) {
          console.log(`${problems.length} citations don't check:`);
          for (const p of problems) console.log(`  ${p}`);
          process.exitCode = 1;
        }
        return;
      }
      if (positional[0] && positional[0] !== "score") throw new Error("taxability takes score, fetch or verify");
      const { scoreTaxability, printScore } = await import("./taxability/evaluate.js");
      const { loadRules } = await import("./taxability/index.js");
      const rules = await loadRules();
      if (!rules.size) throw new Error("taxability_rules is empty: run `pnpm ingest --kind taxability` first.");
      printScore(scoreTaxability(rules, flag("--cases")), { list: args.includes("--list") });
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
