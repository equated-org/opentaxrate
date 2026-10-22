/**
 * Moves raw source files saved before artifacts/sources existed into it:
 * the per-URL hash folders refresh used to write (artifacts/<sha256>/,
 * and any folder of them given), and loose copies of published files
 * (old editions kept elsewhere) given with --loose.
 *
 *   tsx scripts/organize-sources.ts <artifacts> [--hashed <dir>]... [--loose <dir>]... [--dry-run]
 *
 * A hash folder's URL is found by trying the URLs refresh builds for its file
 * name and keeping the one whose sha256 is the folder's name; a loose file's
 * from its name alone (and, for a renamed Missouri workbook, its header).
 * Where several copies land on one URL, the newest is current and older
 * different contents go to previous/<date>-<id>-<name>; identical copies are
 * dropped. A hash folder whose URL can't be rebuilt from its file names (an
 * ArcGIS query page) moves whole to sources/_unknown-url/<hash>/; a loose
 * file not matched is left in place and listed.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sourcePath } from "../src/ingest/archive.js";
import { readXlsx } from "../src/ingest/states/sources.js";

const SITE = "https://www.streamlinedsalestax.org/ratesandboundry";
const TIGER = "https://www2.census.gov/geo/tiger";
const MO = "https://dor.mo.gov/taxation/business/tax-types/sales-use/documents";
const AZ = "https://azdor.gov/sites/default/files/document";
const TX = "https://comptroller.texas.gov";
const IL = "https://tax.illinois.gov/content/dam/soi/en/web/tax/research/taxrates/documents/salestaxrates";
const AL = "https://www.revenue.alabama.gov/wp-content/uploads/2024/03/taxrates.csv";
const VA = "https://www.tax.virginia.gov/sites/default/files/inline-files/sales-and-use-tax-rates-by-locality-by-date.xlsx";
const MT = "https://revenuefiles.mt.gov/taxes/miscellaneous/local-resort-tax";

/** The URLs refresh would have fetched a file of this name from, with the
 *  name it saved it under. */
function candidates(name: string): Array<{ url: string; name?: string }> {
  const sst = /^[A-Z]{2}([RB])\d{4}Q\d/i.exec(name);
  if (sst) return [{ url: `${SITE}/${sst[1].toUpperCase() === "R" ? "Rates" : "Boundary"}/${name}` }];
  const tiger = /^tl_(\d{4})_(us_county|\d{2}_place|\d{2}_cousub|\d{5}_addrfeat)\.zip$/.exec(name);
  if (tiger) {
    const kind = tiger[2] === "us_county" ? "COUNTY" : tiger[2].split("_")[1].toUpperCase();
    return [{ url: `${TIGER}/TIGER${tiger[1]}/${kind}/${name}` }];
  }
  if (/^cb_2020_/.test(name)) return [{ url: `${TIGER}/GENZ2020/shp/${name}` }];
  if (/^dor-/.test(name)) return [{ url: `${MO}/${name}` }];
  if (/^TPT_RATETABLE_ALL_/.test(name)) return [{ url: `${AZ}/${name}` }];
  if (/^taxrates\d*\.txt$/.test(name)) return [{ url: `${TX}/data/edi/sales-tax/${name}` }];
  if (name === "city-rates.xlsx") return [{ url: `${TX}/taxes/sales/docs/city-rates.xlsx` }];
  if (name === "spd.php") return [{ url: `${TX}/taxes/sales/spd.php`, name }];
  if (/^ordmach[ae]-/.test(name)) return [{ url: `${IL}/${name}` }];
  if (name === "taxrates.csv") return [{ url: AL, name }];
  if (name === "sales-and-use-tax-rates-by-locality-by-date.xlsx") return [{ url: VA }];
  if (name === "mt-local-resort-tax.html") return [{ url: MT, name }];
  return [];
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const fileSha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

interface Found {
  file: string;
  url: string;
  name?: string;
}

const args = process.argv.slice(2);
const artifacts = path.resolve(args[0] ?? "artifacts");
const dryRun = args.includes("--dry-run");
const listOf = (flag: string) => args.flatMap((a, i) => (args[i - 1] === flag ? [path.resolve(a)] : []));
process.env.OPENTAXRATE_DOWNLOAD_DIR = artifacts;

const found: Found[] = [];
const unmatched: string[] = [];
const unknown: Array<{ file: string; hash: string }> = [];

/** Folders named by the sha256 of the URL their one file came from. */
for (const root of [artifacts, ...listOf("--hashed")]) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9a-f]{64}$/.test(entry.name)) continue;
    const folder = path.join(root, entry.name);
    for (const file of fs.readdirSync(folder)) {
      const full = path.join(folder, file);
      if (!fs.statSync(full).isFile() || file.endsWith(".partial")) continue;
      const match = candidates(file).find((c) => sha(c.url) === entry.name);
      if (match) found.push({ file: full, ...match });
      else unknown.push({ file: full, hash: entry.name });
    }
  }
}

/** Loose copies, matched by name. */
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
for (const root of listOf("--loose"))
  for (const full of walk(root)) {
    const name = path.basename(full);
    if (/^[0-9a-f]{64}$/.test(path.basename(path.dirname(full)))) continue; // a hash folder: --hashed's
    const quarter = /^q(\d)-(\d{4})\.xlsx$/.exec(name);
    // A Missouri rate workbook saved under a short name: its sheet names
    // its jurisdiction codes.
    if (quarter && [...readXlsx(fs.readFileSync(full)).values()][0]?.some((row) => row.some((c) => /jurisdiction code/i.test(c)))) {
      found.push({ file: full, url: `${MO}/dor-jurisdiction-total-rate-q${quarter[1]}-${quarter[2]}.xlsx` });
      continue;
    }
    if (name === "taxrates.csv" && !fs.readFileSync(full, "utf8").slice(0, 200).includes("Locality Code")) {
      unmatched.push(full);
      continue;
    }
    const [match] = candidates(name);
    if (match) found.push({ file: full, ...match });
    else unmatched.push(full);
  }

// Place each URL's copies, newest current.
const byDestination = new Map<string, Array<Found & { mtime: Date; sha256: string; place: ReturnType<typeof sourcePath> }>>();
for (const f of found) {
  const place = sourcePath({ url: f.url }, f.name);
  const list = byDestination.get(place.destination) ?? [];
  list.push({ ...f, place, mtime: fs.statSync(f.file).mtime, sha256: fileSha(f.file) });
  byDestination.set(place.destination, list);
}
const manifest: string[] = [];
let moved = 0;
let dropped = 0;
for (const [destination, copies] of byDestination) {
  // What's already in sources counts as a copy too.
  // set aside first, so the newest can take its place.
  if (fs.existsSync(destination)) {
    const existing = { file: destination, url: copies[0].url, place: copies[0].place, mtime: fs.statSync(destination).mtime, sha256: fileSha(destination) };
    if (!dryRun) {
      existing.file = `${destination}.${randomUUID()}.organizing`;
      fs.renameSync(destination, existing.file);
    }
    copies.push(existing);
  }
  copies.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const seen = new Set<string>();
  copies.forEach((copy, i) => {
    if (seen.has(copy.sha256)) {
      if (!dryRun && copy.file !== destination) fs.rmSync(copy.file);
      dropped++;
      return;
    }
    seen.add(copy.sha256);
    const to =
      i === 0
        ? destination
        : path.join(copy.place.directory, "previous", `${copy.mtime.toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}-${path.basename(destination)}`);
    if (copy.file === to) return;
    if (!dryRun) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(copy.file, to);
      fs.utimesSync(to, copy.mtime, copy.mtime);
    }
    moved++;
    manifest.push(
      JSON.stringify({ at: copy.mtime.toISOString(), url: copy.url, from: copy.file, file: path.relative(path.join(artifacts, "sources"), to), sha256: copy.sha256, bytes: fs.statSync(dryRun ? copy.file : to).size, organized: true }),
    );
  });
}
for (const u of unknown) {
  const to = path.join(artifacts, "sources", "_unknown-url", u.hash, path.basename(u.file));
  if (!dryRun) {
    if (fs.existsSync(to) && fileSha(to) === fileSha(u.file)) fs.rmSync(u.file);
    else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(u.file, fs.existsSync(to) ? `${to}.${randomUUID().slice(0, 8)}` : to);
    }
  }
}
if (!dryRun) {
  fs.mkdirSync(path.join(artifacts, "sources"), { recursive: true });
  if (manifest.length) fs.appendFileSync(path.join(artifacts, "sources", "manifest.jsonl"), manifest.join("\n") + "\n");
  // Hash folders left empty go.
  for (const root of [artifacts, ...listOf("--hashed")])
    for (const entry of fs.readdirSync(root, { withFileTypes: true }))
      if (entry.isDirectory() && /^[0-9a-f]{64}$/.test(entry.name) && !fs.readdirSync(path.join(root, entry.name)).length)
        fs.rmdirSync(path.join(root, entry.name));
}
console.log(`${dryRun ? "would move" : "moved"} ${moved} files, ${dryRun ? "would drop" : "dropped"} ${dropped} identical copies, ${unknown.length} to _unknown-url, ${unmatched.length} loose files not matched`);
for (const u of unmatched) console.log(`  not matched: ${path.relative(artifacts, u)}`);
