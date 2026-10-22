import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { downloadedBytes, downloadedChunks } from "../src/ingest/archive.js";
import { fetchFile } from "../src/ingest/states/sources.js";
import { sstFileLines } from "../src/ingest/downloads.js";

let root: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});
async function setup() {
  root = await mkdtemp(path.join(tmpdir(), "opentaxrate-downloads-"));
  vi.stubEnv("OPENTAXRATE_DOWNLOAD_DIR", root);
  return root;
}
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory()
    ? files(path.join(directory, e.name)) : [path.join(directory, e.name)]))).flat();
}

describe("local source download archive", () => {
  it("saves downloads under artifacts by default", async () => {
    const directory = await setup();
    vi.stubEnv("OPENTAXRATE_DOWNLOAD_DIR", undefined);
    vi.spyOn(process, "cwd").mockReturnValue(directory);
    expect(new TextDecoder().decode(await downloadedBytes("https://state.example/rates.csv", new Response("rates")))).toBe("rates");
    const saved = await files(path.join(directory, "artifacts"));
    expect(saved).toHaveLength(1);
    expect(path.basename(saved[0])).toBe("rates.csv");
    expect(await readFile(saved[0], "utf8")).toBe("rates");
  });

  it("preserves binary content across multiple streamed chunks", async () => {
    const directory = await setup();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0, 255]));
        controller.enqueue(new Uint8Array([128, 1, 2]));
        controller.close();
      },
    }));
    expect(await downloadedBytes("https://state.example/source.zip", response)).toEqual(new Uint8Array([0, 255, 128, 1, 2]));
    const saved = await files(directory);
    expect(new Uint8Array(await readFile(saved[0]))).toEqual(new Uint8Array([0, 255, 128, 1, 2]));
  });

  it("keeps identical filenames from different URLs separate and preserves bytes", async () => {
    const directory = await setup();
    await downloadedBytes("https://one.example/rates.csv", new Response("one"));
    await downloadedBytes("https://two.example/rates.csv", new Response("two"));
    const saved = await files(directory);
    expect(saved).toHaveLength(2);
    expect(saved.every(f => path.basename(f) === "rates.csv")).toBe(true);
    expect((await Promise.all(saved.map(f => readFile(f, "utf8")))).sort()).toEqual(["one", "two"]);
  });

  it("does not commit an interrupted stream or replace a completed copy", async () => {
    const directory = await setup();
    const url = "https://state.example/boundary.csv";
    await downloadedBytes(url, new Response("complete"));
    const stream = downloadedChunks(url, new Response("partial"));
    await stream.next();
    await stream.return(undefined);
    const saved = await files(directory);
    expect(saved).toHaveLength(1);
    expect(await readFile(saved[0], "utf8")).toBe("complete");
  });

  it("archives state file downloads using their supplied filename", async () => {
    const directory = await setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rates")));
    expect(new TextDecoder().decode(await fetchFile("https://state.example/export", undefined, "state.csv"))).toBe("rates");
    const saved = await files(directory);
    expect(path.basename(saved[0])).toBe("state.csv");
    expect(await readFile(saved[0], "utf8")).toBe("rates");
  });

  it("archives the original SST bytes while streaming lines to the loader", async () => {
    const directory = await setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("a,b\nc,d\n")));
    const lines = [];
    for await (const line of sstFileLines({ state: "OH", kind: "rates", name: "OHR2026Q4", location: "https://state.example/OHR2026Q4.csv" })) lines.push(line);
    expect(lines).toEqual(["a,b", "c,d"]);
    const saved = await files(directory);
    expect(await readFile(saved[0], "utf8")).toBe("a,b\nc,d\n");
  });

  it("does not save failed HTTP responses", async () => {
    const directory = await setup();
    await expect(downloadedBytes("https://state.example/rates.csv", new Response("error", { status: 500 }))).rejects.toThrow("500");
    expect(await files(directory)).toEqual([]);
  });
});
