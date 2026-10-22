/** Local copies of downloaded source files, never API/user data. */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/** Stream to the loader and disk together, committing only complete downloads. */
export async function* downloadedChunks(url: string, response: Response, name?: string): AsyncGenerator<Uint8Array> {
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
  const root = process.env.OPENTAXRATE_DOWNLOAD_DIR || path.join(process.cwd(), "artifacts");
  const key = createHash("sha256").update(url).digest("hex");
  // Keep original filenames, but separate URLs to avoid collisions between states.
  const file = path.basename(name ?? decodeURIComponent(new URL(url).pathname)) || "download";
  const directory = root ? path.join(root, key) : undefined;
  const destination = directory ? path.join(directory, file === "." || file === ".." ? "download" : file) : undefined;
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
