// The public benchmark dataset (equated-org/opentaxrate-bench): written from
// this machine's artifacts, and read back into them on another.
//
//   npx tsx scripts/bench-data.mts export OUT       the dev sets of bench/benchmark.json into OUT
//   npx tsx scripts/bench-data.mts import DIR       a downloaded dataset into artifacts/bench
//
// `pnpm bench export|fetch` call these. Export writes only dev sets, from an
// allow-list of fields, and stops if any eval address would be published or
// if a row's source has no licence that lets it be. Rows are one JSON object
// a line; each file's first line is {"_meta": {...}} with the canary.
//
//   dev/addresses.jsonl      addresses from public-domain or permissive sources, with labels
//   dev/addresses-osm.jsonl  OpenStreetMap addresses (ODbL 1.0), with labels
//   dev/addresses-ref.jsonl  addresses from sources with no stated licence: where
//                            to find them (file, point, ZIP), and their labels
//   dev/history.jsonl        dev addresses on past dates, with those dates' labels
//   dev/typos.jsonl          dev addresses typed with mistakes, with labels
//                            (each set's OpenStreetMap and unlicensed rows are in
//                            the two files above; `split` says which set a row is in)
//   dev/boundary.jsonl       points near lines, labelled at the point
//   registry.json            every version: its files, rows, SHA-256s and counts
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = new URL("..", import.meta.url).pathname;
// BENCH_ARTIFACTS and BENCH_CONFIG point elsewhere, for tests and for
// reading a dataset back into a scratch folder.
const ARTIFACTS = process.env.BENCH_ARTIFACTS || path.join(ROOT, "artifacts");
const POOL = path.join(ARTIFACTS, "bench/pool");
const BOUNDARY = path.join(ARTIFACTS, "bench/boundary");
const config = JSON.parse(fs.readFileSync(process.env.BENCH_CONFIG || path.join(ROOT, "bench/benchmark.json"), "utf8")) as {
  version: string; repo: string; canary: string;
  dev: string[]; eval: string[];
  history: { dev: string[]; eval: string[] }; typos: { dev: string[] }; boundary: string[];
};

type Row = Record<string, string>;
type Label = { rate?: number; refused?: string; asked: string; oracle: string; detail?: unknown };

function csv(file: string): Row[] {
  const [head, ...lines] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",");
  const split = (line: string) => line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, cols.length)
    .map((v) => v.replace(/,$/, "").replace(/^"(.*)"$/s, "$1").replace(/""/g, '"'));
  return lines.map((l) => Object.fromEntries(split(l).map((v, i) => [cols[i], v])));
}
const jsonl = (file: string) => fs.existsSync(file)
  ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const caseId = (r: Row) => createHash("sha256")
  .update(`${r.state.trim()}|${r.street.trim()}|${r.city.trim()}|${r.zip.trim()}|${(r.date || "2026-10-21").trim()}`.toUpperCase())
  .digest("hex").slice(0, 16);
const addressKey = (r: Row) => [r.state, r.street, r.city, r.zip].map((v) => v.replace(/\s+/g, " ").trim().toUpperCase()).join("|");

/** A split's official labels by case id, in one shape: the pool's
 *  {raw: {oracle, detail}} and the boundary labeller's {oracle, parts}. */
function labels(file: string): Map<string, Label> {
  return new Map(jsonl(file).map((a) => [a.id, {
    ...("rate" in a ? { rate: a.rate } : { refused: a.refused }),
    asked: a.at,
    oracle: a.raw?.oracle ?? a.oracle,
    detail: a.raw?.detail ?? (a.parts ? { parts: a.parts, ...a.detail } : a.detail) ?? undefined,
  }]));
}

/** OpenAddresses' licence for each source file, from the sample's README
 *  table (the source definitions' `license` field). */
function oaLicences(): Map<string, string> {
  const file = path.join(POOL, "sets/oa-README.md");
  const out = new Map<string, string>();
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\| (us\/\S+) \| \d+ \| \d+ \| [^|]* \| [^|]* \| (.*)\|\s*$/.exec(line);
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
}
/** Public domain, CC0, PDDL, CC BY and ODC-BY let a row be republished
 *  with attribution; share-alike, "not stated" and bespoke terms don't. */
const permissive = (licence: string) => {
  const l = licence.toLowerCase();
  if (/by-sa|share-?alike|odbl|not stated/.test(l)) return false;
  return /public domain|cc0|pddl|cc by|creative commons attribution|odc-by/.test(l);
};

/** Where a row goes and under what licence. */
function placement(r: Row, oa: Map<string, string>): { file: "addresses" | "addresses-osm" | "addresses-ref"; dataset: string; licence: string } {
  const [kind, rest = ""] = r.source.split(/:(.*)/s);
  if (kind === "NAD") return { file: "addresses", dataset: "USDOT National Address Database", licence: "public domain" };
  if (kind === "OSM") return { file: "addresses-osm", dataset: "OpenStreetMap", licence: "ODbL 1.0, © OpenStreetMap contributors" };
  if (kind === "OA") {
    const licence = oa.get(rest.split("#")[0]) ?? "not stated in the OA source definition";
    return { file: permissive(licence) ? "addresses" : "addresses-ref", dataset: `OpenAddresses ${rest}`, licence };
  }
  // Mississippi's MARIS parcels state no licence.
  return { file: "addresses-ref", dataset: r.source || "unknown", licence: "not stated" };
}

function writeJsonl(file: string, meta: Record<string, unknown>, rows: unknown[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = [JSON.stringify({ _meta: { ...meta, canary: config.canary } }), ...rows.map((r) => JSON.stringify(r))].join("\n") + "\n";
  fs.writeFileSync(file, text);
  return { rows: rows.length, sha256: createHash("sha256").update(text).digest("hex") };
}

function exportDev(out: string) {
  // Every eval address, by id and by address, so none can be published.
  const evalIds = new Set<string>(), evalAddresses = new Set<string>();
  for (const split of [...config.eval, ...config.history.eval]) {
    const file = path.join(POOL, "sets", split, "cases.csv");
    if (!fs.existsSync(file)) throw new Error(`Eval split ${split} isn't here: restore it before exporting, or the check can't run.`);
    for (const r of csv(file)) { evalIds.add(caseId(r)); evalAddresses.add(addressKey(r)); }
  }
  const leak = (r: Row, id: string, split: string) => {
    if (evalIds.has(id) || evalAddresses.has(addressKey(r)))
      throw new Error(`${split} case ${id} (${r.state} ${r.street}, ${r.city}) is an eval address: nothing exported.`);
  };
  const oa = oaLicences();
  const files: Record<string, unknown[]> = { "addresses": [], "addresses-osm": [], "addresses-ref": [], history: [], typos: [], boundary: [] };
  const counts: Record<string, { cases: number; labelled: number }> = {};

  const addressRows = (split: string, kind: "addresses" | "history" | "typos") => {
    const known = labels(path.join(POOL, "answers", split, "official.jsonl"));
    counts[split] = { cases: 0, labelled: 0 };
    for (const r of csv(path.join(POOL, "sets", split, "cases.csv"))) {
      const id = caseId(r);
      leak(r, id, split);
      const label = known.get(id);
      if (!label) continue;
      const where = placement(r, oa);
      counts[split].cases++;
      if (label.rate !== undefined) counts[split].labelled++;
      const point = { lon: Number(r.lon), lat: Number(r.lat) };
      const base = { id, split, state: r.state, date: r.date || "2026-10-21", source: { dataset: where.dataset, licence: where.licence }, label };
      // A row whose source states no licence keeps where to find it, not its text.
      const row = where.file === "addresses-ref"
        ? { ...base, zip: r.zip, ...point }
        : { ...base, street: r.street, city: r.city, zip: r.zip, ...point, ...(r.notes ? { notes: r.notes } : {}) };
      // OpenStreetMap and unlicensed rows keep to their own files, whatever set
      // they're in, so every other file is public domain or permissive.
      files[where.file === "addresses" ? (kind === "addresses" ? "addresses" : kind) : where.file].push(row);
    }
  };
  for (const split of config.dev) addressRows(split, "addresses");
  for (const split of config.history.dev) addressRows(split, "history");
  for (const split of config.typos.dev) addressRows(split, "typos");

  for (const state of config.boundary) {
    const known = labels(path.join(BOUNDARY, state, "official.jsonl"));
    for (const p of csv(path.join(BOUNDARY, state, "points.csv"))) {
      const label = known.get(p.id);
      if (!label) continue;
      files.boundary.push({ id: p.id, state, lon: Number(p.lon), lat: Number(p.lat), date: p.date, stratum: p.stratum,
        near: p.near_kind ? { kind: p.near_kind, code: p.near_fips, name: p.near_name, metres: Number(p.edge_m) } : null, label });
    }
  }

  const written: Record<string, { rows: number; sha256: string }> = {};
  for (const [name, rows] of Object.entries(files))
    written[`dev/${name}.jsonl`] = writeJsonl(path.join(out, "dev", `${name}.jsonl`), { file: name, version: config.version }, rows);
  // The registry keeps every version; this one replaces an entry of the same name.
  const registryFile = path.join(out, "registry.json");
  const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, "utf8")) : { versions: [] };
  registry.canary = config.canary;
  registry.versions = [
    { version: config.version, exported: new Date().toISOString().slice(0, 10), files: written, splits: counts },
    ...registry.versions.filter((v: { version: string }) => v.version !== config.version),
  ];
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + "\n");
  const licences = new Map<string, number>();
  for (const rows of Object.values(files)) for (const r of rows as Array<{ source?: { dataset: string; licence: string } }>)
    if (r.source) licences.set(`${r.source.dataset} | ${r.source.licence}`, (licences.get(`${r.source.dataset} | ${r.source.licence}`) ?? 0) + 1);
  fs.writeFileSync(path.join(out, "ATTRIBUTION.md"), [
    "# Sources and licences", "",
    `Rows in version ${config.version}, by the source each address came from and its licence. Labels are the states' own published answers.`, "",
    "| Rows | Source | Licence |", "|---|---|---|",
    ...[...licences].sort((a, b) => b[1] - a[1]).map(([k, n]) => { const [d, l] = k.split(" | "); return `| ${n} | ${d} | ${l.replace(/\|/g, "/")} |`; }),
    "", "OpenStreetMap rows are in dev/addresses-osm.jsonl under ODbL 1.0: credit \"© OpenStreetMap contributors\" and share any database made from them under ODbL.",
    "Rows whose source states no licence (dev/addresses-ref.jsonl) give where to find the address (source file, point, ZIP), not its text.", "",
  ].join("\n"));
  for (const [name, w] of Object.entries(written)) console.log(`${name}: ${w.rows} rows`);
  console.log(`checked: no id or address of ${evalIds.size} eval cases is in the export`);
}

/** A downloaded dataset back into artifacts/bench, in the layout
 *  scripts/bench reads. Rows without their text can't be asked, and are
 *  counted, not written. A split or label already here is kept. */
function importDev(dir: string) {
  const bySplit = new Map<string, Array<Record<string, any>>>();
  let withheld = 0;
  for (const name of ["addresses", "addresses-osm", "history", "typos"]) {
    for (const r of jsonl(path.join(dir, "dev", `${name}.jsonl`)).slice(1)) {
      if (!r.street) { withheld++; continue; }
      bySplit.set(r.split, [...(bySplit.get(r.split) ?? []), r]);
    }
  }
  for (const r of jsonl(path.join(dir, "dev", "addresses-ref.jsonl")).slice(1)) { withheld++; void r; }
  const q = (v: string) => (/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  for (const [split, rows] of bySplit) {
    const sets = path.join(POOL, "sets", split), answers = path.join(POOL, "answers", split);
    if (fs.existsSync(path.join(sets, "cases.csv"))) { console.log(`${split}: here already, kept`); continue; }
    fs.mkdirSync(sets, { recursive: true }); fs.mkdirSync(answers, { recursive: true });
    fs.writeFileSync(path.join(sets, "cases.csv"), ["state,street,city,zip,date,expected,source,lon,lat,notes",
      ...rows.map((r) => [r.state, r.street, r.city, r.zip, r.date, "", r.source.dataset, r.lon, r.lat, r.notes ?? ""].map((v) => q(String(v))).join(","))].join("\n") + "\n");
    fs.writeFileSync(path.join(answers, "official.jsonl"), rows.map((r) => JSON.stringify({
      id: r.id, state: r.state, at: r.label.asked, ...(r.label.rate !== undefined ? { rate: r.label.rate } : { refused: r.label.refused }),
      raw: { oracle: r.label.oracle, detail: r.label.detail } })).join("\n") + "\n");
    console.log(`${split}: ${rows.length} cases`);
  }
  const boundary = jsonl(path.join(dir, "dev", "boundary.jsonl")).slice(1);
  for (const state of [...new Set(boundary.map((p) => p.state))]) {
    const folder = path.join(BOUNDARY, state);
    if (fs.existsSync(path.join(folder, "points.csv"))) { console.log(`boundary ${state}: here already, kept`); continue; }
    const mine = boundary.filter((p) => p.state === state);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "points.csv"), ["id,state,lon,lat,date,stratum,near_kind,near_fips,near_name,edge_m",
      ...mine.map((p) => [p.id, state, p.lon, p.lat, p.date, p.stratum, p.near?.kind ?? "", p.near?.code ?? "", p.near?.name ?? "", p.near?.metres ?? ""].map((v) => q(String(v))).join(","))].join("\n") + "\n");
    fs.writeFileSync(path.join(folder, "official.jsonl"), mine.map((p) => JSON.stringify({
      id: p.id, state, date: p.date, oracle: p.label.oracle, at: p.label.asked,
      ...(p.label.rate !== undefined ? { rate: p.label.rate, parts: p.label.detail?.parts ?? [] } : { refused: p.label.refused }) })).join("\n") + "\n");
    console.log(`boundary ${state}: ${mine.length} point-dates`);
  }
  if (withheld) console.log(`${withheld} rows give where to find the address, not its text, and aren't asked`);
}

const [command, target] = process.argv.slice(2);
if (command === "export" && target) exportDev(target);
else if (command === "import" && target) importDev(target);
else { console.error("usage: bench-data.mts export OUT | import DIR"); process.exit(1); }
