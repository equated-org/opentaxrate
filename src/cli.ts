#!/usr/bin/env node
import { indexVerifiedPolygons } from "./ingest/verify-polygons.js";
/**
 * opentaxrate <command>
 *   serve                         start the HTTP API on PORT (default 8080)
 *   migrate                       create or update the tables
 *   refresh [STATE...] [--dir D] [--download-dir D] [--force]
 *                                 download and load each state's newest data
 *   ingest [STATE...] [--source ID] [--dir D]
 *                                 index supplemental polygons (transaction rules unsupported)
 *   rate STATE "street" "city" [zip] [date]
 *                                 look one address up
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
      if (kind === "rules" || kind === "all")
        throw new Error("Transaction-rule ingestion is disabled: nationwide policy coverage and calculation support are incomplete. Only supplemental polygons are enabled.");
      if (kind !== "polygons") throw new Error("Only --kind polygons is supported");
      const source = flag("--source");
      if (source && ![...SUPPLEMENTAL_POLYGONS.map((s) => s.id), "wa-loccode_public", "wa-cities", "wa-ptba", "wa-rta"].includes(source))
        throw new Error(`Unknown supplemental source ${source}`);
      const sourceState = source?.startsWith("wa-") ? "WA" : SUPPLEMENTAL_POLYGONS.find((s) => s.id === source)?.state;
      if (sourceState && states.length && !states.includes(sourceState)) throw new Error(`Source ${source} belongs to ${sourceState}`);
      await refreshSupplemental({ states, dir: flag("--dir"), sources: source ? [source] : [] });
      await indexVerifiedPolygons({ states });
      return;
    }
    case "rate": {
      const [state, street, city, zip, date] = positional;
      console.log(JSON.stringify(await lookUpRate({ state, street, city, zip, date }), null, 2));
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
