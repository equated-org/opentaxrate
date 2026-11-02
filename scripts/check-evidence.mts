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
 *   4. every benchmark case's source has a copy (artifacts/taxability/evals*)
 *   5. no cited page's only copies are known-bad captures (artifacts/sources/KNOWN-BAD.md)
 *   6. every manifest entry's file exists with its recorded hash and size
 *   7. every file in artifacts/sources is in the manifest (sidecars and
 *      files listed in UNINDEXED.md aside)
 *   8. every POSTed answer whose stored body was cut short has its full body
 *      (bodySha256, or the url.txt sidecar), so the catalog keys it rightly
 *   9. every PDF copy has its text extracted, page by page (or is a scan,
 *      which says so)
 *  10. every quote cited on a PDF is on one of its pages
 *  11. (--public) every copy is on the public archive
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { copiesByUrl, sourcesRoot } from "../src/ingest/archive.js";
import { pageText, quoteOnPage } from "../src/taxability/fetch.js";
import { readRuleFiles } from "../src/taxability/rules/index.js";
import { pageOf, pdfText } from "../src/pdf-text.js";

const repo = path.resolve(import.meta.dirname, "..");
const root = sourcesRoot();
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

type Entry = { at: string; url: string; file: string; sha256: string; bytes: number; body?: string; bodySha256?: string; method?: string };
const manifest: Entry[] = readFileSync(path.join(root, "manifest.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Entry);
const copies = copiesByUrl();
const badHashes = new Set(
  existsSync(path.join(root, "KNOWN-BAD.md")) ? [...readFileSync(path.join(root, "KNOWN-BAD.md"), "utf8").matchAll(/\b([0-9a-f]{64})\b/g)].map((m) => m[1]) : [],
);
const texts = new Map<string, string | null>();
const textOf = (file: string) => {
  if (!texts.has(file)) texts.set(file, pageText(new Uint8Array(readFileSync(path.join(root, file)))));
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
    if (!held.some((k) => { const t = textOf(k.file); return t !== null && quoteOnPage(t, c.quote!); }))
      quoted.failures.push(`${r.file} ${r.tax} ${r.code} ${r.from}: "${c.quote.slice(0, 60)}" on ${c.url}`);
  }

// 3: the watch list.
const watched = check("3. every watched page has a copy");
for (const w of JSON.parse(readFileSync(path.join(repo, "src/taxability/rules/watch.json"), "utf8")) as Array<{ url: string }>) {
  watched.checked++;
  if (!copies.has(w.url)) watched.failures.push(w.url);
}

// 4: the benchmark cases' sources.
const cases = check("4. every benchmark case's source has a copy");
const caseUrls = new Set<string>();
const walk = (dir: string) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".json"))
      for (const c of JSON.parse(readFileSync(p, "utf8")) as Array<{ source?: { url: string }; sources?: Array<{ url: string }> }>)
        for (const s of [c.source, ...(c.sources ?? [])]) if (s?.url) caseUrls.add(s.url);
  }
};
walk(path.join(repo, "artifacts/taxability/evals"));
walk(path.join(repo, "artifacts/taxability/evals-holdout"));
for (const u of caseUrls) {
  cases.checked++;
  if (!copies.has(u)) cases.failures.push(u);
}

// 6, 8: the manifest itself.
const intact = check("6. every manifest entry's file exists with its recorded hash and size");
const keyed = check("8. every POSTed answer cut short in the manifest has its full body");
for (const e of manifest) {
  intact.checked++;
  // The bytes are checked below by hash: a copy moved aside to previous/
  // when its URL was fetched again is found wherever it is.
  const file = path.join(root, e.file);
  if (e.body !== undefined && e.body.length >= 2000) {
    keyed.checked++;
    const sidecar = path.join(path.dirname(file), "url.txt");
    if (!e.bodySha256 && !existsSync(sidecar)) keyed.failures.push(`${e.url} (${e.file})`);
  }
}
// Every manifest hash is somewhere in the tree (its file, or previous/).
const onDisk = new Map<string, string>();
const indexed = check("7. every file in artifacts/sources is in the manifest");
const unindexedListed = existsSync(path.join(root, "UNINDEXED.md")) ? readFileSync(path.join(root, "UNINDEXED.md"), "utf8") : "";
const manifestHashes = new Set(manifest.map((e) => e.sha256));
const walkSources = (dir: string) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSources(p);
    else if (!["manifest.jsonl", "url.txt", "KNOWN-BAD.md", "UNINDEXED.md", "GAPS.md"].includes(e.name) && !e.name.endsWith(".partial")) {
      const h = createHash("sha256").update(readFileSync(p)).digest("hex");
      onDisk.set(h, p);
      indexed.checked++;
      if (!manifestHashes.has(h) && !unindexedListed.includes(path.relative(root, p)) && !unindexedListed.includes(h)) indexed.failures.push(path.relative(root, p));
    }
  }
};
walkSources(root);
for (const e of manifest) if (!onDisk.has(e.sha256)) intact.failures.push(`${e.url}: ${e.file} (${e.sha256.slice(0, 12)}) not on disk`);

// 9, 10: PDFs as text.
const extracted = check("9. every PDF copy has its text extracted, page by page");
const scans: string[] = [];
const pdfTextOf = new Map<string, ReturnType<typeof pdfText>>();
for (const [h, p] of onDisk) {
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
    if (!pdfCopies.some((k) => pageOf(pdfTextOf.get(k.sha256)?.pages ?? [], c.quote!, quoteOnPage) > 0))
      onPage.failures.push(`${r.file} ${r.tax} ${r.code} ${r.from}: "${c.quote.slice(0, 50)}" on ${c.url}`);
  }

// 11: the public archive.
if (publicCheck) {
  const pub = check("11. every copy is on evidence.opentaxrate.com");
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
for (const c of checks) {
  const ok = c.failures.length === 0;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}: ${c.checked} checked${ok ? "" : `, ${c.failures.length} failing`}`);
  for (const f of c.failures.slice(0, 15)) console.log(`        ${f}`);
  if (c.failures.length > 15) console.log(`        … and ${c.failures.length - 15} more`);
}
if (scans.length) console.log(`note  ${scans.length} PDFs are scans with no text layer (the archive says so): ${scans.slice(0, 5).join(", ")}${scans.length > 5 ? ", …" : ""}`);
process.exit(failed ? 1 : 0);
