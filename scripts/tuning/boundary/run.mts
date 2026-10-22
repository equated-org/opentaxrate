// The engine's answer at every boundary-benchmark point: the point is the
// address's placement, so this measures the outlines, rate tables and edge
// rules alone, with no geocoder and no live state lookup.
//
//   MARGIN=15 npx tsx scripts/tuning/boundary/run.mts NAME STATE...
//
// MARGIN (metres, default 15, a rooftop geocode's) is the point's margin:
// MARGIN=0 reads the exact point, so every disagreement with the state is
// one of data; a wider margin shows what the edge rules decline. It sets
// minMarginMetres.rooftop on top of OTR_PARAMS. A sharper point is never
// available. Writes $BOUNDARY_DIR/<STATE>/runs/NAME.jsonl, one line per
// point and date: {id, rate, parts, locationCode, match, jurisdictions,
// alternatives} or {id, refused}.
import fs from "node:fs";
import path from "node:path";

const [name, ...states] = process.argv.slice(2);
if (!name || !states.length) {
  console.error("usage: MARGIN=15 run.mts NAME STATE...");
  process.exit(1);
}
const margin = Number(process.env.MARGIN ?? 15);
const given = process.env.OTR_PARAMS ? JSON.parse(process.env.OTR_PARAMS) : {};
process.env.OTR_PARAMS = JSON.stringify({ ...given, minMarginMetres: { ...given.minMarginMetres, rooftop: margin } });
delete process.env.STATE_LOOKUPS;
const ROOT = process.env.BOUNDARY_DIR || new URL("../../../artifacts/bench/boundary/", import.meta.url).pathname;

const { addressRates } = await import("../../../src/rates/index.ts");
const { client } = await import("../../../src/db/client.ts");

for (const state of states) {
  const lines = fs.readFileSync(path.join(ROOT, state, "points.csv"), "utf8").trim().split("\n");
  const head = lines[0].split(",");
  const points = lines.slice(1).map((l) => Object.fromEntries(l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((v, i) => [head[i], v])));
  const out: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < points.length) {
      const p = points[next++];
      const point = { lon: Number(p.lon), lat: Number(p.lat), accuracy: "rooftop" as const, placedBy: ["benchmark"] };
      try {
        const r = await addressRates.at(
          { state, street: "", city: "", zip: null, locate: async (need) => (need ? null : point), pickStreet: null },
          p.date,
        );
        const parts = (ps: typeof r.parts) => ps.map((x) => ({ kind: x.kind, code: x.code, name: x.name ?? null, rate: x.rate, ids: x.ids ?? {} }));
        out.push(JSON.stringify({ id: p.id, rate: r.rate, match: r.match, locationCode: r.locationCode, parts: parts(r.parts),
          jurisdictions: r.jurisdictions, alternatives: r.alternatives.map((a) => ({ locationCode: a.locationCode, parts: parts(a.parts) })) }));
      } catch (error) {
        if (!(error instanceof Error) || error.constructor.name !== "RateError") throw error;
        out.push(JSON.stringify({ id: p.id, refused: error.message }));
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  fs.mkdirSync(path.join(ROOT, state, "runs"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, state, "runs", `${name}.jsonl`), out.join("\n") + "\n");
  console.log(`${state}: ${out.length} answers → runs/${name}.jsonl (margin ${margin} m)`);
}
await client.end();
