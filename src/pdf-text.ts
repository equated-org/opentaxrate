/**
 * A PDF's text, page by page, as the archive shows it: extracted from the
 * PDF's own text layer by pdftotext (the same tool the quote checks read
 * with), never rewritten. Browsers don't scroll a PDF to a quoted sentence,
 * so the evidence archive shows this text beside the PDF, where a link can
 * open at the quote; the PDF stays the evidence.
 *
 * Kept by the PDF's SHA-256 in artifacts/evidence-text/<sha256>.json
 * (derived, and made again from the PDF at will) and in the evidence
 * bucket as text/<sha256>.json.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sourcesRoot } from "./ingest/archive.js";

export interface PdfText {
  sha256: string;
  /** Each page's text, form feeds removed; empty strings for pages with no text layer. */
  pages: string[];
  /** No page has text: a scan, which would need OCR (never used as evidence unreviewed). */
  scanned: boolean;
  extractedWith: string;
  extractedAt: string;
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
 *  pdftotext can read. */
export function pdfPages(bytes: Uint8Array): string[] | null {
  if (!isPdf(bytes)) return null;
  const dir = mkdtempSync(path.join(tmpdir(), "otr-pdf-"));
  try {
    writeFileSync(path.join(dir, "doc.pdf"), bytes);
    const out = execFileSync("pdftotext", ["-enc", "UTF-8", path.join(dir, "doc.pdf"), "-"], { maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "ignore"] }).toString("utf8");
    const pages = out.split("\f");
    if (pages.length > 1 && !pages.at(-1)!.trim()) pages.pop();
    return pages.map((p) => p.replace(/\s+$/, ""));
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The extracted text of the PDF with this hash (its bytes in `file`),
 *  made once and kept; null when it isn't a readable PDF. */
export function pdfText(sha256: string, file: string): PdfText | null {
  const kept = path.join(textDir(), `${sha256}.json`);
  if (existsSync(kept)) return JSON.parse(readFileSync(kept, "utf8")) as PdfText;
  const pages = pdfPages(new Uint8Array(readFileSync(file)));
  if (pages === null) return null;
  const text: PdfText = { sha256, pages, scanned: !pages.some((p) => p.trim()), extractedWith: pdftotextVersion(), extractedAt: new Date().toISOString() };
  mkdirSync(textDir(), { recursive: true });
  writeFileSync(kept, JSON.stringify(text));
  return text;
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
