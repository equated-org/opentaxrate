/**
 * The monthly look for news (docs/maintenance/taxability.md):
 * fetchTaxabilitySources downloads every page a rule cites and every page
 * on the watch list (rules/watch.json: each agency's notices and bulletin
 * indexes) again, files the new copies in the raw-source archive
 * (artifacts/sources, where a changed page keeps its older copy), and
 * reports what changed in their text and which cited quotes are gone.
 *
 * Pages are compared as text (pageText), so a new timestamp isn't news,
 * and fetched politely: one request a second to a host, a dropped
 * connection retried, a refusing host left alone for the run, and a
 * challenge or error page never filed over a good copy.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import tls from "node:tls";
import { copiesByUrl, downloadedBytes, sourcesRoot } from "../ingest/archive.js";
import { readRuleFiles, RULE_FILE, RULES_DIR } from "./rules/index.js";

export const WATCH_FILE = path.join(RULES_DIR, "watch.json");
const INTERMEDIATES_FILE = path.join(RULES_DIR, "intermediates.pem");

const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 OpenTaxRate";

/** A GET, retried twice when the connection drops (some agencies' servers
 *  reset one request in a few); an HTTP answer, even an error, isn't retried. */
export async function politeFetch(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, {
        headers: { "User-Agent": BROWSER, Accept: "text/html,application/pdf,*/*" },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      const code = ((error as { cause?: { code?: string } }).cause?.code ?? "") as string;
      const transient = /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|UND_ERR_SOCKET|TimeoutError/.test(code + (error as Error).name);
      if (!transient || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, [2_000, 5_000][attempt]));
    }
  }
}

/** The public evidence archive (evidence/worker.js). */
export const EVIDENCE = "https://evidence.opentaxrate.com";

/** OpenTaxRate's copy with this hash, opening at `quote`: its words, or a
 *  long one's first and last four (a text fragment browsers scroll to). */
export function evidenceLink(sha256: string, quote?: string, options: { startOnly?: boolean } = {}): string {
  // Quote marks and brackets at a term's ends are dropped: a page's curly
  // quotes don't match a quote's straight ones.
  const trim = (s: string) => s.replace(/^[\s"'“”‘’«»(\[]+|[\s"'“”‘’«»)\]]+$/g, "");
  const words = trim(quote ?? "").replace(/\s+/g, " ").split(" ").filter(Boolean);
  const enc = (s: string) => encodeURIComponent(trim(s)).replace(/-/g, "%2D");
  // A browser matches each term within one block of the page; a quote that
  // runs over a paragraph break gets its opening words only, so the link
  // still opens at it.
  // A term never holds a quote mark: browsers match punctuation exactly,
  // and a page may print the quote's straight quotes as curly ones. So each
  // end is the first (or last) run of words without one.
  const marked = (w: string) => /["'“”‘’«»]/.test(w);
  const run = (from: "start" | "end", n: number) => {
    const list = from === "start" ? words : [...words].reverse();
    let out: string[] = [];
    for (const w of list) {
      if (marked(w)) {
        if (out.length >= Math.min(3, n)) break;
        out = [];
        continue;
      }
      out.push(w);
      if (out.length === n) break;
    }
    return from === "start" ? out : out.reverse();
  };
  const plain = !words.some(marked);
  const fragment = !words.length
    ? ""
    : words.length <= 8 && plain
      ? `#:~:text=${enc(words.join(" "))}`
      : options.startOnly || words.length <= 8
        ? `#:~:text=${enc(run("start", 6).join(" "))}`
        : `#:~:text=${enc(run("start", 4).join(" "))},${enc(run("end", 4).join(" "))}`;
  return `${EVIDENCE}/sha256/${sha256}${fragment}`;
}

/** A PDF page's text as the evidence archive shows it: lines joined into
 *  paragraphs, blank lines kept as breaks (evidence/worker.js pdfPage). */
export const pdfParagraphs = (page: string) =>
  page.split(/\n\s*\n/).map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean).join(" ")).filter(Boolean);

/** A dated Wayback Machine snapshot: its contents never change, so once
 *  archived it isn't fetched again. */
export const snapshot = (url: string) => /^https?:\/\/web\.archive\.org\/web\/\d{8,14}(?:[a-z]{2}_)?\//.test(url);

/** The name a newly archived page is filed under: its own, but with an
 *  extension when its path has none, so ".../pst" can't collide with the
 *  folder ".../pst/..." its neighbours are filed in. */
export function fileName(url: string, bytes: Uint8Array): string | undefined {
  const last = decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean).at(-1);
  if (!last || /\.[a-z0-9]{2,5}$/i.test(last)) return undefined;
  return `${last}.${Buffer.from(bytes.slice(0, 5)).toString("latin1") === "%PDF-" ? "pdf" : "html"}`;
}

/** The name a page is filed under from a local copy: always the URL's,
 *  never the downloaded file's ("page.htm"), so two pages in one folder
 *  can't take each other's place. */
export const fileNameFor = (url: string, bytes: Uint8Array): string =>
  fileName(url, bytes) ?? (decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean).at(-1) || "index.html");

/** A page to watch for news, and the CSV columns whose values change on
 *  their own (a "days since" counter) and so don't count as a change. */
interface Watched {
  url: string;
  ignoreColumns?: string[];
}

/** Trusts, for this process, the CA intermediates some agencies' servers
 *  leave out of their chains (rules/intermediates.pem, each one
 *  issued by a root Node already trusts), so their pages can be fetched
 *  without turning certificate checks off. */
export function trustListedIntermediates() {
  let pem: string;
  try {
    pem = readFileSync(INTERMEDIATES_FILE, "utf8");
  } catch {
    return;
  }
  const certificates = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (certificates.length) tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...certificates]);
}

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", sect: "§", para: "¶", copy: "©", reg: "®", deg: "°",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", bull: "•",
  frac12: "½", frac14: "¼", frac34: "¾", times: "×", cent: "¢", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â",
  ccedil: "ç", ocirc: "ô", icirc: "î", ucirc: "û", ugrave: "ù", Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç",
};

/** HTML character references decoded in one pass, so "&amp;sect;" stays
 *  "&sect;"; an unknown name is left as written. */
const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, ref: string) => {
    if (ref[0] !== "#") return NAMED[ref] ?? whole;
    const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    if (code >= 0x80 && code <= 0x9f) return WINDOWS_1252.decode(new Uint8Array([code])); // as browsers read &#146; (HTML's rule)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

const UTF8 = new TextDecoder("utf-8", { fatal: true });
const WINDOWS_1252 = new TextDecoder("windows-1252");

/** The length of the UTF-8 sequence starting at `i`, or 0 when the bytes
 *  there aren't one. */
function utf8Sequence(bytes: Uint8Array, i: number): number {
  const b = bytes[i];
  if (b < 0x80) return 1;
  const next = (k: number, lo = 0x80, hi = 0xbf) => i + k < bytes.length && bytes[i + k] >= lo && bytes[i + k] <= hi;
  if (b >= 0xc2 && b <= 0xdf) return next(1) ? 2 : 0;
  if (b >= 0xe0 && b <= 0xef) return next(1, b === 0xe0 ? 0xa0 : 0x80, b === 0xed ? 0x9f : 0xbf) && next(2) ? 3 : 0;
  if (b >= 0xf0 && b <= 0xf4) return next(1, b === 0xf0 ? 0x90 : 0x80, b === 0xf4 ? 0x8f : 0xbf) && next(2) && next(3) ? 4 : 0;
  return 0;
}

/** The single-byte encoding a page declares (<meta charset>, its
 *  http-equiv content, an XML declaration), when the decoder knows it and it
 *  isn't UTF-8. */
function declaredSingleByte(bytes: Uint8Array): TextDecoder | undefined {
  const head = Buffer.from(bytes.subarray(0, 4096)).toString("latin1");
  const label = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1] ?? /<\?xml[^>]+encoding\s*=\s*["']([\w.:-]+)/i.exec(head)?.[1];
  if (!label || /^utf-?(8|16)/i.test(label)) return undefined;
  try {
    const decoder = new TextDecoder(label);
    return /^(windows-125\d|iso-8859-\d+|koi8|macintosh|ibm866)/.test(decoder.encoding) ? decoder : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the bytes look like UTF-16 with no byte-order mark (a Word page
 *  saved as HTML): most of the first bytes' odd (LE) or even (BE) positions
 *  are NUL. */
function utf16WithoutMark(bytes: Uint8Array): "utf-16le" | "utf-16be" | undefined {
  const n = Math.min(bytes.length, 4096) & ~1;
  if (n < 16) return undefined;
  let odd = 0, even = 0;
  for (let i = 0; i < n; i += 2) {
    if (bytes[i] === 0) even++;
    if (bytes[i + 1] === 0) odd++;
  }
  const half = n / 2;
  if (odd > half * 0.6 && even < half * 0.05) return "utf-16le";
  if (even > half * 0.6 && odd < half * 0.05) return "utf-16be";
  return undefined;
}

/** A page's bytes as text, in the encoding they're in: a byte-order mark's
 *  (UTF-8, UTF-16), UTF-16 without one, else UTF-8; a byte that isn't part
 *  of valid UTF-8 (a windows-1252 page's curly quote or bullet) is read in
 *  the page's declared single-byte encoding, else windows-1252, so no
 *  U+FFFD stands in for it. Valid UTF-8 is always read as UTF-8. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  else {
    const wide = utf16WithoutMark(bytes);
    if (wide) return new TextDecoder(wide).decode(bytes);
  }
  try {
    return UTF8.decode(bytes);
  } catch {
    // Not all UTF-8: read what is, and each byte that isn't, one at a time.
  }
  const single = declaredSingleByte(bytes) ?? WINDOWS_1252;
  const valid = new TextDecoder("utf-8");
  let out = "", start = 0;
  for (let i = 0; i < bytes.length; ) {
    const length = utf8Sequence(bytes, i);
    if (length) {
      i += length;
      continue;
    }
    out += valid.decode(bytes.subarray(start, i)) + single.decode(bytes.subarray(i, i + 1));
    start = ++i;
  }
  return out + valid.decode(bytes.subarray(start));
}

/** An OLE2 compound file (a Word 97–2003 .doc, an old .xls): D0 CF 11 E0. */
const isCompoundFile = (bytes: Uint8Array) => bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;

const installed = new Map<string, boolean>();
/** Whether a command is on the PATH (`which`), asked once. */
function has(command: string) {
  if (!installed.has(command)) {
    try {
      execFileSync("which", [command], { stdio: "ignore" });
      installed.set(command, true);
    } catch {
      installed.set(command, false);
    }
  }
  return installed.get(command)!;
}

/** The text of a Word .doc: antiword's, else catdoc's, where installed;
 *  else read straight from the file, as `strings` would but in Word's own
 *  encodings: every run of four or more windows-1252 text bytes (Word keeps
 *  most text so, paragraphs ending in a carriage return) and of UTF-16LE
 *  text, in file order. The fallback carries some of the file's own names
 *  (styles, fonts) as lines of their own; a quote is still found whole. */
export function wordText(bytes: Uint8Array): string {
  for (const [command, args] of [["antiword", ["-w", "0"]], ["catdoc", ["-w"]]] as const) {
    if (!has(command)) continue;
    const dir = mkdtempSync(path.join(tmpdir(), "otr-doc-"));
    try {
      writeFileSync(path.join(dir, "doc.doc"), bytes);
      const out = execFileSync(command, [...args, path.join(dir, "doc.doc")], { maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
      if (out.trim()) return out;
    } catch {
      // Not a Word file this tool reads: try the next, then the fallback.
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const runs: string[] = [];
  // windows-1252 text: printable bytes, the five it leaves undefined aside;
  // Word's paragraph, line and cell marks (CR, VT, BEL) end a line.
  const text8 = (b: number) => (b >= 0x20 && b !== 0x7f && b !== 0x81 && b !== 0x8d && b !== 0x8f && b !== 0x90 && b !== 0x9d) || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0b || b === 0x07;
  for (let i = 0; i < bytes.length; ) {
    let j = i;
    while (j < bytes.length && text8(bytes[j])) j++;
    // Four bytes or more, with a word in them (not the file's 0xFF filler).
    const run = j - i >= 4 ? WINDOWS_1252.decode(bytes.subarray(i, j)) : "";
    if (/[A-Za-z0-9]{3}/.test(run)) runs.push(run.replace(/[\r\v\x07]/g, "\n"));
    i = j + 1;
  }
  // UTF-16LE text: Latin letters and Word's curly quotes and dashes, two
  // bytes each (8-bit text read two bytes at a time is neither).
  const text16 = (i: number) => {
    const unit = bytes[i] | (bytes[i + 1] << 8);
    return (unit >= 0x20 && unit < 0x250 && unit !== 0x7f && !(unit >= 0x80 && unit < 0xa0)) || (unit >= 0x2010 && unit <= 0x2027) || unit === 0x0d || unit === 0x0a || unit === 0x09;
  };
  for (let i = 0; i + 1 < bytes.length; ) {
    let j = i;
    while (j + 1 < bytes.length && text16(j)) j += 2;
    if (j - i >= 8) runs.push(new TextDecoder("utf-16le").decode(bytes.subarray(i, j)).replace(/\r/g, "\n"));
    i = j > i ? j : i + 1;
  }
  return runs.join("\n");
}

/** One CSV line's fields, quotes honoured. */
function csvFields(line: string): string[] {
  const fields: string[] = [];
  let field = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") fields.push(field), (field = "");
    else field += c;
  }
  return [...fields, field];
}

/** A page's readable text, for telling a real change from a new timestamp:
 *  a PDF through pdftotext, a Word .doc through wordText, HTML without
 *  scripts, styles and tags, one line per block, any text in its own
 *  encoding (decodeText); null when it can't be read. */
export function pageText(bytes: Uint8Array, options: { ignoreColumns?: string[] } = {}): string | null {
  const head = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  if (head === "%PDF-") {
    const dir = mkdtempSync(path.join(tmpdir(), "otr-page-"));
    try {
      writeFileSync(path.join(dir, "page.pdf"), bytes);
      // Reading order, not the page's layout: a two-column page laid out
      // side by side splits every sentence across its columns.
      return execFileSync("pdftotext", [path.join(dir, "page.pdf"), "-"], { maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
    } catch {
      return null;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // A Word .doc (Florida's rules): its text, never its binary.
  if (isCompoundFile(bytes)) return wordText(bytes);
  const text = decodeText(bytes);
  if (options.ignoreColumns?.length) {
    const [header, ...rows] = text.split(/\r?\n/);
    const names = csvFields(header);
    const keep = names.map((name, i) => (options.ignoreColumns!.includes(name) ? -1 : i)).filter((i) => i >= 0);
    return [header, ...rows].filter(Boolean).map((line) => keep.map((i) => csvFields(line)[i] ?? "").join(",")).join("\n");
  }
  if (!/<html|<body|<div|<p[ >]/i.test(text)) return text;
  return decodeEntities(
    text
      .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|tr|h\d|td|th|section|article|dd|dt)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** For finding a quote in a page: case, spacing, curly quotes and dashes
 *  don't count. */
const loose = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    // A tag between a word and its punctuation ("HST</abbr>)") leaves a space.
    .replace(/ ([,.;:)\]])/g, "$1")
    .replace(/([(\[]) /g, "$1")
    .trim();

/** Hyphens left out: pdftotext drops the hyphen a word or number broke at
 *  the end of a line ("39-26-\n717" reads "39-26717", "short-\nterm"
 *  "shortterm"), so the page and the quote are compared without any. */
const unhyphenated = (looseText: string) => looseText.replace(/-/g, "").replace(/ {2,}/g, " ");

/** Whether `quote` is on a page whose text is `text`, as pageText reads it;
 *  failing that, whether it is once hyphens are left out on both sides (a
 *  line-end hyphen extraction dropped). Nothing else is loosened. */
export const quoteOnPage = (text: string, quote: string) => {
  const page = loose(text), wanted = loose(quote);
  if (page.includes(wanted)) return true;
  const bare = unhyphenated(wanted).trim();
  return bare.length > 0 && unhyphenated(page).includes(bare);
};

/** A host that answered with a challenge, not the page. */
export const challenged = (text: string) => /just a moment\.\.\.|cf-chl|enable javascript and cookies to continue|access denied/i.test(text.slice(0, 4000));

export interface SourceCheck {
  url: string;
  /** Watch-list page, cited page, or both. */
  role: Array<"watched" | "cited">;
  status: "new" | "unchanged" | "changed" | "blocked" | "failed" | "unreadable";
  /** Lines in the new text that weren't in the archived one; at most 30. */
  added?: string[];
  /** Cited quotes not found in the page as fetched now, with their rules. */
  quotesMissing?: Array<{ rule: string; quote: string }>;
  note?: string;
}

/**
 * Downloads every page a rule cites and every watch-list page again, files
 * each in the archive (a changed page keeps its older copy in previous/),
 * and says what changed in its text and which cited quotes are no longer
 * on it. A challenge or error page is never filed over a good copy.
 */
export async function fetchTaxabilitySources(options: { dir?: string; watchFile?: string } = {}): Promise<SourceCheck[]> {
  const { rules } = readRuleFiles(options.dir);
  const watch = JSON.parse(readFileSync(options.watchFile ?? WATCH_FILE, "utf8")) as Watched[];
  const ignoreColumns = new Map(watch.filter((w) => w.ignoreColumns).map((w) => [w.url, w.ignoreColumns!]));
  trustListedIntermediates();
  // The quotes each page should still show: those of rules in force today
  // (an ended rule may quote an edition since replaced).
  const today = new Date().toISOString().slice(0, 10);
  const quotes = new Map<string, Array<{ rule: string; quote: string }>>();
  for (const r of rules)
    for (const c of r.citations)
      quotes.set(c.url, [...(quotes.get(c.url) ?? []), ...(c.quote && (!r.to || r.to >= today) ? [{ rule: `${r.file} ${r.tax} ${r.code} ${r.from}`, quote: c.quote }] : [])]);
  const watched = new Set(watch.map((w) => w.url));
  const urls = [...new Set([...watched, ...quotes.keys()])].sort();
  const copies = copiesByUrl();
  const root = sourcesRoot();
  const lastAsked = new Map<string, number>();
  const blocked = new Set<string>();
  const checks: SourceCheck[] = [];
  for (const url of urls) {
    const role: SourceCheck["role"] = [...(watched.has(url) ? ["watched" as const] : []), ...(quotes.has(url) ? ["cited" as const] : [])];
    const host = new URL(url).host;
    if (blocked.has(host)) {
      checks.push({ url, role, status: "blocked", note: "host refused an earlier page this run" });
      continue;
    }
    const wait = (lastAsked.get(host) ?? 0) + 1_000 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastAsked.set(host, Date.now());
    // The newest copy, from a fetch or an Internet Archive capture.
    const before = copies.get(url)?.at(-1);
    const reading = { ignoreColumns: ignoreColumns.get(url) };
    const oldText = before ? pageText(new Uint8Array(readFileSync(path.join(root, before.file))), reading) : null;
    if (before && snapshot(url)) {
      const missing = (quotes.get(url) ?? []).filter((q) => oldText !== null && !quoteOnPage(oldText, q.quote));
      checks.push({ url, role, status: "unchanged", note: "a dated archive snapshot: read from the archive, not fetched", ...(missing.length ? { quotesMissing: missing } : {}) });
      continue;
    }
    let bytes: Uint8Array;
    try {
      const response = await politeFetch(url);
      if (response.status === 403 || response.status === 429) {
        blocked.add(host);
        checks.push({ url, role, status: "blocked", note: `answered ${response.status}` });
        continue;
      }
      if (!response.ok) {
        checks.push({ url, role, status: "failed", note: `answered ${response.status}` });
        continue;
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      checks.push({ url, role, status: "failed", note: (error as Error).message });
      continue;
    }
    const text = pageText(bytes, reading);
    // Text that can't be read can't be checked for its quotes, or told
    // from an error page: kept out of the archive, for a person to look at.
    if (text === null) {
      checks.push({ url, role, status: "unreadable", note: "fetched, but its text couldn't be read; the archived copy is kept" });
      continue;
    }
    if (challenged(text)) {
      blocked.add(host);
      checks.push({ url, role, status: "blocked", note: "answered with a challenge page; the archived copy is kept" });
      continue;
    }
    try {
      await downloadedBytes(url, new Response(Buffer.from(bytes)), before ? path.basename(before.file) : fileName(url, bytes));
    } catch (error) {
      checks.push({ url, role, status: "failed", note: `fetched, but couldn't be filed: ${(error as Error).message}` });
      continue;
    }
    const check: SourceCheck = { url, role, status: !before ? "new" : oldText === text ? "unchanged" : "changed" };
    if (check.status === "changed" && oldText !== null) {
      const had = new Set(oldText.split("\n"));
      check.added = text.split("\n").filter((line) => !had.has(line)).slice(0, 30);
    }
    const missing = (quotes.get(url) ?? []).filter((q) => !quoteOnPage(text, q.quote));
    if (missing.length) check.quotesMissing = missing;
    checks.push(check);
  }
  return checks;
}

/** The fetch's findings as a person reads them. */
export function describeSourceChecks(checks: SourceCheck[]): string {
  const count = (s: SourceCheck["status"]) => checks.filter((c) => c.status === s).length;
  const lines = [
    `${checks.length} pages: ${count("changed")} changed, ${count("new")} new, ${count("unchanged")} unchanged, ${count("blocked")} blocked, ${count("failed")} failed, ${count("unreadable")} unreadable; ${checks.filter((c) => c.quotesMissing).length} no longer show a cited quote.`,
  ];
  for (const c of checks.filter((c) => c.status === "changed" || c.status === "new")) {
    lines.push("", `${c.status.toUpperCase()} (${c.role.join(", ")}) ${c.url}`);
    for (const a of c.added ?? []) lines.push(`  + ${a.slice(0, 200)}`);
  }
  for (const c of checks.filter((c) => c.quotesMissing)) {
    lines.push("", `QUOTE GONE ${c.url}`);
    for (const q of c.quotesMissing!) lines.push(`  ${q.rule}: "${q.quote.slice(0, 160)}"`);
  }
  for (const c of checks.filter((c) => c.status === "blocked" || c.status === "failed" || c.status === "unreadable")) lines.push(`${c.status.toUpperCase()} ${c.url} (${c.note})`);
  return lines.join("\n") + "\n";
}

/**
 * The rules added or changed since `ref` (a git revision), each checked
 * the way a reviewer would: every citation quotes its page, the page is in
 * the archive, and the quote is on it. What an unattended run must pass
 * before a rule change goes to main (docs/maintenance/taxability.md);
 * an empty list of problems means it may.
 */
export function verifyChangedRules(ref: string, dir = RULES_DIR): { changed: string[]; removed: string[]; problems: string[] } {
  const key = (r: { tax: string; code: string; from: string }) => `${r.tax} ${r.code} ${r.from}`;
  const before = new Map<string, string>();
  // A ref that can't be read is an error, not "every rule is new": that
  // would pass with no removal reported.
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  try {
    git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
  } catch {
    throw new Error(`${ref} isn't a commit this repository has.`);
  }
  // ref:path reads from the repository's root, wherever this runs.
  const relative = path.relative(git("rev-parse", "--show-toplevel").trim(), RULES_DIR);
  let listed = "";
  try {
    listed = git("ls-tree", "--name-only", `${ref}:${relative}`);
  } catch {
    // The folder isn't at ref (before the rules moved here): every rule is new.
  }
  for (const file of listed.split("\n").filter((f) => RULE_FILE.test(f)))
    for (const r of JSON.parse(git("show", `${ref}:${relative}/${file}`)) as Array<{ tax: string; code: string; from: string }>)
      before.set(key(r), canonical(r));
  const { rules } = readRuleFiles(dir);
  const copies = copiesByUrl();
  const root = sourcesRoot();
  const changed: string[] = [];
  const problems: string[] = [];
  // Many rules cite one page: read each once.
  const texts = new Map<string, string | null>();
  const textOf = (file: string) => {
    if (!texts.has(file)) texts.set(file, pageText(new Uint8Array(readFileSync(path.join(root, file)))));
    return texts.get(file)!;
  };
  for (const r of rules) {
    const { file, ...rule } = r;
    if (before.get(key(rule)) === canonical(rule)) continue;
    changed.push(`${file}: ${key(rule)}`);
    for (const c of rule.citations) {
      const where = `${file}: ${key(rule)}: ${c.url}`;
      if (!c.quote) {
        problems.push(`${where}: no quote`);
        continue;
      }
      // Any copy of the page: an older edition quoted for an older rule is
      // a copy captured then (often through the Internet Archive).
      const held = copies.get(c.url) ?? [];
      if (!held.length) {
        problems.push(`${where}: the page isn't archived (run ingest --kind taxability, which files it)`);
        continue;
      }
      if (!held.some((copy) => { const text = textOf(copy.file); return text !== null && quoteOnPage(text, c.quote!); }))
        problems.push(`${where}: the quote isn't on any archived copy of the page`);
    }
  }
  // A rule taken away changes answers too (its tax falls back to a broader
  // rule, or to not researched): it's reported, for a person to approve.
  const now = new Set(rules.map((r) => key(r)));
  const removed = [...before.keys()].filter((k) => !now.has(k));
  return { changed, removed, problems };
}

/** A rule as text with its keys sorted, so key order isn't a change. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v));
