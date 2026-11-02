/**
 * Is the evidence archive complete? Each check below is one promise the
 * archive makes (docs/data.md#evidence); the script prints every check with
 * its count and each failure, and exits 1 if any check fails.
 *
 *   npx tsx scripts/check-evidence.mts            # local checks (artifacts/sources)
 *   npx tsx scripts/check-evidence.mts --public   # also: every copy is on evidence.opentaxrate.com
 *
 * Checks:
 *   1. every taxability citation has an archived copy
 *   2. every citation's quote is on one of its copies
 *   3. every watched page (src/taxability/rules/watch.json) has a copy
 *   4. every benchmark case's source has a copy (<artifacts>/taxability/evals
 *      and evals-holdout, beside the sources; a missing corpus fails)
 *   5. no cited page's only copies are known-bad captures (artifacts/sources/KNOWN-BAD.md)
 *   6. every manifest entry's bytes are archived: a file with its SHA-256
 *      and its recorded size, at its path or moved aside to previous/
 *   7. every file in artifacts/sources is in the manifest (sidecars and
 *      files listed in UNINDEXED.md aside)
 *   8. every POSTed answer is keyed by its whole request: a body cut short
 *      in the manifest has its whole body (bodySha256, or a url.txt that is
 *      this request's and whose body hashes to the folder's id and to
 *      bodySha256 where both are there), and no two different bodies share
 *      a catalog key
 *   9. every PDF copy has its text extracted, page by page (or is a scan,
 *      which says so)
 *  10. every quote cited on a PDF is on one of its pages
 *  11. no quote rests on a scan unread by a person: a quote cited on a page
 *      whose copy is a scanned PDF and that no copy's text layer has must be
 *      listed in src/taxability/rules/read-off-scans.json ({ url, quote, by,
 *      on }), read off the scan by a person; a machine transcription
 *      (<sha256>.machine.json) never counts
 *  12. every benchmark case's source quote is on one of that source's copies
 *  13. (--public) every copy is on the public archive
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { copiesByUrl, holding, manifestEntries, sourceHashes, sourcesRoot } from "../src/ingest/archive.js";
import { catalogKey, requestBody, sidecarBody } from "../src/evidence.js";
import { pageText, quoteOnPage } from "../src/taxability/fetch.js";
import { readRuleFiles } from "../src/taxability/rules/index.js";
import { pageOf, pdfText, textDir } from "../src/pdf-text.js";

const repo = path.resolve(import.meta.dirname, "..");
const root = sourcesRoot();
// The benchmark cases sit beside the sources, under the same artifacts
// folder (OPENTAXRATE_DOWNLOAD_DIR, else artifacts/).
const artifacts = path.dirname(root);
const publicCheck = process.argv.includes("--public");

interface Check {
  name: string;
  checked: number;
  failures: string[];
}
const checks: Check[] = [];
const check = (name: string): Check => {
  const c = { name, checked: 0, failures: [] as string[] };
  checks.push(c);
  return c;
};

const manifest = manifestEntries(root);
const hashes = sourceHashes(root);
const copies = copiesByUrl();
const badHashes = new Set(
  existsSync(path.join(root, "KNOWN-BAD.md")) ? [...readFileSync(path.join(root, "KNOWN-BAD.md"), "utf8").matchAll(/\b([0-9a-f]{64})\b/g)].map((m) => m[1]) : [],
);
// Quotes a person read off a scanned PDF (the quote check can't read a
// scan, and never reads its machine transcription).
const readOffScansFile = path.join(repo, "src/taxability/rules/read-off-scans.json");
const readOffScans = new Set(
  (existsSync(readOffScansFile) ? (JSON.parse(readFileSync(readOffScansFile, "utf8")) as Array<{ url: string; quote: string; by: string; on: string }>) : [])
    .filter((r) => r.by && r.on)
    .map((r) => `${r.url}\n${r.quote}`),
);
const isScan = (sha256: string) => {
  try {
    return (JSON.parse(readFileSync(path.join(textDir(), `${sha256}.json`), "utf8")) as { scanned?: boolean }).scanned === true;
  } catch {
    return false;
  }
};
const texts = new Map<string, string | null>();
// A PDF's text as both pdftotext readings: reading order, and its -layout
// pages (a two-column page interleaves in the first, not the second).
// Both are the PDF's own text layer; a quote found in either is on the page.
const textOf = (file: string) => {
  if (!texts.has(file)) {
    const bytes = readFileSync(path.join(root, file));
    let text = pageText(new Uint8Array(bytes));
    if (text !== null && bytes.subarray(0, 1024).toString("latin1").includes("%PDF-")) {
      const layout = pdfText(createHash("sha256").update(bytes).digest("hex"), path.join(root, file))?.layout;
      if (layout?.length) text = `${text}\n${layout.join("\n")}`;
    }
    texts.set(file, text);
  }
  return texts.get(file)!;
};

// 1, 2, 5: the rules' citations.
const { rules } = readRuleFiles();
const hasCopy = check("1. every taxability citation has an archived copy");
const quoted = check("2. every citation's quote is on one of its copies");
const notOnlyBad = check("5. no cited page's only copies are known-bad captures");
const seen = new Set<string>();
for (const r of rules)
  for (const c of r.citations) {
    const held = copies.get(c.url) ?? [];
    if (!seen.has(c.url)) {
      seen.add(c.url);
      hasCopy.checked++;
      if (!held.length) hasCopy.failures.push(c.url);
      else {
        notOnlyBad.checked++;
        if (held.every((k) => badHashes.has(k.sha256))) notOnlyBad.failures.push(c.url);
      }
    }
    if (!c.quote || !held.length) continue;
    quoted.checked++;
    if (!held.some((k) => { const t = textOf(k.file); return t !== null && quoteOnPage(t, c.quote!); }) && !(readOffScans.has(`${c.url}\n${c.quote}`) && held.some((k) => isScan(k.sha256))))
      quoted.failures.push(`${r.file} ${r.tax} ${r.code} ${r.from}: "${c.quote.slice(0, 60)}" on ${c.url}`);
  }

// 3: the watch list.
const watched = check("3. every watched page has a copy");
for (const w of JSON.parse(readFileSync(path.join(repo, "src/taxability/rules/watch.json"), "utf8")) as Array<{ url: string }>) {
  watched.checked++;
  if (!copies.has(w.url)) watched.failures.push(w.url);
}

// 4, 12: the benchmark cases' sources, and their quotes.
const cases = check("4. every benchmark case's source has a copy");
const caseQuoted = check("12. every benchmark case's source quote is on one of that source's copies");
const caseUrls = new Set<string>();
const caseQuotes: Array<{ where: string; url: string; quote: string }> = [];
const walk = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".json"))
      for (const c of JSON.parse(readFileSync(p, "utf8")) as Array<{ id?: string; source?: { url: string; quote?: string }; sources?: Array<{ url: string; quote?: string }> }>)
        for (const s of [c.source, ...(c.sources ?? [])]) {
          if (!s?.url) continue;
          caseUrls.add(s.url);
          if (s.quote) caseQuotes.push({ where: `${path.relative(artifacts, p)} ${c.id ?? "?"}`, url: s.url, quote: s.quote });
        }
  }
};
for (const corpus of ["taxability/evals", "taxability/evals-holdout"]) {
  const dir = path.join(artifacts, corpus);
  // A corpus that isn't there is a failure, never a pass with nothing checked.
  if (!existsSync(dir)) cases.failures.push(`${dir} is missing (restore it: pnpm bench restore)`);
  else walk(dir);
}
for (const u of caseUrls) {
  cases.checked++;
  if (!copies.has(u)) cases.failures.push(u);
}
for (const q of caseQuotes) {
  const held = copies.get(q.url) ?? [];
  if (!held.length) continue; // check 4 reports it
  caseQuoted.checked++;
  if (!held.some((k) => { const t = textOf(k.file); return t !== null && quoteOnPage(t, q.quote); }))
    caseQuoted.failures.push(`${q.where}: "${q.quote.slice(0, 60)}" on ${q.url}`);
}

// 6: the manifest's bytes, by hash and size, wherever they are now.
const intact = check("6. every manifest entry's bytes are archived (a file with its hash and recorded size, at its path or in previous/)");
let moved = 0;
for (const e of manifest) {
  intact.checked++;
  const held = holding(e, hashes);
  if (!held) intact.failures.push(`${e.url}: ${e.file} (${e.sha256.slice(0, 12)}) not on disk`);
  else if (hashes.sizeOf.get(held) !== e.bytes) intact.failures.push(`${e.url}: ${held} holds ${e.sha256.slice(0, 12)} in ${hashes.sizeOf.get(held)} bytes, the manifest says ${e.bytes}`);
  else if (held !== e.file) moved++;
}

// 7: every file is in the manifest.
const indexed = check("7. every file in artifacts/sources is in the manifest");
const unindexedListed = existsSync(path.join(root, "UNINDEXED.md")) ? readFileSync(path.join(root, "UNINDEXED.md"), "utf8") : "";
const manifestHashes = new Set(manifest.map((e) => e.sha256));
for (const [rel, h] of hashes.hashOf) {
  if (["manifest.jsonl", "url.txt", "KNOWN-BAD.md", "UNINDEXED.md", "GAPS.md"].includes(path.basename(rel))) continue;
  indexed.checked++;
  if (!manifestHashes.has(h) && !unindexedListed.includes(rel) && !unindexedListed.includes(h)) indexed.failures.push(rel);
}

// 8: each POSTed answer's request, whole.
const keyed = check("8. every POSTed answer is keyed by its whole request (a cut-short body's url.txt checked against it)");
const bodiesByKey = new Map<string, Set<string>>();
for (const e of manifest) {
  if (e.body === undefined) continue;
  const body = requestBody(e, root);
  if (body.kind === "whole") {
    const key = catalogKey(e, root);
    if (!bodiesByKey.has(key)) bodiesByKey.set(key, new Set());
    bodiesByKey.get(key)!.add(body.sha256);
  }
  if (e.body.length < 2000 && !(e.bodySha256 && e.bodySha256 !== createHash("sha256").update(e.body).digest("hex"))) continue;
  keyed.checked++;
  if (body.kind === "cut") keyed.failures.push(`${e.url} (${e.file}): body cut short and ${body.why}`);
  else if (e.body.length < 2000) keyed.failures.push(`${e.url} (${e.file}): bodySha256 isn't its body's`);
  else if (body.from === "line") {
    // A line with its own hash: a url.txt beside it must be the same body.
    const full = sidecarBody(e, root);
    if (full === undefined) keyed.failures.push(`${e.url} (${e.file}): url.txt names another request`);
    else if (full !== null && createHash("sha256").update(full).digest("hex") !== e.bodySha256) keyed.failures.push(`${e.url} (${e.file}): url.txt's body isn't the one bodySha256 hashes`);
  }
}
for (const [key, bodies] of bodiesByKey) if (bodies.size > 1) keyed.failures.push(`${key}: ${bodies.size} different bodies under one catalog key`);

// 9, 10: PDFs as text.
const extracted = check("9. every PDF copy has its text extracted, page by page");
const scans: string[] = [];
const pdfTextOf = new Map<string, ReturnType<typeof pdfText>>();
for (const [h, files] of hashes.filesOf) {
  if (!manifestHashes.has(h) && files.every((f) => path.basename(f) === "url.txt")) continue;
  const p = path.join(root, files[0]);
  if (!readFileSync(p).subarray(0, 1024).toString("latin1").includes("%PDF-")) continue;
  extracted.checked++;
  const t = pdfText(h, p);
  pdfTextOf.set(h, t);
  if (!t) extracted.failures.push(`${path.relative(root, p)}: pdftotext couldn't read it`);
  else if (t.scanned) scans.push(path.relative(root, p));
}
const onPage = check("10. every quote cited on a PDF is on one of its pages");
for (const r of rules)
  for (const c of r.citations) {
    if (!c.quote) continue;
    const pdfCopies = (copies.get(c.url) ?? []).filter((k) => pdfTextOf.has(k.sha256));
    if (!pdfCopies.length) continue;
    onPage.checked++;
    if (!pdfCopies.some((k) => pageOf(pdfTextOf.get(k.sha256)?.pages ?? [], c.quote!, quoteOnPage) > 0) && !(readOffScans.has(`${c.url}\n${c.quote}`) && pdfCopies.some((k) => pdfTextOf.get(k.sha256)?.scanned)))
      onPage.failures.push(`${r.file} ${r.tax} ${r.code} ${r.from}: "${c.quote.slice(0, 50)}" on ${c.url}`);
  }

// 11: quotes on scans.
const onScan = check("11. no quote rests on a scanned PDF unless a person read it off the scan");
for (const r of rules)
  for (const c of r.citations) {
    if (!c.quote) continue;
    const held = copies.get(c.url) ?? [];
    if (!held.some((k) => pdfTextOf.get(k.sha256)?.scanned)) continue;
    onScan.checked++;
    const inText = held.some((k) => !pdfTextOf.get(k.sha256)?.scanned && (() => { const t = textOf(k.file); return t !== null && quoteOnPage(t, c.quote!); })());
    if (!inText && !readOffScans.has(`${c.url}\n${c.quote}`))
      onScan.failures.push(`needs a person to read it off the scan (read-off-scans.json): ${r.file} ${r.tax} ${r.code} ${r.from}: "${c.quote.slice(0, 50)}" on ${c.url}`);
  }

// 13: the public archive.
if (publicCheck) {
  const pub = check("13. every copy is on evidence.opentaxrate.com");
  const hashes = [...manifestHashes];
  for (let i = 0; i < hashes.length; i += 16)
    await Promise.all(
      hashes.slice(i, i + 16).map(async (h) => {
        pub.checked++;
        const r = await fetch(`https://evidence.opentaxrate.com/sha256/${h}/raw`, { method: "HEAD" }).catch(() => null);
        if (!r || r.status !== 200) pub.failures.push(`${h} (${r?.status ?? "no answer"})`);
      }),
    );
}

let failed = 0;
for (const c of checks.sort((a, b) => parseInt(a.name) - parseInt(b.name))) {
  const ok = c.failures.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}: ${c.checked} checked${ok ? "" : `, ${c.failures.length} failing`}`);
  for (const f of c.failures.slice(0, 15)) console.log(`        ${f}`);
  if (c.failures.length > 15) console.log(`        … and ${c.failures.length - 15} more`);
}
if (moved) console.log(`note  ${moved} manifest entries' bytes are no longer at their recorded path (moved to previous/ when it was filed again); check 6 found each by its hash`);
if (scans.length) console.log(`note  ${scans.length} PDFs are scans with no text layer (the archive says so): ${scans.slice(0, 5).join(", ")}${scans.length > 5 ? ", …" : ""}`);
process.exit(failed ? 1 : 0);
