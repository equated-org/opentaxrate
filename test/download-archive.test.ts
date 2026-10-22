import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { archiveResponse, downloadedBytes, downloadedChunks } from "../src/ingest/archive.js";
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
/** The saved data files, without each folder's url.txt and the manifest. */
async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory()
    ? files(path.join(directory, e.name))
    : ["url.txt", "manifest.jsonl"].includes(e.name) ? [] : [path.join(directory, e.name)]))).flat();
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

describe("reusing saved downloads", () => {
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

  it("reads a fresh saved file instead of downloading it again", async () => {
    await setup();
    const fetch = vi.fn().mockResolvedValueOnce(new Response("first")).mockResolvedValue(new Response("second"));
    vi.stubGlobal("fetch", fetch);
    expect(text(await fetchFile("https://state.example/taxrates.csv"))).toBe("first");
    expect(text(await fetchFile("https://state.example/taxrates.csv"))).toBe("first");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("downloads a file named for no edition again once it's older than the max age", async () => {
    await setup();
    vi.stubEnv("OPENTAXRATE_DOWNLOAD_MAX_AGE_HOURS", "0");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("old")).mockResolvedValue(new Response("new")));
    await fetchFile("https://state.example/taxrates.csv");
    expect(text(await fetchFile("https://state.example/taxrates.csv"))).toBe("new");
  });

  it("always reuses a file whose name says its edition", async () => {
    await setup();
    vi.stubEnv("OPENTAXRATE_DOWNLOAD_MAX_AGE_HOURS", "0");
    const fetch = vi.fn(async () => new Response("a,b\n"));
    vi.stubGlobal("fetch", fetch);
    const file = { state: "OH", kind: "rates" as const, name: "OHR2026Q4SEP17", location: "https://state.example/OHR2026Q4SEP17.csv" };
    for (let i = 0; i < 2; i++) for await (const _ of sstFileLines(file));
    await fetchFile("https://comptroller.example/taxrates264.txt");
    await fetchFile("https://comptroller.example/taxrates264.txt");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("drops a saved .zip that is an error page, and downloads it again", async () => {
    await setup();
    const zip = new Uint8Array([0x50, 0x4b, 3, 4]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("<html>Request Rejected</html>")).mockResolvedValue(new Response(zip)));
    expect(text(await fetchFile("https://census.example/tl_2026_51059_addrfeat.zip"))).toMatch(/Rejected/);
    expect(await fetchFile("https://census.example/tl_2026_51059_addrfeat.zip")).toEqual(zip);
  });
});

describe("keeping every version", () => {
  it("keeps older contents, dated, when a file changes, and records each fetch", async () => {
    const directory = await setup();
    const url = "https://revenue.example/taxrates.csv";
    await downloadedBytes(url, new Response("v1"));
    await downloadedBytes(url, new Response("v1"));
    await downloadedBytes(url, new Response("v2"));
    const saved = await files(directory);
    expect(saved.map((f) => path.basename(f)).sort()).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}-\w{8}-taxrates\.csv$/), "taxrates.csv"]);
    expect(await readFile(saved.find((f) => f.includes("previous"))!, "utf8")).toBe("v1");
    expect(await readFile(saved.find((f) => !f.includes("previous"))!, "utf8")).toBe("v2");
    const manifest = (await readFile(path.join(directory, "manifest.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(manifest).toHaveLength(3);
    expect(manifest[2]).toMatchObject({ url, bytes: 2, previous: expect.stringContaining("previous/") });
    expect(manifest[1].previous).toBeUndefined();
    const folder = path.dirname(saved.find((f) => !f.includes("previous"))!);
    expect(await readFile(path.join(folder, "url.txt"), "utf8")).toBe(`${url}\n`);
  });

  it("keeps a live answer gzipped, keyed by what a POST asked", async () => {
    const directory = await setup();
    const url = "https://lookup.example/api/v1/rates.byPlace";
    await archiveResponse({ url, method: "POST", body: '{"date":"2026-01-01"}' }, '{"rate":0.03}', "rates.byPlace.json");
    await archiveResponse({ url, method: "POST", body: '{"date":"2026-07-01"}' }, '{"rate":0.04}', "rates.byPlace.json");
    const saved = await files(directory);
    expect(saved).toHaveLength(2);
    expect(saved.map((f) => gunzipSync(readFileSync(f)).toString()).sort()).toEqual(['{"rate":0.03}', '{"rate":0.04}']);
  });
});
