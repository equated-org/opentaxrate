/**
 * Machine-made readings of archived PDFs, for the evidence archive's views
 * (docs/data.md#evidence). Never evidence, never checked against: the PDF is
 * the evidence and quotes are checked against its own text layer
 * (src/pdf-text.ts). Two kinds, each kept beside the PDF's text in
 * artifacts/evidence-text and the bucket's text/:
 *
 *   <sha256>.machine.json    a scan's transcription, page by page, by two
 *                            models, with every word they read differently
 *                            (scripts/transcribe-scans.mts)
 *   <sha256>.formatted.json  table-heavy pages as Markdown, kept only when
 *                            they keep the text layer's words
 *                            (scripts/format-tables.mts)
 *
 * The models read each page as a one-page PDF through OpenRouter.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export interface Disagreement {
  /** The primary model's words here ("" where it has none). */
  a: string;
  /** The other model's words here. */
  b: string;
  /** Where `a` is in the page's `text` (characters); start = end where the primary has nothing. */
  start: number;
  end: number;
}

export interface MachineTranscription {
  sha256: string;
  kind: "machine-transcription";
  reviewed: false;
  /** The primary model first: its reading is each page's `text`. */
  models: string[];
  /** Every page of the PDF; null for a page with its own text layer (a PDF
   *  only partly scanned has its image-only pages read, nothing else). */
  pages: Array<MachinePage | null>;
  /** US dollars, as OpenRouter reported it. */
  cost: number;
  at: string;
}

export interface MachinePage {
  text: string;
  alternate: string;
  disagreements: Disagreement[];
  /** A model that stopped at its token cap. */
  cutOff?: string[];
}

export interface MachineFormatted {
  sha256: string;
  kind: "machine-formatted";
  reviewed: false;
  model: string;
  /** Kept pages' Markdown, by page number (1-based). */
  pages: Record<string, string>;
  /** Every page tried: the share of the text layer's words its Markdown kept. */
  recall: Record<string, number>;
  /** Pages tried and not kept, and why. */
  dropped: Record<string, string>;
  cost: number;
  at: string;
}

export const TRANSCRIBE_PROMPT =
  "Transcribe this scanned page exactly, as plain text, using Markdown only for headings, lists and tables the page has. " +
  "Keep every word, number and punctuation mark exactly as printed, misspellings and line breaks within a word included. " +
  "Never correct, normalize, complete, summarize or reorder anything. No HTML; don't describe images, logos, stamps or signatures. " +
  "Where a word can't be read, write [illegible]. Output only the transcription.";

export const FORMAT_PROMPT =
  "Transcribe this PDF page exactly as Markdown: tables as Markdown tables (one row per printed row), headings as # headings, lists as lists. " +
  "Keep every word, number and punctuation mark exactly as printed. Never correct, normalize, complete, summarize or reorder anything. " +
  "No HTML; don't describe images or logos. Output only the Markdown.";

/** Page `page` (1-based) of a PDF as a PDF of its own. */
export function onePagePdf(file: string, page: number): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), "otr-page-"));
  try {
    const out = path.join(dir, "page.pdf");
    execFileSync("pdfseparate", ["-f", String(page), "-l", String(page), file, out], { stdio: ["ignore", "ignore", "ignore"] });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface Answer {
  text: string;
  model: string;
  cost: number;
  /** "stop", or "length" when it hit the token cap. */
  finish: string;
}

/** One PDF page read by one model through OpenRouter, at temperature 0 with
 *  its output capped; retried twice on a dropped connection or an error. */
export async function readPage(options: { key: string; model: string; prompt: string; pdf: Buffer; page: number; maxTokens: number }): Promise<Answer> {
  const body = {
    model: options.model,
    temperature: 0,
    max_tokens: options.maxTokens,
    usage: { include: true },
    plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: options.prompt },
          { type: "file", file: { filename: `page${options.page}.pdf`, file_data: `data:application/pdf;base64,${options.pdf.toString("base64")}` } },
        ],
      },
    ],
  };
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${options.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(300_000),
      });
      const answer = (await response.json()) as { model?: string; choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { cost?: number }; error?: { message?: string } };
      if (response.ok && answer.choices?.length)
        return { text: answer.choices[0].message?.content ?? "", model: answer.model ?? options.model, cost: answer.usage?.cost ?? 0, finish: answer.choices[0].finish_reason ?? "" };
      last = `${response.status} ${answer.error?.message ?? ""}`.slice(0, 200);
    } catch (error) {
      last = (error as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
  }
  throw new Error(`${options.model} on page ${options.page}: ${last}`);
}

/** A text prompt answered by one model through OpenRouter, at temperature
 *  0 with its output capped; retried twice on a dropped connection or an
 *  error. For questions whose answer is never text shown as evidence (the
 *  lines a page's content runs between: src/evidence-crop.ts). */
export async function askModel(options: { key: string; model: string; prompt: string; maxTokens: number; /** OpenRouter's reasoning setting, e.g. { enabled: false }. */ reasoning?: Record<string, unknown> }): Promise<Answer> {
  const body = { model: options.model, temperature: 0, max_tokens: options.maxTokens, usage: { include: true }, ...(options.reasoning ? { reasoning: options.reasoning } : {}), messages: [{ role: "user", content: options.prompt }] };
  let last = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${options.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
      const answer = (await response.json()) as { model?: string; choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: { cost?: number }; error?: { message?: string } };
      if (response.ok && answer.choices?.length)
        return { text: answer.choices[0].message?.content ?? "", model: answer.model ?? options.model, cost: answer.usage?.cost ?? 0, finish: answer.choices[0].finish_reason ?? "" };
      last = `${response.status} ${answer.error?.message ?? ""}`.slice(0, 200);
    } catch (error) {
      last = (error as Error).message;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000 * (attempt + 1)));
  }
  throw new Error(`${options.model}: ${last}`);
}

/** A word as two readings are compared: Markdown marks (a table's rule
 *  line "|:---|" included), underline tags, curly quotes and case don't
 *  count; other punctuation does. */
const wordKey = (word: string) => {
  const key = word
    .replace(/<\/?u>/gi, "")
    .replace(/[*_#>|`]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase();
  return /^[-:=]+$/.test(key) ? "" : key;
};

const words = (text: string) => [...text.matchAll(/\S+/g)].map((m) => ({ word: m[0], key: wordKey(m[0]), start: m.index!, end: m.index! + m[0].length })).filter((w) => w.key);

/** Where two readings of a page differ, word by word (longest common
 *  subsequence), with each place's span in `a`. A word split or joined
 *  differently ("the-rental", "the rental") isn't a difference. */
export function wordDiff(a: string, b: string): Disagreement[] {
  const x = words(a), y = words(b);
  const n = x.length, m = y.length;
  // lcs[i][j]: the common subsequence of x[i..] and y[j..], flattened.
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * (m + 1) + j] = x[i].key === y[j].key ? lcs[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
  const out: Disagreement[] = [];
  let i = 0, j = 0;
  let hunk: { xs: typeof x; ys: typeof y; at: number } | null = null;
  const close = () => {
    if (!hunk) return;
    const join = (ws: typeof x) => ws.map((w) => w.key.replace(/-/g, "")).join("");
    if (join(hunk.xs) !== join(hunk.ys))
      out.push({
        a: hunk.xs.map((w) => w.word).join(" "),
        b: hunk.ys.map((w) => w.word).join(" "),
        start: hunk.xs.length ? hunk.xs[0].start : hunk.at,
        end: hunk.xs.length ? hunk.xs.at(-1)!.end : hunk.at,
      });
    hunk = null;
  };
  // Where a hunk with no words of a's sits: right after a's last word before it.
  const at = () => (i > 0 ? x[i - 1].end : 0);
  while (i < n || j < m) {
    if (i < n && j < m && x[i].key === y[j].key) {
      close();
      i++, j++;
    } else if (j < m && (i === n || lcs[i * (m + 1) + j + 1] >= lcs[(i + 1) * (m + 1) + j])) {
      hunk ??= { xs: [], ys: [], at: at() };
      hunk.ys.push(y[j++]);
    } else {
      hunk ??= { xs: [], ys: [], at: at() };
      hunk.xs.push(x[i++]);
    }
  }
  close();
  return out;
}

/** A word as recall counts it: letters and digits only, in lower case. */
const bare = (text: string) =>
  text
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);

/** The share of `source`'s words (with their repeats) that `output` has:
 *  case, punctuation and Markdown marks aside. 1 for a page with no words. */
export function wordRecall(source: string, output: string): number {
  const want = bare(source);
  if (!want.length) return 1;
  const have = new Map<string, number>();
  for (const w of bare(output)) have.set(w, (have.get(w) ?? 0) + 1);
  let kept = 0;
  for (const w of want) {
    const left = have.get(w) ?? 0;
    if (left > 0) kept++, have.set(w, left - 1);
  }
  return kept / want.length;
}

export const wordCount = (text: string) => bare(text).length;

/** Whether a page laid out as printed (pdftotext -layout) looks like a
 *  table: at least 8 lines with two or more gaps of 3+ spaces between
 *  words, i.e. three or more columns. Prose, even two-column prose, has
 *  one gap a line at most. */
export function looksTabular(layoutPage: string): boolean {
  let rows = 0;
  for (const line of layoutPage.split("\n")) if ((line.trim().match(/\S {3,}(?=\S)/g)?.length ?? 0) >= 2 && ++rows >= 8) return true;
  return false;
}
