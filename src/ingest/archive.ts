/**
 * Local copies of downloaded source files, never API/user data: each saved
 * as artifacts/<sha256 of its URL>/<its file name>, and read back instead of
 * downloading again (savedDownload).
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/** Where a download of `url` is saved. */
function archivePath(url: string, name?: string) {
  const root = process.env.OPENTAXRATE_DOWNLOAD_DIR || path.join(process.cwd(), "artifacts");
  const key = createHash("sha256").update(url).digest("hex");
  // Keep original filenames, but separate URLs to avoid collisions between states.
  const file = path.basename(name ?? decodeURIComponent(new URL(url).pathname)) || "download";
  const directory = path.join(root, key);
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
  const { destination } = archivePath(url, name);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(destination);
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
  const fresh = Date.now() - stat.mtimeMs < maxAgeHours() * 3_600_000;
  return EDITION.some((e) => e.test(file)) || fresh ? destination : null;
}

/** savedDownload's bytes. */
export function savedBytes(url: string, name?: string): Uint8Array | null {
  const saved = savedDownload(url, name);
  return saved ? new Uint8Array(fs.readFileSync(saved)) : null;
}

/** Stream to the loader and disk together, committing only complete downloads. */
export async function* downloadedChunks(url: string, response: Response, name?: string): AsyncGenerator<Uint8Array> {
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
  const { directory, destination } = archivePath(url, name);
  const temporary = destination ? `${destination}.${randomUUID()}.partial` : undefined;
  if (directory) await mkdir(directory, { recursive: true });
  const handle = temporary ? await open(temporary, "wx") : undefined;
  try {
    for await (const chunk of Readable.fromWeb(response.body as never)) {
      const bytes = chunk as Uint8Array;
      if (handle) await handle.writeFile(bytes);
      yield bytes;
    }
    if (handle) await handle.close();
    if (temporary && destination) await rename(temporary, destination);
  } finally {
    await handle?.close();
    if (temporary) await rm(temporary, { force: true });
  }
}

export async function downloadedBytes(url: string, response: Response, name?: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of downloadedChunks(url, response, name)) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}
