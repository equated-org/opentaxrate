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

describe("the archive's paths and copies", () => {
  it("files a page whose path another URL needs as a folder, in either order", async () => {
    const sources = await setup();
    const { keepLocalCopy, copiesByUrl } = await import("../src/ingest/archive.js");
    const page = path.join(root!, "page.html"), edition = path.join(root!, "edition.html");
    await writeFile(page, "<p>section, current</p>");
    await writeFile(edition, "<p>section, as of 2018</p>");
    // The page first, then an edition under it; and the reverse for another section.
    expect(await keepLocalCopy("https://codes.example/section-1", page)).toBe(true);
    expect(await keepLocalCopy("https://codes.example/section-1/2018", edition)).toBe(true);
    expect(await keepLocalCopy("https://codes.example/section-2/2018", edition)).toBe(true);
    expect(await keepLocalCopy("https://codes.example/section-2", page)).toBe(true);
    const copies = copiesByUrl();
    for (const u of ["https://codes.example/section-1", "https://codes.example/section-1/2018", "https://codes.example/section-2", "https://codes.example/section-2/2018"]) {
      const [copy] = copies.get(u) ?? [];
      expect(copy, u).toBeDefined();
      expect(await readFile(path.join(sources, copy.file), "utf8")).toContain(u.endsWith("2018") ? "as of 2018" : "current");
    }
  });

  it("counts an Internet Archive capture as a dated copy of the page it captured", async () => {
    await setup();
    const { keepLocalCopy, copiesByUrl, waybackCapture } = await import("../src/ingest/archive.js");
    expect(waybackCapture("https://web.archive.org/web/20161024044355/http://rules.example.gov:80/gac/560-12-2")).toEqual({
      original: "http://rules.example.gov/gac/560-12-2",
      at: "2016-10-24T04:43:55Z",
    });
    expect(waybackCapture("https://web.archive.org/web/20261011230308id_/https://law.example.gov/TAX/1105")?.original).toBe("https://law.example.gov/TAX/1105");
    expect(waybackCapture("https://law.example.gov/TAX/1105")).toBeNull();
    const file = path.join(root!, "statute.html");
    await writeFile(file, "<p>Receipts from every retail sale</p>");
    const capture = "https://web.archive.org/web/20251010001329id_/https://law.example.gov/TAX/1210";
    await keepLocalCopy(capture, file);
    const [copy] = copiesByUrl().get("https://law.example.gov/TAX/1210") ?? [];
    expect(copy).toMatchObject({ at: "2025-10-10T00:13:29Z", via: capture });
  });
});

describe("copies whose file was later replaced", () => {
  it("doesn't read another URL's file that took the same name as a copy", async () => {
    const sources = await setup();
    const { keepLocalCopy, copiesByUrl, archivedByUrl } = await import("../src/ingest/archive.js");
    const act171 = path.join(root!, "a.pdf"), act515 = path.join(root!, "b.pdf");
    await writeFile(act171, "Act No. 171, Public Acts of 2015");
    await writeFile(act515, "Act No. 515, Public Acts of 2016 (a longer document)");
    // Both saved under one name in one folder, as a research filing did.
    await keepLocalCopy("https://laws.example/pdf/2015-PA-0171.pdf", act171, "doc.pdf");
    await keepLocalCopy("https://laws.example/pdf/2016-PA-0515.pdf", act515, "doc.pdf");
    expect(copiesByUrl().get("https://laws.example/pdf/2015-PA-0171.pdf")).toBeUndefined();
    expect(archivedByUrl().has("https://laws.example/pdf/2015-PA-0171.pdf")).toBe(false);
    // Filed again under its own name, it's found, with its own bytes.
    await keepLocalCopy("https://laws.example/pdf/2015-PA-0171.pdf", act171);
    const [copy] = copiesByUrl().get("https://laws.example/pdf/2015-PA-0171.pdf") ?? [];
    expect(await readFile(path.join(sources, copy.file), "utf8")).toContain("Act No. 171");
  });
});
