/**
 * A formatted view of the archive's table-heavy PDF pages: each page whose
 * printed layout looks like a table goes, as a one-page PDF, to one model
 * through OpenRouter, asked for an exact Markdown transcription (tables as
 * Markdown tables). The evidence archive shows it as a third view, labelled
 * machine-made and unverified; citations never link to it, and quotes are
 * never checked against it (docs/data.md#evidence).
 *
 *   OPENROUTER_API_KEY=… npx tsx scripts/format-tables.mts [--budget 8] [--limit N] [--dry-run]
 *
 * A page looks like a table when its pdftotext -layout text has at least 8
 * lines with two or more gaps of 3+ spaces between words (src/pdf-machine.ts
 * looksTabular). A page's Markdown is kept only when it has at least 99% of
 * the words of the PDF's own text of that page (counted with repeats; case,
 * punctuation and Markdown marks aside), the model didn't stop at its token
 * cap, and it isn't a runaway (no more than 3 times the page's words).
 *
 * The PDFs taxability rules cite go first, then the rest. --limit caps the
 * PDFs read this run. Results go to artifacts/evidence-text/<sha256>.formatted.json,
 * every page tried with its recall (kept or not), so a page is asked about
 * once (cached by hash): a monthly run reads only new PDFs. Stops starting
 * pages once the spend, with what's still being asked, could pass --budget.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { copiesByUrl } from "../src/ingest/archive.js";
import { FORMAT_PROMPT, looksTabular, onePagePdf, readPage, wordCount, wordRecall, type MachineFormatted } from "../src/pdf-machine.js";
import { pdfFilesByHash, textDir, type PdfText } from "../src/pdf-text.js";
import { readRuleFiles } from "../src/taxability/rules/index.js";

const MODEL = "google/gemini-3.1-flash-lite";
const MIN_RECALL = 0.99;
const MAX_GROWTH = 3;
/** A page's output cap: enough for its words as a Markdown table (pipes and
 *  rules cost tokens), never so much a looping model runs on. */
const maxTokens = (words: number) => Math.min(20_000, Math.max(1_500, Math.ceil(words * 8)));
/** The most one call can cost (output at $1.50 a million tokens, and the page in). */
const worstCall = (words: number) => (maxTokens(words) * 1.5) / 1e6 + 0.002;

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const budget = Number(arg("--budget") ?? 8);
const limit = Number(arg("--limit") ?? Infinity);
const dryRun = process.argv.includes("--dry-run");
const key = process.env.OPENROUTER_API_KEY;
if (!key && !dryRun) {
  console.error("Needs OPENROUTER_API_KEY in the environment (docs/data.md#evidence).");
  process.exit(1);
}

// The PDFs rules cite, and how many citations each has.
const copies = copiesByUrl();
const citations = new Map<string, number>();
for (const r of readRuleFiles().rules) for (const c of r.citations) for (const k of copies.get(c.url) ?? []) citations.set(k.sha256, (citations.get(k.sha256) ?? 0) + 1);

interface Todo {
  sha256: string;
  text: PdfText;
  kept: MachineFormatted | null;
  pages: number[];
}
const todo: Todo[] = [];
for (const name of readdirSync(textDir())) {
  const m = /^([0-9a-f]{64})\.json$/.exec(name);
  if (!m) continue;
  const text = JSON.parse(readFileSync(path.join(textDir(), name), "utf8")) as PdfText;
  if (text.scanned || !text.layout) continue;
  const keptFile = path.join(textDir(), `${m[1]}.formatted.json`);
  const kept = existsSync(keptFile) ? (JSON.parse(readFileSync(keptFile, "utf8")) as MachineFormatted) : null;
  const pages = text.layout.map((l, i) => i + 1).filter((n) => looksTabular(text.layout[n - 1]) && text.pages[n - 1].trim() && !(kept && String(n) in kept.recall));
  if (pages.length) todo.push({ sha256: m[1], text, kept, pages });
}
todo.sort((a, b) => (citations.get(b.sha256) ?? 0) - (citations.get(a.sha256) ?? 0) || a.sha256.localeCompare(b.sha256));
const cited = todo.filter((t) => citations.has(t.sha256));
console.log(
  `${todo.length} PDFs with table pages not yet tried, ${todo.reduce((s, t) => s + t.pages.length, 0)} pages (${cited.length} cited PDFs, ${cited.reduce((s, t) => s + t.pages.length, 0)} pages); budget $${budget}`,
);
if (dryRun) process.exit(0);

const files = pdfFilesByHash();
let spent = 0, reserved = 0, stopped = false;
const tally = { tried: 0, kept: 0, lowRecall: 0, runaway: 0, cutOff: 0, failed: 0 };
let pdfs = 0;
for (const t of todo.slice(0, limit)) {
  const file = files.get(t.sha256);
  if (!file) continue;
  const record: MachineFormatted = t.kept ?? { sha256: t.sha256, kind: "machine-formatted", reviewed: false, model: MODEL, pages: {}, recall: {}, dropped: {}, cost: 0, at: "" };
  const queue = [...t.pages];
  let cost = 0;
  const worker = async () => {
    for (let page = queue.shift(); page; page = queue.shift()) {
      const source = t.text.pages[page - 1];
      const words = wordCount(source);
      const worst = worstCall(words);
      if (spent + reserved + worst > budget) {
        stopped = true;
        return;
      }
      reserved += worst;
      try {
        const answer = await readPage({ key: key!, model: MODEL, prompt: FORMAT_PROMPT, pdf: onePagePdf(file, page), page, maxTokens: maxTokens(words) });
        spent += answer.cost;
        cost += answer.cost;
        tally.tried++;
        const recall = Number(wordRecall(source, answer.text).toFixed(4));
        record.recall[page] = recall;
        const why =
          answer.finish === "length" ? "stopped at its token cap"
          : wordCount(answer.text) > MAX_GROWTH * words ? `a runaway: ${wordCount(answer.text)} words for the page's ${words}`
          : recall < MIN_RECALL ? `kept ${(recall * 100).toFixed(1)}% of the page's words`
          : null;
        if (why) {
          record.dropped[page] = why;
          tally[answer.finish === "length" ? "cutOff" : why.startsWith("a runaway") ? "runaway" : "lowRecall"]++;
        } else {
          record.pages[page] = answer.text;
          tally.kept++;
        }
      } catch (error) {
        tally.failed++;
        console.log(`${t.sha256.slice(0, 12)} page ${page}: ${(error as Error).message}`);
      } finally {
        reserved -= worst;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (Object.keys(record.recall).length) {
    record.cost = Number((record.cost + cost).toFixed(6));
    record.at = new Date().toISOString();
    writeFileSync(path.join(textDir(), `${t.sha256}.formatted.json`), JSON.stringify(record));
    pdfs++;
    console.log(`${t.sha256.slice(0, 12)}${citations.has(t.sha256) ? " (cited)" : ""}: ${Object.keys(record.pages).length} kept, ${Object.keys(record.dropped).length} dropped of ${Object.keys(record.recall).length} tried, $${cost.toFixed(4)} (total $${spent.toFixed(4)})`);
  }
  if (stopped) break;
}
console.log(
  `${pdfs} PDFs; ${tally.tried} pages tried: ${tally.kept} kept, ${tally.lowRecall} under ${MIN_RECALL * 100}% recall, ${tally.runaway} runaways, ${tally.cutOff} cut off, ${tally.failed} failed; spent $${spent.toFixed(4)}${stopped ? " (stopped at the budget)" : ""}`,
);
