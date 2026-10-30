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
import { archivedByUrl, downloadedBytes, sourcesRoot } from "../ingest/archive.js";
import { readRuleFiles, RULES_DIR } from "./rules/index.js";

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

/** A dated Wayback Machine snapshot: its contents never change, so once
 *  archived it isn't fetched again. */
export const snapshot = (url: string) => /^https?:\/\/web\.archive\.org\/web\/\d{8,14}\//.test(url);

/** The name a newly archived page is filed under: its own, but with an
 *  extension when its path has none, so ".../pst" can't collide with the
 *  folder ".../pst/..." its neighbours are filed in. */
export function fileName(url: string, bytes: Uint8Array): string | undefined {
  const last = decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean).at(-1);
  if (!last || /\.[a-z0-9]{2,5}$/i.test(last)) return undefined;
  return `${last}.${Buffer.from(bytes.slice(0, 5)).toString("latin1") === "%PDF-" ? "pdf" : "html"}`;
}

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
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });

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
 *  a PDF through pdftotext, HTML without scripts, styles and tags, one
 *  line per block; null when it can't be read. */
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
  const text = Buffer.from(bytes).toString("utf8");
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

/** Whether `quote` is on a page whose text is `text`, as pageText reads it. */
export const quoteOnPage = (text: string, quote: string) => loose(text).includes(loose(quote));

/** A host that answered with a challenge, not the page. */
const challenged = (text: string) => /just a moment\.\.\.|cf-chl|enable javascript and cookies to continue|access denied/i.test(text.slice(0, 4000));

export interface SourceCheck {
  url: string;
  /** Watch-list page, cited page, or both. */
  role: Array<"watched" | "cited">;
  status: "new" | "unchanged" | "changed" | "blocked" | "failed";
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
  const quotes = new Map<string, Array<{ rule: string; quote: string }>>();
  for (const r of rules)
    for (const c of r.citations)
      quotes.set(c.url, [...(quotes.get(c.url) ?? []), ...(c.quote ? [{ rule: `${r.file} ${r.tax} ${r.code} ${r.from}`, quote: c.quote }] : [])]);
  const watched = new Set(watch.map((w) => w.url));
  const urls = [...new Set([...watched, ...quotes.keys()])].sort();
  const archived = archivedByUrl();
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
    const before = archived.get(url);
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
    if (text !== null && challenged(text)) {
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
    if (check.status === "changed" && oldText !== null && text !== null) {
      const had = new Set(oldText.split("\n"));
      check.added = text.split("\n").filter((line) => !had.has(line)).slice(0, 30);
    }
    const missing = (quotes.get(url) ?? []).filter((q) => text !== null && !quoteOnPage(text, q.quote));
    if (missing.length) check.quotesMissing = missing;
    checks.push(check);
  }
  return checks;
}

/** The fetch's findings as a person reads them. */
export function describeSourceChecks(checks: SourceCheck[]): string {
  const count = (s: SourceCheck["status"]) => checks.filter((c) => c.status === s).length;
  const lines = [
    `${checks.length} pages: ${count("changed")} changed, ${count("new")} new, ${count("unchanged")} unchanged, ${count("blocked")} blocked, ${count("failed")} failed; ${checks.filter((c) => c.quotesMissing).length} no longer show a cited quote.`,
  ];
  for (const c of checks.filter((c) => c.status === "changed" || c.status === "new")) {
    lines.push("", `${c.status.toUpperCase()} (${c.role.join(", ")}) ${c.url}`);
    for (const a of c.added ?? []) lines.push(`  + ${a.slice(0, 200)}`);
  }
  for (const c of checks.filter((c) => c.quotesMissing)) {
    lines.push("", `QUOTE GONE ${c.url}`);
    for (const q of c.quotesMissing!) lines.push(`  ${q.rule}: "${q.quote.slice(0, 160)}"`);
  }
  for (const c of checks.filter((c) => c.status === "blocked" || c.status === "failed")) lines.push(`${c.status.toUpperCase()} ${c.url} (${c.note})`);
  return lines.join("\n") + "\n";
}

/**
 * The rules added or changed since `ref` (a git revision), each checked
 * the way a reviewer would: every citation quotes its page, the page is in
 * the archive, and the quote is on it. What an unattended run must pass
 * before a rule change goes to main (docs/maintenance/taxability.md);
 * an empty list of problems means it may.
 */
export function verifyChangedRules(ref: string): { changed: string[]; problems: string[] } {
  const key = (r: { tax: string; code: string; from: string }) => `${r.tax} ${r.code} ${r.from}`;
  const before = new Map<string, string>();
  const relative = path.relative(process.cwd(), RULES_DIR);
  let listed = "";
  try {
    listed = execFileSync("git", ["ls-tree", "--name-only", `${ref}:${relative}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // The folder isn't at ref: every rule is new.
  }
  for (const file of listed.split("\n").filter((f) => /^(us|ca)-[A-Za-z]+\.json$/.test(f)))
    for (const r of JSON.parse(execFileSync("git", ["show", `${ref}:${relative}/${file}`], { encoding: "utf8", maxBuffer: 64 << 20 })) as Array<{ tax: string; code: string; from: string }>)
      before.set(key(r), JSON.stringify(r));
  const { rules } = readRuleFiles();
  const archived = archivedByUrl();
  const root = sourcesRoot();
  const changed: string[] = [];
  const problems: string[] = [];
  for (const r of rules) {
    const { file, ...rule } = r;
    if (before.get(key(rule)) === JSON.stringify(rule)) continue;
    changed.push(`${file}: ${key(rule)}`);
    for (const c of rule.citations) {
      const where = `${file}: ${key(rule)}: ${c.url}`;
      if (!c.quote) {
        problems.push(`${where}: no quote`);
        continue;
      }
      const copy = archived.get(c.url);
      if (!copy) {
        problems.push(`${where}: the page isn't archived (run ingest --kind taxability, which files it)`);
        continue;
      }
      const text = pageText(new Uint8Array(readFileSync(path.join(root, copy.file))));
      if (text === null || !quoteOnPage(text, c.quote)) problems.push(`${where}: the quote isn't on the archived page`);
    }
  }
  return { changed, problems };
}
