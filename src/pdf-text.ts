/**
 * A PDF's text, page by page, as the archive shows it: extracted from the
 * PDF's own text layer by pdftotext (the same tool the quote checks read
 * with), never rewritten. Browsers don't scroll a PDF to a quoted sentence,
 * so the evidence archive shows this text beside the PDF, where a link can
 * open at the quote; the PDF stays the evidence.
 *
 * Kept by the PDF's SHA-256 in artifacts/evidence-text/<sha256>.json
 * (derived, and made again from the PDF at will) and in the evidence
 * bucket as text/<sha256>.json. Beside it, machine-made readings that are
 * never evidence and never checked against (docs/data.md#evidence):
 * <sha256>.machine.json, a scan's transcription by two models
 * (scripts/transcribe-scans.mts), and <sha256>.formatted.json, table
 * pages as Markdown (scripts/format-tables.mts).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sourcesRoot } from "./ingest/archive.js";
import { pageText } from "./taxability/fetch.js";

export interface PdfText {
  sha256: string;
  /** Each page's text, form feeds removed; empty strings for pages with no text layer.
   *  Reading order (pdftotext without -layout): what quotes are checked against. */
  pages: string[];
  /** The same pages as printed (pdftotext -layout): columns side by side and
   *  tables in their columns, line-end hyphens kept. Only for reading: a
   *  two-column page's sentences are split across its columns, so quotes are
   *  never checked against it. As many pages as `pages`. */
  layout: string[];
  /** No page has text: a scan, which would need OCR (never used as evidence unreviewed). */
  scanned: boolean;
  extractedWith: string;
  extractedAt: string;
  /** "word" for a Word .doc shown as its text, "html" for a web page's text,
   *  "text" for a text file's or an API answer's (src/evidence-text.ts);
   *  absent for a PDF. */
  kind?: "word" | "html" | "text";
  /** Where each quote the rules cite on this copy is in `pages`
   *  (src/evidence-text.ts): the evidence archive highlights it, and a
   *  citation's link opens at it (#q-…). */
  marks?: TextMark[];
  /** The quotes `marks` were made for (the first 16 of the SHA-256 of them,
   *  sorted): marks are made again only when it changes. */
  marksFor?: string;
  /** An HTML page's main content, as two models saw it: the first and last
   *  lines (1-based, of pages[0]) to show in the text view. Only lines are
   *  picked, nothing is rewritten; the Worker shows it only when every mark
   *  lies inside (src/evidence-crop.ts). */
  crop?: TextCrop;
}

/** A quote's place in a text: on page `page` (1-based), [start, end) in
 *  UTF-16 units. A quote that runs over a page break ends past its page's
 *  end: `end` counts on into the next page, after one character for the
 *  break (pages[page - 1] + "\n" + pages[page]). */
export interface TextMark {
  /** "q-" and the first 10 hex of the SHA-256 of the quote as cited. */
  id: string;
  quote: string;
  page: number;
  start: number;
  end: number;
}

/** The lines a web page's main content runs between, as two models picked
 *  them (src/evidence-crop.ts): from the earlier first line to the later
 *  last; no lines when the answers don't overlap or one is unusable. */
export interface TextCrop {
  firstLine?: number;
  lastLine?: number;
  /** The models, "<a> and <b>". */
  model: string;
  /** US dollars, as OpenRouter reported it, both answers. */
  cost: number;
  at: string;
  /** Each model's own answer: its lines, or what it said instead. */
  answers: Array<{ model: string; firstLine?: number; lastLine?: number; unusable?: string }>;
}

/** Where extracted texts are kept: beside artifacts/sources. */
export const textDir = () => path.join(path.dirname(sourcesRoot()), "evidence-text");

const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 1024)).toString("latin1").includes("%PDF-");

let version: string | undefined;
const pdftotextVersion = () => {
  if (version === undefined) {
    try {
      version = execFileSync("pdftotext", ["-v"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim().split("\n")[0] || "pdftotext";
    } catch (error) {
      // pdftotext -v prints to stderr on some versions.
      version = String((error as { stderr?: Buffer }).stderr ?? "pdftotext").trim().split("\n")[0] || "pdftotext";
    }
  }
  return version;
};

/** The pages of a PDF's text layer, or null when the bytes aren't a PDF
 *  pdftotext can read; with `layout`, as printed (pdftotext -layout). */
export function pdfPages(bytes: Uint8Array, options: { layout?: boolean } = {}): string[] | null {
  if (!isPdf(bytes)) return null;
  const dir = mkdtempSync(path.join(tmpdir(), "otr-pdf-"));
  try {
    writeFileSync(path.join(dir, "doc.pdf"), bytes);
    const args = ["-enc", "UTF-8", ...(options.layout ? ["-layout"] : []), path.join(dir, "doc.pdf"), "-"];
    const out = execFileSync("pdftotext", args, { maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
    const pages = out.split("\f");
    if (pages.length > 1 && !pages.at(-1)!.trim()) pages.pop();
    return pages.map((p) => p.replace(/\s+$/, ""));
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The layout view's pages, as many as the reading-order text has (a page
 *  pdftotext -layout leaves out is empty; never more pages than the text). */
function layoutPages(bytes: Uint8Array, count: number): string[] {
  const pages = pdfPages(bytes, { layout: true }) ?? [];
  return Array.from({ length: count }, (_, i) => pages[i] ?? "");
}

/** The extracted text of the PDF with this hash (its bytes in `file`),
 *  made once and kept; null when it isn't a readable PDF. A kept text made
 *  before the layout view existed gets it added, from the same bytes. */
/** An old Word document (OLE2 compound file). */
export const isWordDoc = (bytes: Uint8Array) => bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;

export function pdfText(sha256: string, file: string): PdfText | null {
  const kept = path.join(textDir(), `${sha256}.json`);
  if (existsSync(kept)) {
    const text = JSON.parse(readFileSync(kept, "utf8")) as PdfText;
    if (Array.isArray(text.layout) || text.kind === "word") return text;
    text.layout = layoutPages(new Uint8Array(readFileSync(file)), text.pages.length);
    writeFileSync(kept, JSON.stringify(text));
    return text;
  }
  const bytes = new Uint8Array(readFileSync(file));
  if (isWordDoc(bytes)) {
    // A Word .doc, as the quote checks read it: one page, no layout view.
    const doc = pageText(bytes);
    if (doc === null) return null;
    const text: PdfText = { sha256, pages: [doc], layout: [], scanned: !doc.trim(), extractedWith: "OpenTaxRate's Word .doc reader (src/taxability/fetch.ts pageText)", extractedAt: new Date().toISOString(), kind: "word" };
    mkdirSync(textDir(), { recursive: true });
    writeFileSync(kept, JSON.stringify(text));
    return text;
  }
  const pages = pdfPages(bytes);
  if (pages === null) return null;
  const text: PdfText = { sha256, pages, layout: layoutPages(bytes, pages.length), scanned: !pages.some((p) => p.trim()), extractedWith: pdftotextVersion(), extractedAt: new Date().toISOString() };
  mkdirSync(textDir(), { recursive: true });
  writeFileSync(kept, JSON.stringify(text));
  return text;
}

/** Every PDF in artifacts/sources, older copies in previous/ included, by
 *  its SHA-256: for the scripts that read a kept text's PDF again. */
export function pdfFilesByHash(root = sourcesRoot()): Map<string, string> {
  const found = new Map<string, string>();
  const head = Buffer.alloc(1024);
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && !entry.name.endsWith(".partial")) {
        const fd = openSync(full, "r");
        const n = readSync(fd, head, 0, 1024, 0);
        closeSync(fd);
        if (!isPdf(head.subarray(0, n))) continue;
        found.set(createHash("sha256").update(readFileSync(full)).digest("hex"), full);
      }
    }
  };
  walk(root);
  return found;
}

/** The page (1-based) a quote starts on, a quote that runs over a page
 *  break included; 0 when no page has it. `found` is the quote check's own
 *  matcher (src/taxability/fetch.ts quoteOnPage). */
export function pageOf(pages: string[], quote: string, found: (text: string, quote: string) => boolean): number {
  // A page that has it whole first; only then one that runs over a break.
  const whole = pages.findIndex((p) => found(p, quote));
  if (whole >= 0) return whole + 1;
  for (let i = 0; i + 1 < pages.length; i++) if (found(`${pages[i]}\n${pages[i + 1]}`, quote)) return i + 1;
  return 0;
}
