/**
 * Every archived document's text, and where each cited quote is in it, for
 * the evidence archive's text views (evidence/worker.js): a citation's link
 * opens the copy at its quote (`?view=text#q-…`), highlighted, on any page,
 * because the place is found here, by the same matcher the quote checks use
 * (quoteSpan, src/taxability/fetch.ts), and not by the browser.
 *
 * The text is the one the checks read, never rewritten: a PDF's text layer
 * and a Word .doc's text (src/pdf-text.ts), and a web page's pageText.
 * Each copy's text is kept, by its SHA-256, in
 * artifacts/evidence-text/<sha256>.json (`kind: "html"` and one page for a
 * web page), with `marks`: each quote cited on any URL this copy is a
 * capture of, with its page and [start, end) in that page's text. Derived,
 * and made again from the bytes at will; marks are made again when the
 * quotes cited on the copy change.
 */
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import path from "node:path";
import { EVIDENCE, pageText, quoteFinder, quoteOnPage } from "./taxability/fetch.js";
import { isWordDoc, pdfText, textDir, type PdfText, type TextMark } from "./pdf-text.js";
import type { Catalog } from "./evidence.js";

/** The anchor a quote is marked with: "q-" and the first 10 hex of the
 *  SHA-256 of the quote as cited. */
export const quoteId = (quote: string) => `q-${createHash("sha256").update(quote).digest("hex").slice(0, 10)}`;

/** The archived copy's text view, opening at the quote's mark. */
export const markLink = (sha256: string, quote: string) => `${EVIDENCE}/sha256/${sha256}?view=text#${quoteId(quote)}`;

export const HTML_READER = "OpenTaxRate's HTML reader (src/taxability/fetch.ts pageText)";

const head = (file: string) => {
  const buffer = Buffer.alloc(1024);
  const fd = openSync(file, "r");
  const n = readSync(fd, buffer, 0, 1024, 0);
  closeSync(fd);
  return buffer.subarray(0, n);
};

/** A web page's text (or a text file's, an API's JSON answer's) as the
 *  quote checks read it (pageText), kept as a one-page record. Made from
 *  the bytes every time and compared with the kept one, so a change to the
 *  reader never leaves a stale text: a text that changed loses its marks
 *  and crop, which are made again. */
export function htmlText(sha256: string, file: string, kind: "html" | "text" = "html"): PdfText | null {
  const text = pageText(new Uint8Array(readFileSync(file)));
  if (text === null) return null;
  const kept = path.join(textDir(), `${sha256}.json`);
  if (existsSync(kept)) {
    const record = JSON.parse(readFileSync(kept, "utf8")) as PdfText;
    if (record.kind === kind && record.pages[0] === text) return record;
  }
  const record: PdfText = { sha256, pages: [text], layout: [], scanned: !text.trim(), extractedWith: HTML_READER, extractedAt: new Date().toISOString(), kind };
  mkdirSync(textDir(), { recursive: true });
  writeFileSync(kept, JSON.stringify(record));
  return record;
}

/** The text of the copy with this hash (its bytes in `file`): a PDF's or a
 *  Word .doc's (pdfText), else a web page's or a text file's (htmlText)
 *  when `type` says it's one; null for anything else, or text that can't
 *  be read. */
export function documentText(sha256: string, file: string, type = ""): PdfText | null {
  const start = head(file);
  if (start.toString("latin1").includes("%PDF-") || isWordDoc(new Uint8Array(start))) return pdfText(sha256, file);
  if (type.startsWith("text/html")) return htmlText(sha256, file);
  if (/^(text\/|application\/(json|xml))/.test(type)) return htmlText(sha256, file, "text");
  return null;
}

/** A page's quote finders, made once per page (or page pair) and kept. */
type Finders = Map<string, ReturnType<typeof quoteFinder>>;

/** Where a quote is in a document's pages: the first page that has it
 *  whole (as pageOf), else the first that has it running over its break
 *  into the next; null when no page has it. */
export function findMark(pages: string[], quote: string, finders: Finders = new Map()): Omit<TextMark, "id" | "quote"> | null {
  const finder = (key: string, text: () => string) => {
    if (!finders.has(key)) finders.set(key, quoteFinder(text()));
    return finders.get(key)!;
  };
  for (let i = 0; i < pages.length; i++) {
    const span = finder(String(i), () => pages[i])(quote);
    if (span) return { page: i + 1, start: span[0], end: span[1] };
  }
  for (let i = 0; i + 1 < pages.length; i++) {
    const span = finder(`${i}+`, () => `${pages[i]}\n${pages[i + 1]}`)(quote);
    // Only a quote that does run over the break: one inside either page was found above.
    if (span && span[0] < pages[i].length && span[1] > pages[i].length) return { page: i + 1, start: span[0], end: span[1] };
  }
  return null;
}

/** The text a mark covers, as the page prints it. */
export const markedText = (pages: string[], mark: Pick<TextMark, "page" | "start" | "end">) =>
  (mark.end > pages[mark.page - 1].length ? `${pages[mark.page - 1]}\n${pages[mark.page] ?? ""}` : pages[mark.page - 1]).slice(mark.start, mark.end);

/** The quotes' key: what `marksFor` records. */
const quotesKey = (quotes: string[]) => createHash("sha256").update([...new Set(quotes)].sort().join("\n")).digest("hex").slice(0, 16);

/** A text with marks for exactly these quotes: each one found (findMark),
 *  in order of place; true when the marks changed. A scan has none. */
export function markQuotes(record: PdfText, quotes: string[]): boolean {
  const key = quotesKey(quotes);
  if (record.marksFor === key && Array.isArray(record.marks)) return false;
  const finders: Finders = new Map();
  const marks: TextMark[] = [];
  for (const quote of [...new Set(quotes)].sort()) {
    const at = record.scanned ? null : findMark(record.pages, quote, finders);
    if (at) marks.push({ id: quoteId(quote), quote, ...at });
  }
  marks.sort((a, b) => a.page - b.page || a.start - b.start || a.end - b.end);
  record.marks = marks;
  record.marksFor = key;
  return true;
}

/** The copy a citation is pinned to: the newest copy whose text has the
 *  quote (an older edition for an older rule), else, for a citation with no
 *  quote, the newest copy; undefined when no copy has the quote. */
export function pinnedCopy<T extends { file: string }>(held: T[], quote: string | undefined, textOf: (file: string) => string | null): T | undefined {
  return quote ? [...held].reverse().find((k) => { const t = textOf(k.file); return t !== null && quoteOnPage(t, quote); }) : held.at(-1);
}

/** Types whose text the archive shows (and marks): documents always, and a
 *  text file or an API's JSON answer when a rule quotes it. */
export const hasTextView = (type: string) => /^(text\/|application\/(pdf|msword|json|xml))/.test(type);
const isDocument = (type: string) => /^(text\/html|application\/(pdf|msword))/.test(type);

/**
 * Brings every document copy's text and marks up to date: each HTML, PDF
 * and Word copy in the catalog (and each text or JSON copy a rule quotes)
 * gets its text (made once, by hash) and marks for the quotes cited on any
 * URL it's a capture of. Writes only what
 * changed. Returns the hashes with text, and counts.
 */
export function updateEvidenceTexts(catalog: Catalog, files: Map<string, string>): { texts: Map<string, PdfText>; changed: number; marks: number; quotes: number } {
  const quotesOf = new Map<string, Set<string>>();
  const typeOf = new Map<string, string>();
  for (const record of Object.values(catalog.urls))
    for (const c of record.captures) {
      if (!hasTextView(c.type)) continue;
      typeOf.set(c.sha256, c.type);
      if (!quotesOf.has(c.sha256)) quotesOf.set(c.sha256, new Set());
      for (const by of record.citedBy) if (by.quote) quotesOf.get(c.sha256)!.add(by.quote);
    }
  const texts = new Map<string, PdfText>();
  let changed = 0, marks = 0, quotes = 0;
  for (const [sha, wanted] of quotesOf) {
    const file = files.get(sha);
    if (!file || (!isDocument(typeOf.get(sha)!) && !wanted.size)) continue;
    const record = documentText(sha, file, typeOf.get(sha));
    if (!record) continue;
    if (markQuotes(record, [...wanted])) {
      writeFileSync(path.join(textDir(), `${sha}.json`), JSON.stringify(record));
      changed++;
    }
    texts.set(sha, record);
    marks += record.marks?.length ?? 0;
    quotes += wanted.size;
  }
  return { texts, changed, marks, quotes };
}
