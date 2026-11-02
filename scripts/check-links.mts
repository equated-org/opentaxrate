// Every link a reader or an API caller can click, checked:
//
//   npx tsx --env-file-if-exists=.env scripts/check-links.mts [--out DIR] [--db URL] [--write-offline]
//
// Collects links from the built site (client/build: run `pnpm --dir client
// build` first), docs/**/*.{html,md}, README.md, the citations in
// src/taxability/rules/{us,ca}-*.json (and, with --db, the `archived` links
// the API returns, from taxability_rules.citations), and the evidence
// archive's index and capture pages. Internal links are resolved on disk;
// the rest are fetched: HEAD, then GET when HEAD fails, with a browser
// User-Agent and redirects followed, one request a second to a host.
//
// Writes DIR/results.json and DIR/report.md (default /tmp/otr-links).
// --write-offline also rewrites client/src/lib/offline-originals.json: the
// cited originals that are gone (404/410, no DNS, a certificate no browser
// accepts), which the site labels "no longer online" beside the archived
// copy. A blocked, timed-out or 5xx page is never listed: it may be up.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import tls from "node:tls";
import { trustListedIntermediates } from "../src/taxability/fetch.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const BUILD = path.join(ROOT, "client/build");
const EVIDENCE = "https://evidence.opentaxrate.com";
const SITE = "https://opentaxrate.com";
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
// Strings in the JS bundle that are shown, not linked (the API's base URL).
const NOT_LINKS = new Set(["https://api.opentaxrate.com"]);
const OFFLINE_FILE = path.join(ROOT, "client/src/lib/offline-originals.json");

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const OUT = opt("--out") ?? "/tmp/otr-links";
const DB = opt("--db");

type Class = "ok" | "redirect" | "broken" | "blocked" | "timeout" | "skipped";
interface Result { url: string; class: Class; status?: number; final?: string; note?: string; where: string[]; cited?: boolean }

// ---------- collecting ----------
const links = new Map<string, Set<string>>();
const internal = new Map<string, Set<string>>(); // "file|target" -> where
const cited = new Set<string>();
const add = (url: string, where: string) => {
  url = url.replace(/&amp;/g, "&").trim();
  if (!links.has(url)) links.set(url, new Set());
  links.get(url)!.add(where);
};
const walk = (dir: string, keep: (f: string) => boolean, out: string[] = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, keep, out);
    else if (keep(full)) out.push(full);
  }
  return out;
};
/** A bare URL in prose, as GitHub links it: trailing punctuation and an
 *  unbalanced closing parenthesis are the sentence's, not the URL's. */
function bare(url: string) {
  for (;;) {
    const trimmed = url.replace(/[.,;:!?*_]+$/, "");
    const opens = (trimmed.match(/\(/g) ?? []).length, closes = (trimmed.match(/\)/g) ?? []).length;
    const next = trimmed.endsWith(")") && closes > opens ? trimmed.slice(0, -1) : trimmed;
    if (next === url) return url;
    url = next;
  }
}
const rel = (f: string) => path.relative(ROOT, f);
const hrefs = (html: string) => [...html.matchAll(/<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => m[1] ?? m[2]);

// The built site: each page's anchors, its page data, and links only drawn in the browser (JS chunks).
if (!existsSync(BUILD)) throw new Error("No client/build: run `pnpm --dir client build` first.");
const page = (f: string) => "/" + path.relative(BUILD, f).replace(/(index)?\.html$/, "").replace(/\/__data\.json$/, "");
for (const f of walk(BUILD, (f) => f.endsWith(".html"))) {
  for (const h of hrefs(readFileSync(f, "utf8"))) siteLink(h, page(f), `site ${page(f)}`);
}
for (const f of walk(BUILD, (f) => f.endsWith("__data.json"))) {
  for (const m of readFileSync(f, "utf8").matchAll(/"(https?:\/\/[^"\\\s]+)"/g)) add(m[1], `site ${page(f)} (page data)`);
}
for (const f of walk(path.join(BUILD, "_app"), (f) => f.endsWith(".js"))) {
  for (const m of readFileSync(f, "utf8").matchAll(/(?:href=\\?"|["'`])(https?:\/\/[^"'`\\\s<>{}$]+)/g)) {
    const u = m[1];
    if (/^https?:\/\/(www\.w3\.org|localhost|127\.)|\.invalid\//.test(u) || NOT_LINKS.has(u) || /tiles\.|openfreemap|photon\.komoot|geoapify\.com\/v1|\/v1\/|svelte\.dev\/e\//.test(u)) continue;
    add(u, `site JS ${rel(f).replace(/-[A-Za-z0-9_-]{8}\.js$/, ".js")}`);
  }
}
function siteLink(h: string, from: string, where: string) {
  if (/^(mailto:|tel:|javascript:|data:)/.test(h) || h === "" || h === "#") return;
  if (/^https?:\/\//.test(h)) return add(h, where);
  const target = new URL(h, SITE + from).pathname + (new URL(h, SITE + from).hash || "");
  const key = `site|${target}`;
  if (!internal.has(key)) internal.set(key, new Set());
  internal.get(key)!.add(where);
}

// The docs and README.
const docs = [path.join(ROOT, "README.md"), ...walk(path.join(ROOT, "docs"), (f) => /\.(html|md)$/.test(f))];
for (const f of docs) {
  let text = readFileSync(f, "utf8");
  const found: string[] = [];
  if (f.endsWith(".html")) found.push(...hrefs(text));
  else {
    text = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
    for (const m of text.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) found.push(m[1]);
    for (const m of text.matchAll(/^\s*\[[^\]^][^\]]*\]:\s*(\S+)/gm)) found.push(m[1]);
    for (const m of text.matchAll(/<(https?:\/\/[^>\s]+)>/g)) found.push(m[1]);
    for (const m of text.matchAll(/(?<![("<\[=])\bhttps?:\/\/[^\s<>"'\]]+/g)) found.push(bare(m[0]));
    for (const m of text.matchAll(/<a\b[^>]*?href="([^"]+)"/g)) found.push(m[1]);
  }
  for (const h of new Set(found)) {
    if (/^(mailto:|#$)/.test(h)) continue;
    if (/^https?:\/\//.test(h)) add(h, rel(f));
    else if (h.startsWith("#")) internal.set(`file|${rel(f)}${h}`, new Set([...(internal.get(`file|${rel(f)}${h}`) ?? []), rel(f)]));
    else {
      const target = path.relative(ROOT, path.resolve(path.dirname(f), decodeURI(h.split("#")[0]))) + (h.includes("#") ? "#" + h.split("#")[1] : "");
      const key = `file|${target}`;
      if (!internal.has(key)) internal.set(key, new Set());
      internal.get(key)!.add(rel(f));
    }
  }
}

// The rule files' citations.
const rulesDir = path.join(ROOT, "src/taxability/rules");
for (const f of readdirSync(rulesDir).filter((f) => /^(us|ca)-.*\.json$/.test(f))) {
  for (const r of JSON.parse(readFileSync(path.join(rulesDir, f), "utf8")) as Array<{ tax: string; code: string; citations: Array<{ url: string }> }>)
    for (const c of r.citations) {
      add(c.url, `rule ${f}`);
      cited.add(c.url);
    }
}
// The API's citations (archived links included), from a release database.
const pinnedHashes = new Set<string>();
if (DB) {
  const rows = execFileSync("psql", [DB, "-Atc", "select c::text from taxability_rules, jsonb_array_elements(citations) c"], { encoding: "utf8", maxBuffer: 1 << 28 }).trim().split("\n");
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  for (const row of rows.filter(Boolean)) {
    const c = JSON.parse(row) as { url: string; archived?: string };
    add(c.url, "API citation url");
    cited.add(c.url);
    // The fragment is the browser's; one request per copy.
    if (c.archived) {
      add(c.archived.split("#")[0], "API citation archived");
      pinnedHashes.add(c.archived);
    } else add(`${EVIDENCE}/${today}/${c.url}`, "API citation without archived (UI falls back to the dated copy)");
  }
}
// The /sources page links each cited page's captures.
for (const u of cited) add(`${EVIDENCE}/url?u=${encodeURIComponent(u)}`, "site /sources (archived copy)");

// --only TEXT: check just the links containing TEXT (and no internal ones).
if (opt("--only")) {
  for (const u of [...links.keys()]) if (!u.includes(opt("--only")!)) links.delete(u);
  internal.clear();
}
if (args.includes("--list")) {
  for (const [u, w] of links) console.log(`${u}\t${[...w][0]}`);
  for (const [k, w] of internal) console.log(`${k}\t${[...w][0]}`);
  process.exit(0);
}

// ---------- checking ----------
trustListedIntermediates();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const TLS = /CERT|UNABLE_TO|SELF_SIGNED|DEPTH_ZERO|ERR_TLS|ERR_SSL|SSL|EPROTO/;
const challenge = (status: number, headers: Headers, body: string) =>
  headers.get("cf-mitigated") === "challenge" ||
  /just a moment\.\.\.|cf-chl|challenge-platform|enable javascript and cookies|access denied|request rejected|incapsula|captcha|are you a robot|_Incapsula_Resource|akamai/i.test(body.slice(0, 20000)) ||
  ((status === 403 || status === 429) && /cloudflare|akamai|incapsula|imperva/i.test(headers.get("server") ?? ""));

/** A server that leaves out its intermediate certificate: fetch it from the
 *  address its certificate names (AIA), as browsers do, and trust it. */
const completed = new Set<string>();
async function completeChain(host: string): Promise<boolean> {
  if (completed.has(host)) return false;
  completed.add(host);
  const leaf = await new Promise<X509Certificate | undefined>((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const raw = socket.getPeerCertificate().raw;
      socket.end();
      resolve(raw ? new X509Certificate(raw) : undefined);
    });
    socket.on("error", () => resolve(undefined));
    socket.setTimeout(15_000, () => (socket.destroy(), resolve(undefined)));
  });
  const issuer = leaf?.infoAccess?.match(/CA Issuers - URI:(\S+)/)?.[1];
  if (!issuer) return false;
  try {
    const der = Buffer.from(await (await fetch(issuer, { signal: AbortSignal.timeout(15_000) })).arrayBuffer());
    tls.setDefaultCACertificates([...tls.getCACertificates("default"), new X509Certificate(der).toString()]);
    return true;
  } catch {
    return false;
  }
}

async function attempt(url: string, method: "HEAD" | "GET") {
  const r = await fetch(url, { method, redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/pdf,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(25_000) });
  const body = method === "GET" && (r.headers.get("content-type") ?? "").includes("html") ? await r.text().catch(() => "") : (await r.body?.cancel().catch(() => {}), "");
  return { status: r.status, final: r.url, headers: r.headers, body };
}
async function check(url: string): Promise<Omit<Result, "where">> {
  if (/^https?:\/\/(localhost|127\.|0\.0\.0\.0|example\.(com|org))|[{}<>]|\$\{|\/YOUR|\.\.\.$/.test(url) || /^https?:\/\/[^/]*\.invalid\b/.test(url) || /^https?:\/\/[^/]*\.(local|internal|test)\b/.test(url)) return { url, class: "skipped", note: "placeholder or local address" };
  // HEAD first; GET when HEAD fails or errs (many servers mishandle HEAD),
  // and GET once more after a pause for a dropped connection or a 5xx.
  let r: Awaited<ReturnType<typeof attempt>> | undefined;
  let err: unknown;
  for (const method of ["HEAD", "GET", "GET"] as const) {
    try {
      r = await attempt(url, method);
      err = undefined;
      if (r.status < 400 || (method === "GET" && r.status < 500 && r.status !== 429)) break;
    } catch (e) {
      err = e;
      const code = String((e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name);
      if (/UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT/.test(code) && (await completeChain(new URL(url).hostname))) continue;
      if (method === "GET" && /ENOTFOUND|CERT|UNABLE_TO|SELF_SIGNED|ERR_TLS|Timeout/.test(code)) break;
    }
    await sleep(method === "HEAD" ? 1000 : 3000);
  }
  if (err || !r) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const code = String(cause?.code ?? (err as Error).name);
    const note = `${code}${cause?.message && cause.message !== code ? `: ${cause.message}` : ""}`.slice(0, 200);
    if (/Timeout|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|AbortError/.test(code)) return { url, class: "timeout", note };
    if (/ENOTFOUND|EAI_AGAIN/.test(code)) return { url, class: "broken", note: `DNS ${note}` };
    if (TLS.test(code)) return { url, class: "broken", note: `TLS ${note}` };
    return { url, class: "broken", note };
  }
  const redirected = r.final.replace(/\/$/, "") !== url.replace(/#.*$/, "").replace(/\/$/, "");
  if (challenge(r.status, r.headers, r.body)) return { url, class: "blocked", status: r.status, note: "bot challenge or access-denied page", ...(redirected ? { final: r.final } : {}) };
  if (r.status === 403 || r.status === 429 || r.status === 401) return { url, class: "blocked", status: r.status, ...(redirected ? { final: r.final } : {}) };
  if (r.status >= 400) return { url, class: "broken", status: r.status, ...(redirected ? { final: r.final } : {}) };
  if (redirected) {
    const f = new URL(r.final);
    const soft = (f.pathname === "/" || /404|not-?found|error|pagenotfound|^\/search\/?$/i.test(f.pathname + f.search)) && new URL(url).pathname !== "/";
    return { url, class: "redirect", status: r.status, final: r.final, ...(soft ? { note: "redirects to a home or error page: the page itself is gone" } : {}) };
  }
  return { url, class: "ok", status: r.status };
}

const byHost = new Map<string, string[]>();
for (const url of links.keys()) {
  let host = "invalid";
  try { host = new URL(url).host; } catch {}
  byHost.set(host, [...(byHost.get(host) ?? []), url]);
}
const results: Result[] = [];
let done = 0;
const hosts = [...byHost.entries()].sort((a, b) => b[1].length - a[1].length);
const total = links.size;
async function runHost([host, urls]: [string, string[]]) {
  for (const url of urls) {
    const t = Date.now();
    const r = host === "invalid" ? { url, class: "broken" as const, note: "not a valid URL" } : await check(url);
    results.push({ ...r, where: [...links.get(url)!].sort(), ...(cited.has(url) ? { cited: true } : {}) });
    if (++done % 100 === 0) console.error(`${done}/${total}`);
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  }
}
const queue = args.includes("--internal-only") ? [] : [...hosts];
await Promise.all(Array.from({ length: 24 }, async () => { for (let h = queue.shift(); h; h = queue.shift()) await runHost(h); }));

// Internal links, on disk.
const idsIn = new Map<string, Set<string>>();
const ids = (file: string) => {
  if (!idsIn.has(file)) {
    const text = existsSync(file) ? readFileSync(file, "utf8") : "";
    const set = new Set([...text.matchAll(/\s(?:id|name)="([^"]+)"/g)].map((m) => m[1]));
    if (file.endsWith(".md")) for (const m of text.matchAll(/^#+\s+(.+)$/gm)) set.add(m[1].toLowerCase().replace(/[^\w\- ]/g, "").replace(/ /g, "-"));
    idsIn.set(file, set);
  }
  return idsIn.get(file)!;
};
for (const [key, where] of internal) {
  const [kind, target] = key.split(/\|(.*)/s);
  const [p, hash] = target.split("#");
  let file: string | undefined;
  if (kind === "site") {
    const clean = decodeURIComponent(p).replace(/\/$/, "");
    file = [path.join(BUILD, clean + ".html"), path.join(BUILD, clean, "index.html"), path.join(BUILD, clean)].find((f) => existsSync(f) && statSync(f).isFile());
    // Pages the client draws without prerendering (SPA fallback) count as present if their route exists.
    if (!file && existsSync(path.join(ROOT, "client/src/routes", clean))) file = path.join(ROOT, "client/src/routes", clean);
  } else file = existsSync(path.join(ROOT, p)) ? path.join(ROOT, p) : undefined;
  const url = `${kind === "site" ? "site:" : ""}${target}`;
  if (!file) results.push({ url, class: "broken", note: "no such file or page", where: [...where] });
  else if (hash && !hash.startsWith(":~:") && statSync(file).isFile() && /\.(html|md)$/.test(file) && !ids(file).has(decodeURIComponent(hash))) results.push({ url, class: "broken", note: `no #${hash} on the page`, where: [...where] });
  else results.push({ url, class: "ok", where: [...where] });
}

// ---------- report ----------
mkdirSync(OUT, { recursive: true });
results.sort((a, b) => a.url.localeCompare(b.url));
writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
const count = (c: Class) => results.filter((r) => r.class === c).length;
const classes: Class[] = ["ok", "redirect", "broken", "blocked", "timeout", "skipped"];
const line = (r: Result) => `- ${r.url}${r.status ? ` — ${r.status}` : ""}${r.final ? ` → ${r.final}` : ""}${r.note ? ` (${r.note})` : ""}\n  - in: ${r.where.slice(0, 6).join("; ")}${r.where.length > 6 ? `; +${r.where.length - 6} more` : ""}`;
const md = [
  `# Link check, ${new Date().toISOString().slice(0, 10)}`,
  "",
  `${results.length} links (${links.size} fetched, ${internal.size} internal on disk).`,
  "",
  "| class | links |", "|---|---|",
  ...classes.map((c) => `| ${c} | ${count(c)} |`),
  "",
  ...(["broken", "timeout", "blocked"] as Class[]).flatMap((c) => [`## ${c}`, "", ...results.filter((r) => r.class === c).map(line), ""]),
  "## redirect (suspicious: lands on a home or error page)", "", ...results.filter((r) => r.class === "redirect" && r.note).map(line), "",
  "## redirect", "", ...results.filter((r) => r.class === "redirect" && !r.note).map(line), "",
].join("\n");
writeFileSync(path.join(OUT, "report.md"), md);
console.log(classes.map((c) => `${c} ${count(c)}`).join(", "));

if (args.includes("--write-offline")) {
  // Gone: 404/410, no DNS, a certificate for another name, or a redirect to
  // an error or search page. An entry written by hand ("by hand: ...", say a
  // retired portal answering 502 for every page) stays until the page answers.
  const gone = (r: Result) =>
    r.class === "broken" ? /^(DNS|TLS ERR_TLS_CERT_ALTNAME|TLS CERT_HAS_EXPIRED)/.test(r.note ?? "") || r.status === 404 || r.status === 410 : r.class === "redirect" && !!r.note;
  const before = existsSync(OFFLINE_FILE) ? (JSON.parse(readFileSync(OFFLINE_FILE, "utf8")).urls as Record<string, string>) : {};
  const now = new Map(results.map((r) => [r.url, r]));
  const urls: Record<string, string> = {};
  for (const [url, why] of Object.entries(before))
    if (why.startsWith("by hand:") && !["ok", "redirect"].includes(now.get(url)?.class ?? "") ) urls[url] = why;
  for (const r of results.filter((r) => r.cited && gone(r))) urls[r.url] = r.class === "redirect" ? `redirects to ${r.final}` : r.status ? String(r.status) : r.note!.split(":")[0];
  const sorted = Object.fromEntries(Object.entries(urls).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(OFFLINE_FILE, JSON.stringify({ checked: new Date().toISOString().slice(0, 10), note: "Cited pages no longer online, from scripts/check-links.mts --write-offline. The archived copy is the evidence.", urls: sorted }, null, "\t") + "\n");
  console.log(`${Object.keys(sorted).length} cited originals offline -> ${rel(OFFLINE_FILE)}`);
}
