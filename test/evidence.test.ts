import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { archiveResponse, downloadedBytes } from "../src/ingest/archive.js";
import { buildCatalog } from "../src/evidence.js";

let root: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});
async function setup() {
  root = await mkdtemp(path.join(tmpdir(), "opentaxrate-evidence-"));
  vi.stubEnv("OPENTAXRATE_DOWNLOAD_DIR", root);
  return path.join(root, "sources");
}

const url = "https://lookup.example/api/v1/rates.byPlace";
// Two requests alike for their first 2,000 characters, differing after.
const prefix = `{"places":[${'"x",'.repeat(600)}`;
const body = (date: string) => `${prefix}"y"],"date":"${date}"}`;
const keyOf = (b: string) => `${url} (POST ${createHash("sha256").update(b).digest("hex").slice(0, 12)})`;

describe("the evidence catalog", () => {
  it("keys each POSTed answer by its whole body, though the manifest keeps 2,000 characters", async () => {
    const sources = await setup();
    await archiveResponse({ url, method: "POST", body: body("2024-01-01") }, '{"rate":0.03}', "rates.byPlace.json");
    await archiveResponse({ url, method: "POST", body: body("2026-07-01") }, '{"rate":0.04}', "rates.byPlace.json");
    const lines = (await readFile(path.join(sources, "manifest.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.body)).toEqual([body("2024-01-01").slice(0, 2000), body("2026-07-01").slice(0, 2000)]);
    expect(lines[0].body).toBe(lines[1].body);

    const { catalog } = await buildCatalog();
    expect(Object.keys(catalog.urls).sort()).toEqual([keyOf(body("2024-01-01")), keyOf(body("2026-07-01"))].sort());

    // Lines written before bodySha256 existed: the body is read back from url.txt.
    await writeFile(path.join(sources, "manifest.jsonl"), lines.map(({ bodySha256: _, ...l }) => JSON.stringify(l)).join("\n") + "\n");
    const legacy = await buildCatalog();
    expect(Object.keys(legacy.catalog.urls).sort()).toEqual(Object.keys(catalog.urls).sort());
  });

  it("keys a short body as before", async () => {
    await setup();
    await archiveResponse({ url, method: "POST", body: '{"date":"2026-01-01"}' }, "{}", "rates.byPlace.json");
    const { catalog } = await buildCatalog();
    expect(Object.keys(catalog.urls)).toEqual([keyOf('{"date":"2026-01-01"}')]);
  });

  it("marks a capture KNOWN-BAD.md lists, typed by its bytes", async () => {
    const sources = await setup();
    const page = "https://census.example/tl_2026_51059_addrfeat.zip";
    const rejected = "<html><head><title>Request Rejected</title></head></html>";
    await downloadedBytes(page, new Response(rejected));
    const sha = createHash("sha256").update(rejected).digest("hex");
    await writeFile(path.join(sources, "KNOWN-BAD.md"), `| sha256 | file | marked as | why |\n| --- | --- | --- | --- |\n| \`${sha}\` | census.example/tl_2026_51059_addrfeat.zip | request rejected | an HTML refusal, not a ZIP |\n`);
    const { catalog } = await buildCatalog();
    expect(catalog.urls[page].captures).toEqual([expect.objectContaining({ sha256: sha, bad: "request rejected", type: "text/html; charset=utf-8" })]);
  });
});
