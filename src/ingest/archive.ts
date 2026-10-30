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
  const asked = url.search || request.body !== undefined;
  if (asked) {
    const id = createHash("sha256")
      .update(`${url.search}\n${request.method ?? (request.body === undefined ? "GET" : "POST")}\n${request.body ?? ""}`)
      .digest("hex")
      .slice(0, 16);
    directory = path.join(directory, ...(last ? [last] : []), id);
  }
  const file = safe(path.basename(name ?? last ?? "index.html"));
  return { directory, destination: path.join(directory, file), asked: Boolean(asked) };
}

/** File names that say which edition they are, whose contents never change:
 *  Streamlined quarterly files (OHB2026Q4SEP17), TIGER and Census
 *  vintages, Missouri's quarterly files, Arizona's monthly tables, Texas's
 *  quarterly EDI files. */
const EDITION = [
  /^[A-Z]{2}[RB]\d{4}Q\d/i,
  /^(tl|cb)_\d{4}_/,
  /-q\d-\d{4}\.(csv|xlsx)$/,
  /^TPT_RATETABLE_ALL_\d{8}\.csv$/,
  /^taxrates\d{3}\.txt$/,
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
      fs.rmSync(destination, { force: true });
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

/**
 * Puts a complete new copy (at `temporary`) in place of `destination`. Older
 * contents that differ are kept as previous/<their date>-<id>-<name>; the
 * fetch is recorded in the manifest either way.
 */
async function commit(request: Request, place: ReturnType<typeof sourcePath>, temporary: string, sha256: string, from?: string) {
  const { directory, destination } = place;
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
      request.body === undefined ? `${request.url}\n` : `${request.method ?? "POST"} ${request.url}\n${request.body}\n`,
    );
  const root = sourcesRoot();
  await appendFile(
    path.join(root, "manifest.jsonl"),
    JSON.stringify({
      at: new Date().toISOString(),
      url: request.url,
      ...(request.body === undefined ? {} : { method: request.method ?? "POST", body: request.body.slice(0, 2000) }),
      ...(from ? { from } : {}),
      file: path.relative(root, destination),
      sha256,
      bytes,
      ...(previous ? { previous: path.relative(root, previous) } : {}),
    }) + "\n",
  );
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
export async function keepLocalCopy(url: string, file: string, name?: string) {
  try {
    const place = sourcePath({ url }, name ?? path.basename(file));
    if (path.resolve(file) === path.resolve(place.destination)) return;
    await mkdir(place.directory, { recursive: true });
    const temporary = `${place.destination}.${randomUUID()}.partial`;
    await copyFile(file, temporary);
    await commit({ url }, place, temporary, await sha256Of(temporary), path.resolve(file));
  } catch (error) {
    console.warn(`Couldn't keep a copy of ${file}: ${(error as Error).message}`);
  }
}

/**
 * Keeps a live answer (a map layer page, a lookup page) that refresh read
 * without saving, gzipped as <name>.gz. A failure to save never fails the
 * load, which already has the answer.
 */
export async function archiveResponse(request: Request, bytes: Uint8Array | string, name: string) {
  try {
    const body = Buffer.from(bytes);
    const place = sourcePath(request, `${name}.gz`);
    await mkdir(place.directory, { recursive: true });
    const temporary = `${place.destination}.${randomUUID()}.partial`;
    // gzip's header time is left at zero, so the same answer gives the same file.
    const zipped = gzipSync(body);
    await writeFile(temporary, zipped);
    await commit(request, place, temporary, createHash("sha256").update(zipped).digest("hex"));
  } catch (error) {
    console.warn(`Couldn't save ${request.url}: ${(error as Error).message}`);
  }
}

/** The newest file the manifest records for each URL, whatever name it was
 *  filed under; a copy since deleted is left out. */
export function archivedByUrl(): Map<string, { file: string; sha256: string; bytes: number }> {
  const root = sourcesRoot();
  const found = new Map<string, { file: string; sha256: string; bytes: number }>();
  let text = "";
  try {
    text = fs.readFileSync(path.join(root, "manifest.jsonl"), "utf8");
  } catch {
    return found;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as { url: string; file: string; sha256: string; bytes: number };
    if (fs.existsSync(path.join(root, entry.file))) found.set(entry.url, { file: entry.file, sha256: entry.sha256, bytes: entry.bytes });
  }
  return found;
}
