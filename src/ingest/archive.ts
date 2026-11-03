/**
 * The raw sources: every file and live answer refresh builds the database
 * from, kept so any load can be rebuilt and checked later, and so a file is
 * downloaded once. Nothing else goes here.
 *
 *   artifacts/sources/<host>/<path>/<file>           the newest copy, where its URL says
 *   artifacts/sources/<host>/<path>/<query id>/...   one per query or POST to that path,
 *                                                    with url.txt saying what was asked
 *   .../previous/<date>-<id>-<file>                  older contents, when they changed
 *   artifacts/sources/manifest.jsonl                 one line per fetch
 *   artifacts/sources/KNOWN-BAD.md, UNINDEXED.md     kept files that aren't their page; files no line names
 *   artifacts/sources/GAPS.md                        inputs known of but not obtained, and what was searched
 *
 * Files read from a local folder (--dir) are copied in under the URL they
 * would have come from. A file is read back instead of downloaded again
 * (savedDownload); a live answer (map layer page, lookup page) is kept
 * gzipped and never reused.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { appendFile, copyFile, mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";

/** What was fetched: a URL, and for a POST its body. */
interface Request {
  url: string;
  method?: string;
  body?: string;
}

/** The request's method: as given, else POST with a body and GET without. */
const requestMethod = (request: Request) => (request.method ? request.method.toUpperCase() : request.body === undefined ? "GET" : "POST");

/** artifacts/sources, or sources/ under OPENTAXRATE_DOWNLOAD_DIR. */
export const sourcesRoot = () =>
  path.join(process.env.OPENTAXRATE_DOWNLOAD_DIR || path.join(process.cwd(), "artifacts"), "sources");

/** A path segment safe on any disk. */
const safe = (segment: string) => {
  const s = segment.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/ /g, "_");
  return s === "." || s === ".." || !s ? "_" : s;
};

/** Where a fetch is kept: its host and path, and for a query or POST a
 *  folder of its own under that path. */
function sourcePath(request: Request, name?: string) {
  const url = new URL(request.url);
  const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean).map(safe);
  const last = url.pathname.endsWith("/") ? undefined : parts.pop();
  let directory = path.join(sourcesRoot(), safe(url.host), ...parts);
  const method = requestMethod(request);
  const asked = url.search || request.body !== undefined || method !== "GET";
  if (asked) {
    // A request with no body at all (a bodyless POST) is told from one with
    // an empty body; every other request keeps the id it always had.
    const id = createHash("sha256")
      .update(`${url.search}\n${method}\n${request.body ?? ""}${request.body === undefined && method !== "GET" ? "\n(no body)" : ""}`)
      .digest("hex")
      .slice(0, 16);
    directory = path.join(directory, ...(last ? [last] : []), id);
  }
  const file = safe(path.basename(name ?? last ?? "index.html"));
  return unclashed({ directory, destination: path.join(directory, file), asked: Boolean(asked) });
}

/** A path that is a page at one URL and a folder at another (Ohio's
 *  section-5739.01, and section-5739.01/3-23-2018/ for its editions): a
 *  folder segment already taken by a file becomes "<segment>._dir_", and a
 *  page whose name is already a folder is kept inside it as "_page". The
 *  manifest records where each copy went, so readers follow it there. */
function unclashed(place: { directory: string; destination: string; asked: boolean }) {
  const root = sourcesRoot();
  const segments = path.relative(root, place.directory).split(path.sep).filter(Boolean);
  let directory = root;
  for (const segment of segments) {
    const next = path.join(directory, segment);
    directory = fs.existsSync(next) && !fs.statSync(next).isDirectory() ? `${next}._dir_` : next;
  }
  let destination = path.join(directory, path.basename(place.destination));
  if (fs.existsSync(destination) && fs.statSync(destination).isDirectory()) {
    directory = destination;
    destination = path.join(destination, "_page");
  }
  return { ...place, directory, destination };
}

/** File names that say which edition they are, whose contents never change:
 *  Streamlined quarterly files (OHB2026Q4SEP17), TIGER and Census
 *  vintages, Missouri's quarterly files, Arizona's monthly tables, Texas's
 *  quarterly EDI files, Utah's quarterly rate charts (26q4simple.xlsx). */
const EDITION = [
  /^[A-Z]{2}[RB]\d{4}Q\d/i,
  /^(tl|cb)_\d{4}_/,
  /-q\d-\d{4}\.(csv|xlsx)$/,
  /^TPT_RATETABLE_ALL_\d{8}\.csv$/,
  /^taxrates\d{3}\.txt$/,
  /^\d{2}q\dsimple\.xlsx$/,
];

/** Hours a saved file whose name names no edition is reused for:
 *  OPENTAXRATE_DOWNLOAD_MAX_AGE_HOURS, 24 by default; 0 downloads it again
 *  every time. */
const maxAgeHours = () => {
  const hours = Number(process.env.OPENTAXRATE_DOWNLOAD_MAX_AGE_HOURS ?? 24);
  return Number.isFinite(hours) ? hours : 24;
};

/** The saved copy of `url` to read instead of downloading it again, or null:
 *  an edition's file always, any other while it's fresh. A saved ".zip"
 *  that isn't one (an error page a site sent with a 200) is dropped. */
export function savedDownload(url: string, name?: string): string | null {
  const { destination } = sourcePath({ url }, name);
  let found: fs.Stats;
  try {
    found = fs.statSync(destination);
  } catch {
    return null;
  }
  const file = path.basename(destination);
  if (/\.zip$/i.test(file)) {
    const head = Buffer.alloc(2);
    const fd = fs.openSync(destination, "r");
    fs.readSync(fd, head, 0, 2, 0);
    fs.closeSync(fd);
    if (head[0] !== 0x50 || head[1] !== 0x4b) {
      // Set aside, never deleted: the manifest records the fetch, and the
      // bytes stay evidence of what the site sent (KNOWN-BAD.md).
      const day = found.mtime.toISOString().slice(0, 10);
      fs.mkdirSync(path.join(path.dirname(destination), "previous"), { recursive: true });
      fs.renameSync(destination, path.join(path.dirname(destination), "previous", `${day}-${randomUUID().slice(0, 8)}-${file}`));
      return null;
    }
  }
  const hours = maxAgeHours();
  const fresh = hours > 0 && Date.now() - found.mtimeMs < hours * 3_600_000;
  return EDITION.some((e) => e.test(file)) || fresh ? destination : null;
}

/** savedDownload's bytes. */
export function savedBytes(url: string, name?: string): Uint8Array | null {
  const saved = savedDownload(url, name);
  return saved ? new Uint8Array(fs.readFileSync(saved)) : null;
}

async function sha256Of(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** The lock a commit holds on its destination ("<destination>.commit-lock"),
 *  so two writers (two downloads in one process, or two filing processes)
 *  never both take an empty place and overwrite each other's copy. */
export const COMMIT_LOCK = ".commit-lock";

/** Runs `fn` holding `destination`'s lock: made with open("wx"), so only one
 *  process at a time has it; a lock older than ten minutes was left by a
 *  process that died, and is taken over. */
async function locked<T>(destination: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${destination}${COMMIT_LOCK}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const handle = await open(lock, "wx");
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const held = await stat(lock).catch(() => null);
      if (held && Date.now() - held.mtimeMs > 600_000) {
        await rm(lock, { force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(5 + attempt * 5, 100)));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}

/**
 * Puts a complete new copy (at `temporary`) in place of `destination`. Older
 * contents that differ are kept as previous/<their date>-<id>-<name>; the
 * fetch is recorded in the manifest either way. One commit at a time per
 * destination (`locked`): the check of what's there and the replacement are
 * one step, so no copy reported archived is ever overwritten.
 */
async function commit(request: Request, place: ReturnType<typeof sourcePath>, temporary: string, sha256: string, from?: string, at?: string) {
  const { directory, destination } = place;
  const method = requestMethod(request);
  await locked(destination, async () => {
    let previous: string | undefined;
    const old = await stat(destination).catch(() => null);
    if (old && (await sha256Of(destination)) !== sha256) {
      const day = old.mtime.toISOString().slice(0, 10);
      await mkdir(path.join(directory, "previous"), { recursive: true });
      previous = path.join(directory, "previous", `${day}-${randomUUID().slice(0, 8)}-${path.basename(destination)}`);
      await rename(destination, previous);
    }
    await rename(temporary, destination);
    const bytes = (await stat(destination)).size;
    if (place.asked)
      await writeFile(
        path.join(directory, "url.txt"),
        request.body === undefined ? (method === "GET" ? `${request.url}\n` : `${method} ${request.url}\n`) : `${method} ${request.url}\n${request.body}\n`,
      );
    const root = sourcesRoot();
    await appendFile(
      path.join(root, "manifest.jsonl"),
      JSON.stringify({
        at: at ?? new Date().toISOString(),
        url: request.url,
        // A long body is cut to its first 2,000 characters here (url.txt keeps
        // it whole); bodySha256 is the whole body's, so two requests that
        // share a prefix are never taken for one. A request with no body
        // that isn't a GET (a bodyless POST) keeps its method and no body.
        ...(request.body === undefined
          ? method === "GET"
            ? {}
            : { method }
          : { method, body: request.body.slice(0, 2000), bodySha256: createHash("sha256").update(request.body).digest("hex") }),
        ...(from ? { from } : {}),
        file: path.relative(root, destination),
        sha256,
        bytes,
        ...(previous ? { previous: path.relative(root, previous) } : {}),
        // A copy saved earlier: `at` is its download, filedAt when it came in.
        ...(at ? { filedAt: new Date().toISOString() } : {}),
      }) + "\n",
    );
  });
}

/** Stream to the loader and disk together, committing only complete downloads. */
export async function* downloadedChunks(url: string, response: Response, name?: string): AsyncGenerator<Uint8Array> {
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
  const request = { url };
  const place = sourcePath(request, name);
  const temporary = `${place.destination}.${randomUUID()}.partial`;
  await mkdir(place.directory, { recursive: true });
  const handle = await open(temporary, "wx");
  const hash = createHash("sha256");
  let done = false;
  try {
    for await (const chunk of Readable.fromWeb(response.body as never)) {
      const bytes = chunk as Uint8Array;
      hash.update(bytes);
      await handle.writeFile(bytes);
      yield bytes;
    }
    await handle.close();
    await commit(request, place, temporary, hash.digest("hex"));
    done = true;
  } finally {
    await handle.close().catch(() => {});
    if (!done) await rm(temporary, { force: true });
  }
}

export async function downloadedBytes(url: string, response: Response, name?: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of downloadedChunks(url, response, name)) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

/** Copies a file read from a local folder (--dir) in under the URL it would
 *  have been downloaded from, so the sources hold every input either way. */
export async function keepLocalCopy(url: string, file: string, name?: string): Promise<boolean> {
  try {
    const place = sourcePath({ url }, name ?? path.basename(file));
    if (path.resolve(file) === path.resolve(place.destination)) return true;
    await mkdir(place.directory, { recursive: true });
    const temporary = `${place.destination}.${randomUUID()}.partial`;
    await copyFile(file, temporary);
    await commit({ url }, place, temporary, await sha256Of(temporary), path.resolve(file));
    return true;
  } catch (error) {
    console.warn(`Couldn't keep a copy of ${file}: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Keeps a live answer (a map layer page, a lookup page) that refresh read
 * without saving, gzipped as <name>.gz. A failure to save never fails the
 * load, which already has the answer; it returns false.
 *
 * An answer saved earlier (a research agent's cache) is filed with `at`,
 * when it was downloaded, and `from`, the file it was read from.
 */
export async function archiveResponse(
  request: Request,
  bytes: Uint8Array | string,
  name: string,
  saved: { at?: string; from?: string } = {},
): Promise<boolean> {
  try {
    const body = Buffer.from(bytes);
    const place = sourcePath(request, `${name}.gz`);
    await mkdir(place.directory, { recursive: true });
    const temporary = `${place.destination}.${randomUUID()}.partial`;
    // gzip's header time is left at zero, so the same answer gives the same file.
    const zipped = gzipSync(body);
    await writeFile(temporary, zipped);
    await commit(request, place, temporary, createHash("sha256").update(zipped).digest("hex"), saved.from, saved.at);
    return true;
  } catch (error) {
    console.warn(`Couldn't save ${request.url}: ${(error as Error).message}`);
    return false;
  }
}

/** Files a lookup service's answer saved earlier (`file`), under its
 *  request so different answers don't stack as versions of one page, dated
 *  by the file's time (`taxability file-answer`). The request is `method`
 *  (else POST with a body, GET without) and the body in `bodyFile`: an
 *  empty body file is an empty body, no file no body, and each is its own
 *  request, never a GET's. */
export async function fileAnswer(url: string, file: string, options: { method?: string; bodyFile?: string; from?: string } = {}): Promise<{ method: string }> {
  const body = options.bodyFile === undefined ? undefined : fs.readFileSync(options.bodyFile, "utf8");
  const request: Request = { url, method: options.method?.toUpperCase(), body };
  const saved = { at: fs.statSync(file).mtime.toISOString(), from: options.from ?? path.resolve(file) };
  if (!(await archiveResponse(request, fs.readFileSync(file), path.basename(file), saved))) throw new Error(`${file} wasn't filed.`);
  return { method: requestMethod(request) };
}

/** The page an Internet Archive capture is of, and when it was captured:
 *  "https://web.archive.org/web/20161024044355/http://rules.sos.ga.gov:80/gac/560-12-2"
 *  is rules.sos.ga.gov/gac/560-12-2 on 2016-10-24. Null for any other URL. */
export function waybackCapture(url: string): { original: string; at: string } | null {
  const m = /^https?:\/\/web\.archive\.org\/web\/(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?:[a-z]{2}_)?\/(.+)$/.exec(url);
  if (!m) return null;
  const original = m[7].replace(/^(https?:\/\/[^/:]+):(80|443)(?=\/|$)/, "$1");
  return { original, at: `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}Z` };
}

/** A file in artifacts/sources that is a copy, not bookkeeping: the
 *  manifest, a download still being written, a commit's lock. */
const isCopyFile = (name: string) => name !== "manifest.jsonl" && !name.endsWith(".partial") && !name.endsWith(COMMIT_LOCK);

/** The SHA-256 and size of every file under artifacts/sources (relative
 *  paths), and the files holding each hash: what each path really holds
 *  now, whatever the manifest says was put there. */
export interface SourceHashes {
  hashOf: Map<string, string>;
  sizeOf: Map<string, number>;
  filesOf: Map<string, string[]>;
}

/** Each file's hash as last read, by absolute path, with the size, mtime,
 *  ctime and inode it had then: a file is hashed again only when one of
 *  them changed. Kept on disk beside the sources (cache/source-hashes.json,
 *  derived and safe to delete) so a rerun hashes only what's new. */
const hashMemo = new Map<string, { stamp: string; sha256: string }>();
const loadedHashCaches = new Set<string>();
const hashCacheFile = (root: string) => path.join(path.dirname(root), "cache", "source-hashes.json");

function sha256OfFileSync(file: string) {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1 << 20);
  try {
    for (let n; (n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0; ) hash.update(buffer.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** Every file under the sources by what it holds (see SourceHashes). */
export function sourceHashes(root = sourcesRoot()): SourceHashes {
  const cache = hashCacheFile(root);
  if (!loadedHashCaches.has(root)) {
    loadedHashCaches.add(root);
    try {
      const kept = JSON.parse(fs.readFileSync(cache, "utf8")) as { version: number; files: Record<string, [string, string]> };
      if (kept.version === 1) for (const [rel, [stamp, sha256]] of Object.entries(kept.files)) hashMemo.set(path.join(root, rel), { stamp, sha256 });
    } catch {
      // No cache yet, or an unreadable one: every file is hashed.
    }
  }
  const found: SourceHashes = { hashOf: new Map(), sizeOf: new Map(), filesOf: new Map() };
  let hashed = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && isCopyFile(entry.name)) {
        const st = fs.statSync(full, { bigint: true, throwIfNoEntry: false });
        if (!st) continue; // gone since the listing (moved to previous/, which the walk reaches)
        const stamp = `${st.size}:${st.mtimeNs}:${st.ctimeNs}:${st.ino}`;
        let known = hashMemo.get(full);
        if (!known || known.stamp !== stamp) {
          known = { stamp, sha256: sha256OfFileSync(full) };
          hashMemo.set(full, known);
          hashed++;
        }
        const rel = path.relative(root, full);
        found.hashOf.set(rel, known.sha256);
        found.sizeOf.set(rel, Number(st.size));
        const list = found.filesOf.get(known.sha256);
        if (list) list.push(rel);
        else found.filesOf.set(known.sha256, [rel]);
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  if (hashed) {
    try {
      const files: Record<string, [string, string]> = {};
      for (const rel of found.hashOf.keys()) {
        const known = hashMemo.get(path.join(root, rel))!;
        files[rel] = [known.stamp, known.sha256];
      }
      fs.mkdirSync(path.dirname(cache), { recursive: true });
      const temporary = `${cache}.${randomUUID()}.partial`;
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, files }));
      fs.renameSync(temporary, cache);
    } catch {
      // A cache that can't be written only costs time on the next run.
    }
  }
  return found;
}

/** One manifest line. */
export interface ManifestEntry {
  at: string;
  url: string;
  method?: string;
  /** The body as recorded: its first 2,000 characters. */
  body?: string;
  /** The whole body's SHA-256, on lines written since it was recorded. */
  bodySha256?: string;
  sha256: string;
  bytes: number;
  file: string;
  previous?: string;
}

/** The manifest's lines, in the order they were written. */
export function manifestEntries(root = sourcesRoot()): ManifestEntry[] {
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, "manifest.jsonl"), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ManifestEntry);
}

/** A file that holds this entry's bytes now: the one it was filed as, if it
 *  still holds them, else wherever they are (moved to previous/ when the
 *  URL's file, or another URL's file of the same name, replaced them; the
 *  copy beside it first). Undefined when the bytes are nowhere. */
export function holding(entry: { file: string; sha256: string }, hashes: SourceHashes): string | undefined {
  if (hashes.hashOf.get(entry.file) === entry.sha256) return entry.file;
  const elsewhere = (hashes.filesOf.get(entry.sha256) ?? []).filter((f) => path.basename(f) !== "url.txt");
  const beside = path.join(path.dirname(entry.file), "previous");
  return elsewhere.find((f) => path.dirname(f) === beside) ?? elsewhere[0];
}

/** A URL's observations, oldest first (by capture time, then by when they
 *  were filed), with a run of the same bytes (through the same Internet
 *  Archive capture, if any) kept once, at its earliest time: an answer filed
 *  later but downloaded earlier dates its run, and a page that changed and
 *  changed back (A, B, A) is three. */
export function captureRuns<T extends { at: string; sha256: string; via?: string }>(observations: T[]): T[] {
  const ordered = observations.map((o, i) => [o, i] as const).sort(([a, i], [b, j]) => a.at.localeCompare(b.at) || i - j);
  const runs: T[] = [];
  for (const [o] of ordered) {
    const last = runs.at(-1);
    if (last && last.sha256 === o.sha256 && last.via === o.via) continue;
    runs.push(o);
  }
  return runs;
}

export interface Copy {
  /** A file holding exactly these bytes (sha256), wherever they are now. */
  file: string;
  sha256: string;
  bytes: number;
  /** When the copy shows the page: the fetch, or the Internet Archive's capture. */
  at: string;
  /** The Internet Archive capture it came through, where the site itself
   *  blocked downloads or the edition is gone. */
  via?: string;
}

/** Every copy the archive holds of each URL, oldest first (captureRuns): its
 *  own fetches, and Internet Archive captures of it filed under the
 *  capture's address. Each copy's file holds its hash's bytes (checked by
 *  hash, not trusted from the manifest); a fetch whose bytes are nowhere is
 *  left out. */
export function copiesByUrl(): Map<string, Copy[]> {
  const root = sourcesRoot();
  const entries = manifestEntries(root);
  const found = new Map<string, Copy[]>();
  if (!entries.length) return found;
  const hashes = sourceHashes(root);
  const add = (url: string, copy: Copy) => {
    const list = found.get(url);
    if (list) list.push(copy);
    else found.set(url, [copy]);
  };
  for (const entry of entries) {
    const file = holding(entry, hashes);
    if (!file) continue;
    const copy: Copy = { file, sha256: entry.sha256, bytes: hashes.sizeOf.get(file)!, at: entry.at };
    add(entry.url, copy);
    const capture = waybackCapture(entry.url);
    if (capture) add(capture.original, { ...copy, at: capture.at, via: entry.url });
  }
  for (const [url, list] of found) found.set(url, captureRuns(list));
  return found;
}

/** The newest copy each URL's own fetches hold (the last of copiesByUrl's
 *  runs, ordered by fetch time: a recovered older copy may be appended
 *  later), wherever its bytes are now; a fetch whose bytes are nowhere is
 *  left out. */
export function archivedByUrl(): Map<string, { file: string; sha256: string; bytes: number; at: string }> {
  const found = new Map<string, { file: string; sha256: string; bytes: number; at: string }>();
  for (const [url, list] of copiesByUrl()) {
    const own = list.filter((c) => !c.via);
    const newest = own.at(-1);
    if (newest) found.set(url, { file: newest.file, sha256: newest.sha256, bytes: newest.bytes, at: newest.at });
  }
  return found;
}
