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

  it("files an answer saved earlier with its download time and where it was read from", async () => {
    const sources = await setup();
    const url = "https://lookup.example/results.php";
    const saved = { at: "2026-10-21T16:23:33.133Z", from: "research/x/dl/oracle/0a.html" };
    expect(await archiveResponse({ url, method: "POST", body: "Street=1+Main+St&ZIP=72201" }, "<html>9.5%</html>", "0a.html", saved)).toBe(true);
    const [line] = (await readFile(path.join(sources, "manifest.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(line).toMatchObject({ ...saved, method: "POST", body: "Street=1+Main+St&ZIP=72201" });
    expect(line.file).toMatch(/^lookup\.example\/results\.php\/[0-9a-f]{16}\/0a\.html\.gz$/);
    const { catalog } = await buildCatalog();
    expect(Object.values(catalog.urls)[0].captures[0].at).toBe(saved.at);
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
  it("finds a copy whose name another URL's file took, where its bytes went, never in the other file", async () => {
    const sources = await setup();
    const { keepLocalCopy, copiesByUrl, archivedByUrl } = await import("../src/ingest/archive.js");
    const act171 = path.join(root!, "a.pdf"), act515 = path.join(root!, "b.pdf");
    await writeFile(act171, "Act No. 171, Public Acts of 2015");
    await writeFile(act515, "Act No. 515, Public Acts of 2016 (a longer document)");
    // Both saved under one name in one folder, as a research filing did.
    await keepLocalCopy("https://laws.example/pdf/2015-PA-0171.pdf", act171, "doc.pdf");
    await keepLocalCopy("https://laws.example/pdf/2016-PA-0515.pdf", act515, "doc.pdf");
    // Its bytes were moved aside to previous/: that's where its copy is, never the other act's file.
    const [moved] = copiesByUrl().get("https://laws.example/pdf/2015-PA-0171.pdf") ?? [];
    expect(moved.file).toMatch(/previous\//);
    expect(await readFile(path.join(sources, moved.file), "utf8")).toContain("Act No. 171");
    expect(await readFile(path.join(sources, archivedByUrl().get("https://laws.example/pdf/2015-PA-0171.pdf")!.file), "utf8")).toContain("Act No. 171");
    // Filed again under its own name, it's found, with its own bytes.
    await keepLocalCopy("https://laws.example/pdf/2015-PA-0171.pdf", act171);
    for (const copy of copiesByUrl().get("https://laws.example/pdf/2015-PA-0171.pdf") ?? []) expect(await readFile(path.join(sources, copy.file), "utf8")).toContain("Act No. 171");
  });
});

describe("a PDF's quoted page", () => {
  it("finds the page a quote starts on, across a page break too", async () => {
    const { pageOf } = await import("../src/pdf-text.js");
    const { quoteOnPage } = await import("../src/taxability/fetch.js");
    const pages = ["Title page", "Food sold in a heated state is taxable.", "\"Retail food store\" means an establishment that", "sells food for home consumption."];
    expect(pageOf(pages, "Food sold in a heated state is taxable.", quoteOnPage)).toBe(2);
    expect(pageOf(pages, "\"Retail food store\" means an establishment that sells food for home consumption.", quoteOnPage)).toBe(3);
    expect(pageOf(pages, "Not in this document at all.", quoteOnPage)).toBe(0);
  });
});

describe("machine readings of PDFs", () => {
  it("lists where two transcriptions differ, word by word, with the place in the first", async () => {
    const { wordDiff } = await import("../src/pdf-machine.js");
    const a = "SE ¼ of Section 3, Township 1 North\n| a | b |\n|:---|:---|\n**Sale** of the-rental";
    const b = "SE ½ of Section 3, Township North\n| a | b |\n| --- | --- |\nSale of the rental";
    const diffs = wordDiff(a, b);
    expect(diffs.map(({ a, b }) => ({ a, b }))).toEqual([{ a: "¼", b: "½" }, { a: "1", b: "" }]);
    expect(a.slice(diffs[0].start, diffs[0].end)).toBe("¼");
    expect(a.slice(diffs[1].start, diffs[1].end)).toBe("1");
    // A word only the second reading has sits after the first's word before it.
    const [added] = wordDiff("taxable sales", "taxable retail sales");
    expect(added).toMatchObject({ a: "", b: "retail", start: 7, end: 7 });
    expect(wordDiff("Same words.", "same  words.")).toEqual([]);
  });

  it("measures how many of a page's words a formatted version kept", async () => {
    const { wordRecall } = await import("../src/pdf-machine.js");
    expect(wordRecall("Candy and gum  6.25%\nIce  exempt", "| Candy and gum | 6.25% |\n|---|---|\n| Ice | exempt |")).toBe(1);
    expect(wordRecall("the tax the tax", "the tax")).toBe(0.5);
    expect(wordRecall("", "anything")).toBe(1);
  });

  it("takes a page for a table by its printed columns", async () => {
    const { looksTabular } = await import("../src/pdf-machine.js");
    const row = (i: number) => `Item ${i}      Taxable      6.25%`;
    expect(looksTabular(Array.from({ length: 8 }, (_, i) => row(i)).join("\n"))).toBe(true);
    expect(looksTabular(Array.from({ length: 7 }, (_, i) => row(i)).join("\n"))).toBe(false);
    // Two-column prose: one gap a line.
    expect(looksTabular(Array.from({ length: 20 }, () => "Sales of food are exempt     when sold for home use").join("\n"))).toBe(false);
  });
});

describe("a PDF's text", () => {
  it("keeps the layout view beside the reading-order text, and adds it to a text kept without one", async () => {
    const { execFileSync } = await import("node:child_process");
    const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
    const sources = await setup();
    const { pdfText, textDir } = await import("../src/pdf-text.js");
    // A two-page PDF, made by hand (no PDF tool needed).
    const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>"];
    const pageObj = (content: number) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 7 0 R >> >> >>`;
    const stream = (text: string) => { const s = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`; return `<< /Length ${s.length} >>\nstream\n${s}\nendstream`; };
    objects.push(pageObj(4), stream("Page one   Taxable   6.25%"), pageObj(6), stream("Page two"), "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const file = path.join(sources, "doc.pdf");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(sources, { recursive: true });
    writeFileSync(file, pdf, "latin1");
    try {
      execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    } catch {
      return; // no pdftotext here
    }
    const text = pdfText("e".repeat(64), file)!;
    expect(text.pages).toHaveLength(2);
    expect(text.layout).toHaveLength(2);
    expect(text.layout[0]).toContain("Page one");
    // A text kept before the layout view gets it, the reading-order text untouched.
    const kept = path.join(textDir(), `${"e".repeat(64)}.json`);
    const { layout: _layout, ...old } = JSON.parse(readFileSync(kept, "utf8"));
    writeFileSync(kept, JSON.stringify(old));
    const again = pdfText("e".repeat(64), file)!;
    expect(again.pages).toEqual(text.pages);
    expect(again.layout).toEqual(text.layout);
    expect(existsSync(kept) && JSON.parse(readFileSync(kept, "utf8")).layout).toEqual(text.layout);
  });
});

describe("copies resolved by their bytes, not their size", () => {
  const read = async (sources: string, file: string) => readFile(path.join(sources, file), "utf8");

  it("gives each copy a file holding its own hash after A, B, A at one path (same sizes)", async () => {
    const sources = await setup();
    const { copiesByUrl, archivedByUrl } = await import("../src/ingest/archive.js");
    const page = "https://review.example/aba.html";
    for (const body of ["AAAA", "BBBB", "AAAA"]) await downloadedBytes(page, new Response(body));
    const copies = copiesByUrl().get(page)!;
    // Three observations, in capture order: A, B, A (the return isn't dropped).
    expect(copies.map((c) => c.sha256)).toEqual(["AAAA", "BBBB", "AAAA"].map((b) => createHash("sha256").update(b).digest("hex")));
    for (const c of copies) expect(createHash("sha256").update(await read(sources, c.file)).digest("hex")).toBe(c.sha256);
    // The newest copy holding A is A's bytes, and the catalog agrees.
    const newestA = [...copies].reverse().find((c) => c.sha256 === copies[0].sha256)!;
    expect(await read(sources, newestA.file)).toBe("AAAA");
    expect(await read(sources, archivedByUrl().get(page)!.file)).toBe("AAAA");
    const { catalog } = await buildCatalog();
    expect(catalog.urls[page].captures.map((c) => [c.at, c.sha256])).toEqual(copies.map((c) => [c.at, c.sha256]));
  });

  it("keeps an older copy whose path a different-sized one replaced, found in previous/", async () => {
    const sources = await setup();
    const { copiesByUrl } = await import("../src/ingest/archive.js");
    const page = "https://review.example/rule.html";
    await downloadedBytes(page, new Response("<p>Old quoted rule</p>"));
    await downloadedBytes(page, new Response("<p>New, longer and different rule content</p>"));
    const copies = copiesByUrl().get(page)!;
    expect(copies).toHaveLength(2);
    expect(copies[0].file).toMatch(/previous\//);
    expect(await read(sources, copies[0].file)).toBe("<p>Old quoted rule</p>");
    expect(copies.map((c) => c.bytes)).toEqual(["<p>Old quoted rule</p>".length, "<p>New, longer and different rule content</p>".length]);
    const { catalog } = await buildCatalog();
    expect(catalog.urls[page].captures.map((c) => c.sha256)).toEqual(copies.map((c) => c.sha256));
  });

  it("dates identical bytes filed later but downloaded earlier by their earliest download", async () => {
    await setup();
    const { copiesByUrl } = await import("../src/ingest/archive.js");
    const lookup = "https://review.example/lookup?x=1";
    await archiveResponse({ url: lookup }, "same answer", "answer.txt", { at: "2026-10-28T00:00:00.000Z" });
    await archiveResponse({ url: lookup }, "same answer", "answer.txt", { at: "2026-10-21T00:00:00.000Z" });
    expect(copiesByUrl().get(lookup)!.map((c) => c.at)).toEqual(["2026-10-21T00:00:00.000Z"]);
    const { catalog } = await buildCatalog();
    expect(catalog.urls[lookup].captures.map((c) => c.at)).toEqual(["2026-10-21T00:00:00.000Z"]);
  });

  it("caches the archive's hashes on disk, and hashes a file again when it changes", async () => {
    const sources = await setup();
    const { sourceHashes } = await import("../src/ingest/archive.js");
    await downloadedBytes("https://review.example/c.html", new Response("one"));
    expect(sourceHashes().hashOf.get("review.example/c.html")).toBe(createHash("sha256").update("one").digest("hex"));
    const cache = JSON.parse(await readFile(path.join(root!, "cache", "source-hashes.json"), "utf8"));
    expect(Object.keys(cache.files)).toEqual(["review.example/c.html"]);
    await writeFile(path.join(sources, "review.example/c.html"), "two");
    expect(sourceHashes().hashOf.get("review.example/c.html")).toBe(createHash("sha256").update("two").digest("hex"));
  });
});

describe("two writers filing to one place at once", () => {
  it("keeps both captures: neither overwrites the other", async () => {
    const sources = await setup();
    const { copiesByUrl } = await import("../src/ingest/archive.js");
    const page = "https://review.example/race.html";
    const results = await Promise.allSettled(["one answer", "the other answer", "a third answer"].map((b) => downloadedBytes(page, new Response(b))));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const copies = copiesByUrl().get(page)!;
    expect(new Set(copies.map((c) => c.sha256)).size).toBe(3);
    const held = await Promise.all(copies.map((c) => readFile(path.join(sources, c.file), "utf8")));
    expect(held.sort()).toEqual(["a third answer", "one answer", "the other answer"]);
    const { catalog } = await buildCatalog();
    expect(catalog.urls[page].captures).toHaveLength(3);
  });
});

describe("listing the bucket", () => {
  it("reads sha256/ and text/ keys from an S3 listing", async () => {
    const { listedHashes, listedKeys } = await import("../src/evidence.js");
    const a = "a".repeat(64), b = "b".repeat(64);
    const xml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>opentaxrate-evidence</Name><IsTruncated>false</IsTruncated>`
      + `<Contents><Key>sha256/${a}</Key><LastModified>2026-10-30T00:00:00.000Z</LastModified><ETag>&quot;0123456789abcdef0123456789abcdef&quot;</ETag><Size>10</Size></Contents>`
      + `<Contents><Key>text/${b}.json</Key><ETag>"fedcba9876543210fedcba9876543210"</ETag><Size>20</Size></Contents></ListBucketResult>`;
    expect(listedHashes(xml)).toEqual([a, b]);
    expect(listedKeys(xml)).toEqual(new Map([[`sha256/${a}`, "0123456789abcdef0123456789abcdef"], [`text/${b}.json`, "fedcba9876543210fedcba9876543210"]]));
  });
});

describe("a request's identity", () => {
  it("files a bodyless POST, an empty-bodied POST and a GET as three requests", async () => {
    const sources = await setup();
    const { fileAnswer } = await import("../src/ingest/archive.js");
    const page = "https://review.example/no-body";
    const answer = path.join(root!, "answer.html"), empty = path.join(root!, "empty.txt");
    await writeFile(empty, "");
    for (const [text, options] of [["GET answer", {}], ["POST, no body", { method: "post" }], ["POST, empty body", { method: "POST", bodyFile: empty }]] as const) {
      await writeFile(answer, text);
      await fileAnswer(page, answer, options);
    }
    const lines = (await readFile(path.join(sources, "manifest.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => [l.method, l.body])).toEqual([[undefined, undefined], ["POST", undefined], ["POST", ""]]);
    expect(new Set(lines.map((l) => path.dirname(l.file))).size).toBe(3);
    const { catalog } = await buildCatalog();
    expect(Object.keys(catalog.urls).sort()).toEqual([page, `${page} (POST)`, `${page} (POST ${createHash("sha256").update("").digest("hex").slice(0, 12)})`].sort());
  });

  it("never takes a cut-short body's prefix for its whole body when url.txt isn't that request's", async () => {
    const sources = await setup();
    await archiveResponse({ url, method: "POST", body: body("2024-01-01") }, '{"rate":0.03}', "rates.byPlace.json");
    await archiveResponse({ url, method: "POST", body: body("2026-07-01") }, '{"rate":0.04}', "rates.byPlace.json");
    const lines = (await readFile(path.join(sources, "manifest.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    // Lines from before bodySha256, with url.txt naming another request.
    await writeFile(path.join(sources, "manifest.jsonl"), lines.map(({ bodySha256: _, ...l }) => JSON.stringify(l)).join("\n") + "\n");
    for (const l of lines) await writeFile(path.join(sources, path.dirname(l.file), "url.txt"), `POST https://review.example/other\n${l.body}wrong\n`);
    const { catalog } = await buildCatalog();
    const keys = Object.keys(catalog.urls);
    expect(keys).toHaveLength(2);
    expect(keys.every((k) => k.includes("whole body not kept"))).toBe(true);
    const { requestBody } = await import("../src/evidence.js");
    const { bodySha256: _, ...legacy } = lines[0];
    expect(requestBody(legacy, sources)).toMatchObject({ kind: "cut" });
    // A url.txt that is the request's, but whose body isn't the folder's: cut too.
    await writeFile(path.join(sources, path.dirname(lines[0].file), "url.txt"), `POST ${url}\n${body("2026-07-01")}\n`);
    expect(requestBody(legacy, sources)).toMatchObject({ kind: "cut" });
    // Its own url.txt: whole again.
    await writeFile(path.join(sources, path.dirname(lines[0].file), "url.txt"), `POST ${url}\n${body("2024-01-01")}\n`);
    expect(requestBody(legacy, sources)).toMatchObject({ kind: "whole", sha256: createHash("sha256").update(body("2024-01-01")).digest("hex") });
  });
});

describe("the Louisiana lookup's intermediate certificate", () => {
  it("is filed in the archive when fetched", async () => {
    const sources = await setup();
    const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(pem)));
    try {
      const { intermediate } = await import("../src/ingest/states/louisiana.js");
      expect(await intermediate()).toBe(pem);
    } finally {
      vi.unstubAllGlobals();
    }
    const lines = (await readFile(path.join(sources, "manifest.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([expect.objectContaining({ url: "https://certs.godaddy.com/repository/gdig2.crt.pem", sha256: createHash("sha256").update(pem).digest("hex") })]);
  });
});
