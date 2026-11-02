/**
 * The public evidence archive: every file in artifacts/sources (each
 * download refresh and taxability ingest filed, older versions included),
 * mirrored unchanged to an R2 bucket under its SHA-256, and a catalog of
 * which URL each copy was fetched from, when, and which rules cite it.
 * evidence/worker.js serves it at evidence.opentaxrate.com.
 *
 *   sha256/<hash>    the original bytes, named by their hash; never rewritten
 *   text/<hash>.json a document's text: a PDF's page by page (src/pdf-text.ts),
 *                    in reading order and as laid out, a Word document's or a
 *                    web page's as the quote checks read it, with marks where
 *                    each cited quote is (src/evidence-text.ts) and a cited
 *                    web page's main content lines (src/evidence-crop.ts); a
 *                    scan's machine transcription (.machine.json) and table
 *                    pages as Markdown (.formatted.json) beside it where
 *                    made: derived, never evidence
 *   catalog.json     { urls: { <url>: { captures: [{ at, sha256, bytes, type, bad? }], citedBy: [{ rule, quote }] } } }
 *
 * A POSTed query's answer is filed under "<url> (POST <first 12 of the
 * body's sha256>)", hashed over the whole body (an empty body too; a
 * bodyless POST is "<url> (POST)"): the manifest's own copy is cut at 2,000
 * characters, so a long body is taken from the line's bodySha256, or read
 * back from the query folder's url.txt when it is that request's
 * (catalogKey). A capture listed
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
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { AwsClient } from "aws4fetch";
import { captureRuns, holding, manifestEntries, sourceHashes, sourcesRoot, waybackCapture, type ManifestEntry } from "./ingest/archive.js";
import { readRuleFiles } from "./taxability/rules/index.js";
import { textDir } from "./pdf-text.js";
import { updateEvidenceTexts } from "./evidence-text.js";
import { cropPages } from "./evidence-crop.js";

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

/** A file's type from its name, else from its first bytes; a PDF by its
 *  bytes whatever its name, and a Word file named like a page
 *  (".../readfile.aspx?Format=WORD") by its bytes too. */
export function typeOf(file: string, head: Buffer): string {
  const start = head.toString("latin1", 0, 512).trimStart().toLowerCase();
  const compound = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (start.startsWith("%pdf-")) return "application/pdf";
  for (const [pattern, type] of TYPES) if (pattern.test(file)) return compound && type.startsWith("text/html") ? "application/msword" : type;
  if (compound) return "application/msword";
  if (start.startsWith("<!doctype html") || start.startsWith("<html") || start.includes("<head")) return "text/html; charset=utf-8";
  if (start.startsWith("{") || start.startsWith("[")) return "application/json";
  return "application/octet-stream";
}

/** What a manifest line says of its request's body: none (a GET, or a
 *  bodyless POST), its whole body's SHA-256, or cut short with no way to
 *  know the rest (a line from before bodySha256 whose url.txt is missing or
 *  isn't this request's). */
export type RequestBody = { kind: "none" } | { kind: "whole"; sha256: string; from: "line" | "body" | "url.txt" } | { kind: "cut"; why: string };

/** A request's body, from its manifest line: the line's bodySha256; else a
 *  body under 2,000 characters, which is whole (an empty body too, told
 *  from no body); else the body url.txt kept beside the answer
 *  ("<METHOD> <url>\n<body>\n"), taken only when it is this request's: the
 *  same method and URL, starting with the line's prefix, and hashing to the
 *  query folder's id (sourcePath's: the folder is named by the whole
 *  request). */
export function requestBody(entry: ManifestEntry, root: string): RequestBody {
  if (entry.body === undefined) return { kind: "none" };
  if (entry.bodySha256) return { kind: "whole", sha256: entry.bodySha256, from: "line" };
  if (entry.body.length < 2000) return { kind: "whole", sha256: createHash("sha256").update(entry.body).digest("hex"), from: "body" };
  const method = entry.method ?? "POST";
  const full = sidecarBody(entry, root);
  if (full === null) return { kind: "cut", why: "no url.txt beside it" };
  if (full === undefined) return { kind: "cut", why: `url.txt isn't ${method} ${entry.url}` };
  if (!full.startsWith(entry.body)) return { kind: "cut", why: "url.txt's body doesn't start with the line's" };
  const folder = path.basename(path.dirname(entry.file));
  if (/^[0-9a-f]{16}$/.test(folder)) {
    const id = createHash("sha256").update(`${new URL(entry.url).search}\n${method}\n${full}`).digest("hex").slice(0, 16);
    if (id !== folder) return { kind: "cut", why: `url.txt's body isn't the one its folder (${folder}) was named for` };
  }
  return { kind: "whole", sha256: createHash("sha256").update(full).digest("hex"), from: "url.txt" };
}

/** The body in the url.txt beside an entry's file: null when there's none,
 *  undefined when it names another request. */
export function sidecarBody(entry: ManifestEntry, root: string): string | null | undefined {
  let text: string;
  try {
    text = readFileSync(path.join(root, path.dirname(entry.file), "url.txt"), "utf8");
  } catch {
    return null;
  }
  const newline = text.indexOf("\n");
  if (text.slice(0, newline) !== `${entry.method ?? "POST"} ${entry.url}`) return undefined;
  return text.slice(newline + 1).replace(/\n$/, "");
}

/** The SHA-256 of a POST's whole body (requestBody), or undefined. */
export function requestBodySha256(entry: ManifestEntry, root: string): string | undefined {
  const body = requestBody(entry, root);
  return body.kind === "whole" ? body.sha256 : undefined;
}

/** The catalog entry a manifest line's answer is filed under: the URL for
 *  a GET; "<url> (<METHOD>)" for a request with no body that isn't a GET;
 *  "<url> (<METHOD> <first 12 of the whole body's sha256>)" for one with a
 *  body, an empty body included; and for a body cut short with no whole
 *  copy, never another request's: "<url> (<METHOD>, whole body not kept:
 *  answer <first 12 of the answer's sha256>)". */
export function catalogKey(entry: ManifestEntry, root: string): string {
  const method = entry.method ?? (entry.body === undefined ? "GET" : "POST");
  const body = requestBody(entry, root);
  if (body.kind === "none") return method === "GET" ? entry.url : `${entry.url} (${method})`;
  if (body.kind === "whole") return `${entry.url} (${method} ${body.sha256.slice(0, 12)})`;
  return `${entry.url} (${method}, whole body not kept: answer ${entry.sha256.slice(0, 12)})`;
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
 *  are still here, found by hash wherever they are) and the rules that cite
 *  it; a URL's captures ordered and deduplicated as copiesByUrl's
 *  (captureRuns), each with its file's real size. */
export async function buildCatalog(): Promise<{ catalog: Catalog; files: Map<string, string> }> {
  const root = sourcesRoot();
  const hashes = sourceHashes(root);
  const files = new Map<string, string>();
  const bad = knownBad(root);
  const observed = new Map<string, Capture[]>();
  const observe = (key: string, capture: Capture) => {
    const list = observed.get(key);
    if (list) list.push(capture);
    else observed.set(key, [capture]);
  };
  for (const entry of manifestEntries(root)) {
    const held = holding(entry, hashes);
    if (!held) continue;
    const file = path.join(root, held);
    if (!files.has(entry.sha256)) files.set(entry.sha256, file);
    const head = Buffer.alloc(512);
    const fd = openSync(file, "r");
    readSync(fd, head, 0, 512, 0);
    closeSync(fd);
    // An API's answer to one posted query isn't a version of a page: each
    // query is its own entry, keyed by the request (catalogKey).
    const key = catalogKey(entry, root);
    const marked = bad.get(entry.sha256);
    // A file named .zip or .pdf that is an HTML error page is typed by its bytes.
    const type = marked ? typeOf("", head) : typeOf(entry.file, head);
    const capture: Capture = { at: entry.at, sha256: entry.sha256, bytes: hashes.sizeOf.get(held)!, type, ...(marked ? { bad: marked } : {}) };
    observe(key, capture);
    // An Internet Archive capture is also a copy of the page it captured,
    // on the day it was captured: citations name the original page.
    const archived = waybackCapture(entry.url);
    if (archived) observe(archived.original, { ...capture, at: archived.at, via: entry.url });
  }
  const urls: Catalog["urls"] = {};
  for (const [key, captures] of observed) urls[key] = { captures: captureRuns(captures), citedBy: [] };
  for (const r of readRuleFiles().rules)
    for (const c of r.citations) {
      const record = urls[c.url];
      if (record) record.citedBy.push({ rule: `${r.tax} ${r.code} from ${r.from}${r.to ? ` to ${r.to}` : ""}`, tax: r.tax, code: r.code, from: r.from, ...(r.to ? { to: r.to } : {}), ...(c.quote ? { quote: c.quote } : {}) });
    }
  return { catalog: { generatedAt: new Date().toISOString(), urls }, files };
}

/** The hashes an S3 listing names under sha256/ or text/ ("sha256/<hash>",
 *  "text/<hash>.json"). */
export function listedHashes(xml: string): string[] {
  return [...xml.matchAll(/<Key>[a-z0-9]+\/([0-9a-f]{64})(?:\.json)?<\/Key>/g)].map((m) => m[1]);
}

/** An S3 listing's keys, each with its ETag (an object's MD5, unquoted). */
export function listedKeys(xml: string): Map<string, string> {
  const keys = new Map<string, string>();
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const key = m[1].match(/<Key>([^<]+)<\/Key>/)?.[1];
    const etag = m[1].match(/<ETag>(?:&quot;|")?([0-9a-f]+)(?:&quot;|")?<\/ETag>/)?.[1];
    if (key) keys.set(key, etag ?? "");
  }
  return keys;
}

/** The token for an S3 listing's next page, when it was cut short. */
const nextToken = (xml: string) => (/<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1] : undefined);

/** Uploads every copy the bucket lacks, then the catalog. */
export async function uploadEvidence(env: NodeJS.ProcessEnv = process.env): Promise<{ uploaded: number; kept: number; bytes: number; texts: number; marks: number; crops?: Awaited<ReturnType<typeof cropPages>> }> {
  const account = env.R2_ACCOUNT_ID;
  const accessKeyId = env.OPENTAXRATE_R2_ACCESS_KEY_ID ?? env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.OPENTAXRATE_R2_SECRET_ACCESS_KEY ?? env.R2_SECRET_ACCESS_KEY;
  if (!account || !accessKeyId || !secretAccessKey) throw new Error("Uploading evidence needs R2_ACCOUNT_ID and an R2 access key (docs/data.md#evidence).");
  const bucket = env.OPENTAXRATE_EVIDENCE_BUCKET ?? "opentaxrate-evidence";
  const base = `https://${account}.r2.cloudflarestorage.com/${bucket}`;
  const r2 = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" });

  // Every page of the bucket's listing under a prefix.
  const listing = async function* (prefix: string) {
    let token: string | undefined;
    do {
      const query = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000", ...(token ? { "continuation-token": token } : {}) });
      const response = await r2.fetch(`${base}?${query}`);
      if (!response.ok) throw new Error(`Listing ${bucket} answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
      const xml = await response.text();
      yield xml;
      token = nextToken(xml);
    } while (token);
  };
  // What the bucket already holds, by hash.
  const have = new Set<string>();
  for await (const xml of listing("sha256/")) for (const h of listedHashes(xml)) have.add(h);
  // The texts the bucket holds, by key, with each one's ETag (the MD5 of its
  // bytes): a text made again (the layout view added) is sent again.
  const haveText = new Map<string, string>();
  for await (const xml of listing("text/")) for (const [key, etag] of listedKeys(xml)) haveText.set(key, etag);

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

  // Every document's text (a web page's, a PDF's, a Word document's), with
  // the marks that say where each cited quote is in it, for the archive's
  // text views (src/evidence-text.ts); a cited web page's main content
  // picked out by a model, when there's a key (src/evidence-crop.ts); and
  // beside them the machine-made readings (a scan's transcription, table
  // pages as Markdown) where they've been made: never evidence, and
  // labelled so.
  const { texts: records, marks } = updateEvidenceTexts(catalog, files);
  let crops: Awaited<ReturnType<typeof cropPages>> | undefined;
  if (env.OPENROUTER_API_KEY) {
    const cited = [...records.values()].filter((r) => r.kind === "html" && r.marks?.length);
    crops = await cropPages(cited, { key: env.OPENROUTER_API_KEY, budget: Number(env.OPENTAXRATE_CROP_BUDGET ?? 1) });
  }
  let texts = 0;
  const textQueue = [...records.keys()];
  const textWorker = async () => {
    for (let sha = textQueue.shift(); sha; sha = textQueue.shift()) {
      for (const name of [`${sha}.json`, `${sha}.machine.json`, `${sha}.formatted.json`]) {
        const local = path.join(textDir(), name);
        if (!existsSync(local)) continue;
        const body = readFileSync(local);
        if (haveText.get(`text/${name}`) === createHash("md5").update(body).digest("hex")) continue;
        for (let attempt = 0; ; attempt++) {
          // Not immutable: a text is made again when a view, mark or crop is added.
          const response = await r2.fetch(`${base}/text/${name}`, { method: "PUT", body, headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
          if (response.ok) break;
          if (attempt === 2) throw new Error(`Uploading text/${name} answered ${response.status}`);
          await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
        }
        texts++;
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, textWorker));

  const put = await r2.fetch(`${base}/catalog.json`, {
    method: "PUT",
    body: JSON.stringify(catalog),
    headers: { "content-type": "application/json", "cache-control": "max-age=300" },
  });
  if (!put.ok) throw new Error(`Uploading the catalog answered ${put.status}`);
  return { uploaded, kept: have.size, bytes, texts, marks, ...(crops ? { crops } : {}) };
}
