/**
 * Finds and reads the public files address rates are built from:
 *   - each Streamlined state's newest rate and boundary file, as text lines,
 *     unzipped on the way in so a 400 MB boundary file is never held whole;
 *   - the Census Bureau's newest TIGER county, city and town outlines.
 * A local folder of the same files can stand in for either site.
 */
import fs from "node:fs";
import path from "node:path";
import { downloadedBytes, downloadedChunks } from "./archive.js";
import { Unzip, UnzipInflate } from "fflate";
import type { Shape } from "./tiger.js";

const SITE = "https://www.streamlinedsalestax.org/ratesandboundry";
const TIGER = "https://www2.census.gov/geo/tiger";

export interface SstFile {
  state: string;
  kind: "rates" | "boundaries";
  /** File name without its extension, e.g. "OHB2026Q4SEP17". */
  name: string;
  location: string;
}

/** "OHB2026Q4SEP17.zip": state, R or B, year and quarter, publication day. */
const FILE_NAME = /^([A-Z]{2})([RB])(\d{4})Q(\d)([A-Z]{3})?(\d{1,2})?\.(csv|zip)$/i;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Each state's newest rate and boundary file, from the site or `dir`. */
export async function latestSstFiles(dir?: string): Promise<SstFile[]> {
  const names = dir
    ? listDir(dir)
    : [
        ...(await listSite("Rates")),
        ...(await listSite("Boundary")),
      ];
  const newest = new Map<string, { file: SstFile; version: string }>();
  for (const { name, location } of names) {
    const m = FILE_NAME.exec(name);
    if (!m) continue;
    const state = m[1].toUpperCase();
    const kind = m[2].toUpperCase() === "R" ? "rates" : "boundaries";
    // A file reissued within its quarter carries a later day.
    const month = m[5] ? MONTHS.indexOf(m[5].toUpperCase()) + 1 : 0;
    const version = `${m[3]}${m[4]}${String(month).padStart(2, "0")}${(m[6] ?? "").padStart(2, "0")}`;
    const key = `${state}:${kind}`;
    const current = newest.get(key);
    if (!current || version > current.version)
      newest.set(key, {
        version,
        file: { state, kind, name: name.replace(/\.\w+$/, ""), location },
      });
  }
  return [...newest.values()].map((v) => v.file);
}

/** The file's lines, unzipping a .zip as it streams. */
export async function* sstFileLines(file: SstFile): AsyncGenerator<string> {
  const bytes = await open(file.location);
  const zipped = /\.zip$/i.test(file.location);
  const decoder = new TextDecoder();
  let rest = "";
  const chunks: Uint8Array[] = [];
  const unzip = new Unzip((entry) => {
    if (!/\.csv$/i.test(entry.name)) return;
    entry.ondata = (error, chunk) => {
      if (error) throw error;
      chunks.push(chunk);
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  function* drain() {
    while (chunks.length) {
      rest += decoder.decode(chunks.shift(), { stream: true });
      const lines = rest.split("\n");
      rest = lines.pop()!;
      yield* lines;
    }
  }
  for await (const chunk of bytes) {
    if (zipped) unzip.push(chunk);
    else chunks.push(chunk);
    yield* drain();
  }
  if (zipped) unzip.push(new Uint8Array(0), true);
  yield* drain();
  rest += decoder.decode();
  if (rest) yield rest;
}

/** The newest TIGER county file and each state's city and town files, as
 *  zip bytes, from `dir` when it holds them. A vintage is used once its
 *  county file is out. */
export async function latestTigerFiles(
  stateFips: string[],
  dir?: string,
): Promise<
  Array<{ kind: Shape["kind"]; name: string; bytes: () => Promise<Uint8Array> }>
> {
  const local = dir ? listDir(dir) : [];
  const year = await tigerYear(local);
  const files = [
    { kind: "county" as const, name: `tl_${year}_us_county` },
    ...stateFips.flatMap((f) => [
      { kind: "place" as const, name: `tl_${year}_${f}_place` },
      { kind: "cousub" as const, name: `tl_${year}_${f}_cousub` },
    ]),
  ];
  return files.map((f) => ({
    ...f,
    bytes: async () => {
      const found = local.find((l) => l.name === `${f.name}.zip`);
      if (found) return new Uint8Array(fs.readFileSync(found.location));
      const folder = f.kind.toUpperCase();
      const url = `${TIGER}/TIGER${year}/${folder}/${f.name}.zip`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`TIGER ${f.name} answered ${response.status}`);
      return downloadedBytes(url, response);
    },
  }));
}

/** Each county's TIGER address features for a state (street names with the
 *  ZIP on each side), from the newest TIGER year, read from `dir` first. */
export async function latestTigerAddressFiles(
  stateFips: string,
  dir?: string,
): Promise<{ year: string; files: Array<{ name: string; bytes: () => Promise<Uint8Array> }> }> {
  const local = dir ? listDir(dir) : [];
  const year = await tigerYear(local);
  const folder = `${TIGER}/TIGER${year}/ADDRFEAT/`;
  const index = await fetch(folder);
  if (!index.ok) throw new Error(`TIGER ADDRFEAT listing answered ${index.status}`);
  const names = [...new Set((await index.text()).match(new RegExp(`tl_${year}_${stateFips}\\d{3}_addrfeat\\.zip`, "g")) ?? [])];
  return {
    year,
    files: names.map((name) => ({
      name,
      bytes: async () => {
        const found = local.find((l) => l.name === name);
        if (found) return new Uint8Array(fs.readFileSync(found.location));
        const response = await fetch(folder + name);
        if (!response.ok) throw new Error(`TIGER ${name} answered ${response.status}`);
        return downloadedBytes(folder + name, response);
      },
    })),
  };
}

async function tigerYear(local: Array<{ name: string }>) {
  const years = local
    .map((l) => /^tl_(\d{4})_us_county\.zip$/.exec(l.name)?.[1])
    .filter(Boolean) as string[];
  if (years.length) return years.sort().at(-1)!;
  for (let year = new Date().getFullYear(); year > 2020; year--) {
    const head = await fetch(`${TIGER}/TIGER${year}/COUNTY/tl_${year}_us_county.zip`, { method: "HEAD" });
    if (head.ok) return String(year);
  }
  throw new Error("No TIGER county file found");
}

async function open(location: string): Promise<AsyncIterable<Uint8Array>> {
  if (!/^https?:/.test(location)) return fs.createReadStream(location);
  const response = await fetch(location);
  if (!response.ok || !response.body)
    throw new Error(`${location} answered ${response.status}`);
  return downloadedChunks(location, response);
}

async function listSite(folder: "Rates" | "Boundary") {
  const response = await fetch(`${SITE}/${folder}/`);
  if (!response.ok)
    throw new Error(`The Streamlined ${folder} folder answered ${response.status}`);
  const html = await response.text();
  return [...html.matchAll(/HREF="([^"]+\.(?:csv|zip))"/gi)].map((m) => ({
    name: decodeURIComponent(m[1].split("/").pop()!),
    location: new URL(m[1], SITE).toString(),
  }));
}

function listDir(dir: string) {
  const found: Array<{ name: string; location: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const location = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listDir(location));
    else found.push({ name: entry.name, location });
  }
  return found;
}
