/**
 * The public evidence archive: every file in artifacts/sources (each
 * download refresh and taxability ingest filed, older versions included),
 * mirrored unchanged to an R2 bucket under its SHA-256, and a catalog of
 * which URL each copy was fetched from, when, and which rules cite it.
 * evidence/worker.js serves it at evidence.opentaxrate.com.
 *
 *   sha256/<hash>    the original bytes, named by their hash; never rewritten
 *   catalog.json     { urls: { <url>: { captures: [{ at, sha256, bytes, type, bad? }], citedBy: [{ rule, quote }] } } }
 *
 * A POSTed query's answer is filed under "<url> (POST <first 12 of the
 * body's sha256>)", hashed over the whole body: the manifest's own copy is
 * cut at 2,000 characters, so a long body is read back from the query
 * folder's url.txt (or taken from the line's bodySha256). A capture listed
 * in artifacts/sources/KNOWN-BAD.md (an error page, a rejected download, a
 * fragment) carries `bad`, saying what it is instead.
 *
 * Content-addressed, so a citation pinned to a hash always means the same
 * bytes, an unchanged page is stored once, and uploading again sends only
 * what's new. Nothing is transformed: a readable view is the Worker's,
 * made when a page is asked for.
 *
 * Settings: R2_ACCOUNT_ID, an R2 key (OPENTAXRATE_R2_ACCESS_KEY_ID and
 * OPENTAXRATE_R2_SECRET_ACCESS_KEY, else R2_ACCESS_KEY_ID and
 * R2_SECRET_ACCESS_KEY), and OPENTAXRATE_EVIDENCE_BUCKET (default
 * opentaxrate-evidence).
 */
import { createHash } from "node:crypto";
import { closeSync, createReadStream, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { sourcesRoot, waybackCapture } from "./ingest/archive.js";
import { readRuleFiles } from "./taxability/rules/index.js";

export interface Capture {
  at: string;
  sha256: string;
  bytes: number;
  type: string;
  /** The Internet Archive capture this copy came through (the site blocked
   *  downloads, or the edition is gone); `at` is then the capture's day. */
  via?: string;
  /** What this copy is instead of the page (KNOWN-BAD.md): "request rejected",
   *  "error answer", a fragment. Kept, never deleted, but not evidence of it. */
  bad?: string;
}

export interface Catalog {
  generatedAt: string;
  urls: Record<string, { captures: Capture[]; citedBy: Array<{ rule: string; tax: string; code: string; from: string; to?: string; quote?: string }> }>;
}

const TYPES: Array<[RegExp, string]> = [
  [/\.pdf$/i, "application/pdf"],
  [/\.(html?|aspx|php|jsp)$/i, "text/html; charset=utf-8"],
  [/\.json$/i, "application/json"],
  [/\.geojson$/i, "application/geo+json"],
  [/\.csv$/i, "text/csv; charset=utf-8"],
  [/\.txt$/i, "text/plain; charset=utf-8"],
  [/\.xml$/i, "application/xml"],
  [/\.zip$/i, "application/zip"],
  [/\.xlsx$/i, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [/\.xls$/i, "application/vnd.ms-excel"],
  [/\.docx?$/i, "application/msword"],
  [/\.gz$/i, "application/gzip"],
];

/** A file's type from its name, else from its first bytes. */
function typeOf(file: string, head: Buffer): string {
  for (const [pattern, type] of TYPES) if (pattern.test(file)) return type;
  const start = head.toString("latin1", 0, 512).trimStart().toLowerCase();
  if (start.startsWith("%pdf-")) return "application/pdf";
  if (start.startsWith("<!doctype html") || start.startsWith("<html") || start.includes("<head")) return "text/html; charset=utf-8";
  if (start.startsWith("{") || start.startsWith("[")) return "application/json";
  return "application/octet-stream";
}

/** Every file under the archive, keyed by its SHA-256. */
async function hashArchive(root: string): Promise<Map<string, string>> {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== "manifest.jsonl" && !entry.name.endsWith(".partial")) files.push(full);
    }
  };
  walk(root);
  const byHash = new Map<string, string>();
  for (const file of files) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
    byHash.set(hash.digest("hex"), file);
  }
  return byHash;
}

interface ManifestEntry {
  at: string;
  url: string;
  method?: string;
  /** The body as recorded: its first 2,000 characters. */
  body?: string;
  /** The whole body's SHA-256, on lines written since it was recorded. */
  bodySha256?: string;
  sha256: string;
  bytes: number;
  file: string;
}

/** The SHA-256 of a POST's whole body: the line's bodySha256, else the body
 *  url.txt kept beside the answer where the line's copy may be cut short
 *  (url.txt is "<METHOD> <url>\n<body>\n"), else the line's body. */
export function requestBodySha256(entry: ManifestEntry, root: string): string | undefined {
  if (!entry.body) return undefined; // an empty body was always keyed by the URL alone
  if (entry.bodySha256) return entry.bodySha256;
  let body = entry.body;
  if (body.length >= 2000) {
    try {
      const text = readFileSync(path.join(root, path.dirname(entry.file), "url.txt"), "utf8");
      const newline = text.indexOf("\n");
      const asked = text.slice(0, newline);
      const full = text.slice(newline + 1).replace(/\n$/, "");
      if (asked === `${entry.method ?? "POST"} ${entry.url}` && full.startsWith(body)) body = full;
    } catch {
      // No url.txt: the recorded prefix is all there is.
    }
  }
  return createHash("sha256").update(body).digest("hex");
}

/** Captures that aren't evidence of their page, from KNOWN-BAD.md's table:
 *  rows "| `<sha256>` | <file> | <marked as> | <why> |". */
export function knownBad(root: string): Map<string, string> {
  const bad = new Map<string, string>();
  let text = "";
  try {
    text = readFileSync(path.join(root, "KNOWN-BAD.md"), "utf8");
  } catch {
    return bad;
  }
  for (const m of text.matchAll(/^\|\s*`([0-9a-f]{64})`\s*\|[^|\n]*\|\s*([^|\n]+?)\s*\|/gm)) bad.set(m[1], m[2]);
  return bad;
}

/** The catalog: each URL's captures (from the manifest, those whose bytes
 *  are still here) and the rules that cite it. */
export async function buildCatalog(): Promise<{ catalog: Catalog; files: Map<string, string> }> {
  const root = sourcesRoot();
  const files = await hashArchive(root);
  const bad = knownBad(root);
  const urls: Catalog["urls"] = {};
  for (const line of readFileSync(path.join(root, "manifest.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as ManifestEntry;
    const file = files.get(entry.sha256);
    if (!file) continue;
    const head = Buffer.alloc(512);
    const fd = openSync(file, "r");
    readSync(fd, head, 0, 512, 0);
    closeSync(fd);
    // An API's answer to one posted query isn't a version of a page: each
    // query is its own entry, keyed by the request's hash.
    const bodySha256 = requestBodySha256(entry, root);
    const key = bodySha256 ? `${entry.url} (${entry.method ?? "POST"} ${bodySha256.slice(0, 12)})` : entry.url;
    const record = (urls[key] ??= { captures: [], citedBy: [] });
    const marked = bad.get(entry.sha256);
    // A file named .zip or .pdf that is an HTML error page is typed by its bytes.
    const type = marked ? typeOf("", head) : typeOf(entry.file, head);
    const capture: Capture = { at: entry.at, sha256: entry.sha256, bytes: entry.bytes, type, ...(marked ? { bad: marked } : {}) };
    // A refetch of the same bytes isn't a new capture; a page that changed
    // and changed back (A, B, A) is three.
    if (record.captures.at(-1)?.sha256 !== entry.sha256) record.captures.push(capture);
    // An Internet Archive capture is also a copy of the page it captured,
    // on the day it was captured: citations name the original page.
    const archived = waybackCapture(entry.url);
    if (archived) {
      const original = (urls[archived.original] ??= { captures: [], citedBy: [] });
      if (!original.captures.some((c) => c.sha256 === entry.sha256)) original.captures.push({ ...capture, at: archived.at, via: entry.url });
    }
  }
  for (const record of Object.values(urls)) record.captures.sort((a, b) => a.at.localeCompare(b.at));
  for (const r of readRuleFiles().rules)
    for (const c of r.citations) {
      const record = urls[c.url];
      if (record) record.citedBy.push({ rule: `${r.tax} ${r.code} from ${r.from}${r.to ? ` to ${r.to}` : ""}`, tax: r.tax, code: r.code, from: r.from, ...(r.to ? { to: r.to } : {}), ...(c.quote ? { quote: c.quote } : {}) });
    }
  return { catalog: { generatedAt: new Date().toISOString(), urls }, files };
}

/** Uploads every copy the bucket lacks, then the catalog. */
export async function uploadEvidence(env: NodeJS.ProcessEnv = process.env): Promise<{ uploaded: number; kept: number; bytes: number }> {
  const account = env.R2_ACCOUNT_ID;
  const accessKeyId = env.OPENTAXRATE_R2_ACCESS_KEY_ID ?? env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.OPENTAXRATE_R2_SECRET_ACCESS_KEY ?? env.R2_SECRET_ACCESS_KEY;
  if (!account || !accessKeyId || !secretAccessKey) throw new Error("Uploading evidence needs R2_ACCOUNT_ID and an R2 access key (docs/data.md#evidence).");
  const bucket = env.OPENTAXRATE_EVIDENCE_BUCKET ?? "opentaxrate-evidence";
  const base = `https://${account}.r2.cloudflarestorage.com/${bucket}`;
  const r2 = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });

  // What the bucket already holds.
  const have = new Set<string>();
  let token: string | undefined;
  do {
    const query = new URLSearchParams({ "list-type": "2", prefix: "sha256/", "max-keys": "1000", ...(token ? { "continuation-token": token } : {}) });
    const response = await r2.fetch(`${base}?${query}`);
    if (!response.ok) throw new Error(`Listing ${bucket} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
    const xml = await response.text();
    for (const m of xml.matchAll(/<Key>sha256\/([0-9a-f]{64})<\/Key>/g)) have.add(m[1]);
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] : undefined;
  } while (token);

  const { catalog, files } = await buildCatalog();
  const wanted = new Map<string, { file: string; type: string; url: string }>();
  for (const [url, record] of Object.entries(catalog.urls))
    for (const c of record.captures) if (!have.has(c.sha256) && !wanted.has(c.sha256)) wanted.set(c.sha256, { file: files.get(c.sha256)!, type: c.type, url });

  let uploaded = 0, bytes = 0;
  const queue = [...wanted.entries()];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [sha, { file, type, url }] = next;
      const body = readFileSync(file);
      for (let attempt = 0; ; attempt++) {
        const response = await r2.fetch(`${base}/sha256/${sha}`, {
          method: "PUT",
          body,
          headers: { "content-type": type, "x-amz-meta-source-url": encodeURI(url).slice(0, 1800) },
        });
        if (response.ok) break;
        if (attempt === 2) throw new Error(`Uploading ${file} answered ${response.status}`);
        await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
      }
      uploaded++;
      bytes += statSync(file).size;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const put = await r2.fetch(`${base}/catalog.json`, {
    method: "PUT",
    body: JSON.stringify(catalog),
    headers: { "content-type": "application/json", "cache-control": "max-age=300" },
  });
  if (!put.ok) throw new Error(`Uploading the catalog answered ${put.status}`);
  return { uploaded, kept: have.size, bytes };
}
