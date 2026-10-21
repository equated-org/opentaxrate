#!/usr/bin/env node
/**
 * opentaxrate <command>
 *   serve                         start the HTTP API on PORT (default 8080)
 *   migrate                       create or update the tables
 *   refresh [STATE...] [--dir D] [--force]
 *                                 download and load each state's newest data
 *   rate STATE "street" "city" [zip] [date]
 *                                 look one address up
 *   check --cases file.csv        published cases against the lookup
 *                                 (columns state,street,city,zip,date,expected)
 */
import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { client, db } from "./db.js";
import { refreshAddressRates } from "./engine/refresh.js";
import { lookUpRate } from "./lookup.js";

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
      await refreshAddressRates({
        states: positional.map((s) => s.toUpperCase()),
        dir: flag("--dir"),
        force: args.includes("--force"),
      });
      return;
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
