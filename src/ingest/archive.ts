/**
 * Local copies of everything refresh fetches, never API/user data: the raw
 * files and the live answers (map layer pages, lookup pages), so any load can
 * be rebuilt and checked later.
 *
 *   artifacts/<sha256 of the request>/<file name>   the newest copy
 *   artifacts/<sha256 of the request>/url.txt       what was asked
 *   artifacts/<sha256 of the request>/previous/     older contents, dated
 *   artifacts/manifest.jsonl                        one line per fetch
 *
 * A file is read back instead of downloading it again (savedDownload); a
 * live answer is only kept, gzipped, never reused.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { appendFile, mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";

/** What was fetched: a URL, and for a POST its body. */
interface Request {
  url: string;
  method?: string;
  body?: string;
}

const archiveRoot = () => process.env.OPENTAXRATE_DOWNLOAD_DIR || path.join(process.cwd(), "artifacts");

/** Where a fetch is saved. A POST's body is part of its key. */
function archivePath(request: Request, name?: string) {
  const key = createHash("sha256")
    .update(request.body === undefined ? request.url : `${request.method ?? "POST"} ${request.url}\n${request.body}`)
    .digest("hex");
  // Keep original filenames, but separate URLs to avoid collisions between states.
  const file = path.basename(name ?? decodeURIComponent(new URL(request.url).pathname)) || "download";
  const directory = path.join(archiveRoot(), key);
  return { directory, destination: path.join(directory, file === "." || file === ".." ? "download" : file) };
}

/** File names that say which edition they are, whose contents never change:
 *  Streamlined quarterly files (OHB2026Q4SEP17), TIGER vintages, Missouri's
 *  quarterly files, Arizona's monthly tables, Texas's quarterly EDI files. */
const EDITION = [
  /^[A-Z]{2}[RB]\d{4}Q\d/i,
  /^tl_\d{4}_/,
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
  const { destination } = archivePath({ url }, name);
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
 * contents that differ are kept as previous/<their date>-<name>; the fetch is
 * recorded in url.txt and the manifest either way.
 */
async function commit(request: Request, directory: string, destination: string, temporary: string, sha256: string) {
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
  const asked = request.body === undefined ? request.url : `${request.method ?? "POST"} ${request.url}\n${request.body}`;
  await writeFile(path.join(directory, "url.txt"), `${asked}\n`);
  const root = archiveRoot();
  await appendFile(
    path.join(root, "manifest.jsonl"),
    JSON.stringify({
      at: new Date().toISOString(),
      url: request.url,
      ...(request.body === undefined ? {} : { method: request.method ?? "POST", body: request.body.slice(0, 2000) }),
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
  const { directory, destination } = archivePath(request, name);
  const temporary = `${destination}.${randomUUID()}.partial`;
  await mkdir(directory, { recursive: true });
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
    await commit(request, directory, destination, temporary, hash.digest("hex"));
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

/**
 * Keeps a live answer (a map layer page, a lookup page) that refresh read
 * without saving, gzipped as <name>.gz. A failure to save never fails the
 * load, which already has the answer.
 */
export async function archiveResponse(request: Request, bytes: Uint8Array | string, name: string) {
  try {
    const body = typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes);
    const { directory, destination } = archivePath(request, `${name}.gz`);
    await mkdir(directory, { recursive: true });
    const temporary = `${destination}.${randomUUID()}.partial`;
    // gzip's header time is left at zero, so the same answer gives the same file.
    const zipped = gzipSync(body);
    await writeFile(temporary, zipped);
    await commit(request, directory, destination, temporary, createHash("sha256").update(zipped).digest("hex"));
  } catch (error) {
    console.warn(`Couldn't save ${request.url}: ${(error as Error).message}`);
  }
}
