// One address through the engine with replayed geocodes, printing the answer,
// every point the locator returned and the outlines it was read on.
//
//   npx tsx scripts/tuning/one.mts REPLAY_FILE ID STATE "STREET" CITY ZIP
//
// REPLAY_FILE is a trial's artifacts/tuning/replay-<split>.json and ID the
// address's bench id. OTR_PARAMS and STATE_LOOKUPS apply, but the state
// lookups, the Census's checks and Jev are asked live, not replayed, and a
// geocoder missing from the file fails: an answer can differ from a trial's.
// DATE (default 2026-10-21) is the sale date.
import fs from "node:fs";
import { addressRates, emptyTrace } from "../../src/rates/index.ts";
import { createLocator } from "../../src/geocoding/locator.ts";
import { geocoderProviders } from "../../src/geocoding/registry.ts";
const [replayFile, id, state, street, city, zip] = process.argv.slice(2);
const replay = JSON.parse(fs.readFileSync(replayFile, "utf8"));
const c = { state, street, city, zip };
const providers = geocoderProviders().map((p) => ({ ...p, async geocode() { const r = replay[`${p.id}|${id}`]; if (r === undefined) throw new Error("not replayed"); return r; } }));
const ltrace: any[] = [];
const locate = createLocator(c as any, { providers, budget: { reserve: async () => true, success: async () => {}, failure: async () => {} } as any, cache: { get: async () => undefined, put: async () => {} } });
const wrapped = async (need?: any) => { const p = await locate(need); ltrace.push({ need, p }); return p; };
const std = replay[`standardize|${id}`];
const trace = emptyTrace();
try {
  const r = await addressRates.at({ ...c, locate: wrapped, standardize: async () => std ?? null, trace } as any, process.env.DATE ?? "2026-10-21");
  console.log("ANSWER", r.rate, r.match, r.source);
} catch (e: any) { console.log("REFUSED", e.message); }
console.log("locate calls", JSON.stringify(ltrace));
console.log("trace", JSON.stringify({ point: trace.point, range: trace.range, outlines: trace.outlines?.map((o: any) => [o.kind, o.fips, o.name, o.inside, Math.round(o.edgeMetres ?? -1)]) }).slice(0, 1500));
process.exit(0);
