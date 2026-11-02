/**
 * A machine transcription of every scanned page in the archive: every page
 * of a scanned PDF (no page has a text layer: artifacts/evidence-text/
 * <sha256>.json says `scanned: true`), and each page of any other PDF that
 * has no text but an image (a scanned page in a typed document), so the
 * evidence archive can show a scan's words beside the PDF. Each
 * page goes, as a one-page PDF, to two models through OpenRouter; the first
 * model's reading is the page's text, the second's is kept beside it, and
 * every word they read differently is listed, for the archive to highlight.
 * Never reviewed, never evidence: quotes are never checked against it
 * (docs/data.md#evidence).
 *
 *   OPENROUTER_API_KEY=… npx tsx scripts/transcribe-scans.mts [--budget 2] [--limit N] [--dry-run]
 *
 * Writes artifacts/evidence-text/<sha256>.machine.json once a PDF's pages
 * are all read; a PDF already transcribed is skipped (cached by hash), so a
 * monthly run reads only new scans. Stops starting pages once the spend,
 * with what's still being asked, could pass --budget (US dollars).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { onePagePdf, readPage, TRANSCRIBE_PROMPT, wordDiff, type MachinePage, type MachineTranscription } from "../src/pdf-machine.js";
import { pdfFilesByHash, textDir, type PdfText } from "../src/pdf-text.js";

const PRIMARY = "google/gemini-3.1-flash-lite";
const ALTERNATE = "google/gemini-2.5-flash-lite";
/** A dense typed page is under 1,500 tokens; past this a model is looping. */
const MAX_TOKENS = 6_000;
/** The most one call can cost, at the dearer model's output price, for the budget's reserve. */
const WORST_CALL = (MAX_TOKENS * 1.5) / 1e6 + 0.002;

/** A looping model's tail: a long run of dot leaders to the end. */
const DOT_LOOP = /(?:[ \t]*\.){40,}\s*$/;

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const budget = Number(arg("--budget") ?? 2);
const limit = Number(arg("--limit") ?? Infinity);
const dryRun = process.argv.includes("--dry-run");
const key = process.env.OPENROUTER_API_KEY;
if (!key && !dryRun) {
  console.error("Needs OPENROUTER_API_KEY in the environment (docs/data.md#evidence).");
  process.exit(1);
}

/** The pages (1-based) with an image on them, by pdfimages. */
const imagePages = (file: string) => {
  const out = execFileSync("pdfimages", ["-list", file], { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
  return new Set(out.split("\n").slice(2).map((line) => Number(line.trim().split(/\s+/)[0])).filter((n) => n > 0));
};

const files = pdfFilesByHash();
/** Each PDF with a scanned page and no transcription yet, and the pages to read. */
const scans: Array<{ sha256: string; count: number; read: number[] }> = [];
const missing: string[] = [];
for (const name of readdirSync(textDir()).sort()) {
  const m = /^([0-9a-f]{64})\.json$/.exec(name);
  if (!m || existsSync(path.join(textDir(), `${m[1]}.machine.json`))) continue;
  const text = JSON.parse(readFileSync(path.join(textDir(), name), "utf8")) as PdfText;
  if (text.kind) continue;
  const empty = text.pages.flatMap((p, i) => (p.trim() ? [] : [i + 1]));
  if (!empty.length) continue;
  const file = files.get(m[1]);
  if (!file) {
    missing.push(m[1]);
    continue;
  }
  // A whole scan is read page by page; in a typed PDF, only a textless page
  // with an image (a blank page has nothing to read).
  const images = text.scanned ? null : imagePages(file);
  const read = images ? empty.filter((p) => images.has(p)) : empty;
  if (read.length) scans.push({ sha256: m[1], count: text.pages.length, read });
}
for (const sha of missing) console.log(`${sha.slice(0, 12)}: its PDF isn't in artifacts/sources; skipped`);
console.log(`${scans.length} PDFs with scanned pages not yet transcribed, ${scans.reduce((s, x) => s + x.read.length, 0)} pages; budget $${budget}`);
if (dryRun) process.exit(0);

let spent = 0, inFlight = 0, done = 0, stopped = false;
for (const scan of scans.slice(0, limit)) {
  const file = files.get(scan.sha256)!;
  const pages: Array<MachinePage | null | undefined> = Array.from({ length: scan.count }, (_, i) => (scan.read.includes(i + 1) ? undefined : null));
  let cost = 0;
  const queue = [...scan.read];
  const worker = async () => {
    for (let page = queue.shift(); page; page = queue.shift()) {
      if (spent + (inFlight + 2) * WORST_CALL > budget) {
        stopped = true;
        return;
      }
      inFlight += 2;
      try {
        const pdf = onePagePdf(file, page);
        const [a, b] = await Promise.all([PRIMARY, ALTERNATE].map((model) => readPage({ key: key!, model, prompt: TRANSCRIBE_PROMPT, pdf, page, maxTokens: MAX_TOKENS })));
        spent += a.cost + b.cost;
        cost += a.cost + b.cost;
        const cutOff = [a, b].filter((x) => x.finish === "length").map((x) => x.model);
        // A model that loops runs on to its cap in blank space, or in a
        // form's dot leaders: that tail is dropped, nothing else.
        const [text, alternate] = [a, b].map((x) => x.text.replace(x.finish === "length" ? DOT_LOOP : /$^/, "").trimEnd());
        pages[page - 1] = { text, alternate, disagreements: wordDiff(text, alternate), ...(cutOff.length ? { cutOff } : {}) };
      } catch (error) {
        console.log(`${scan.sha256.slice(0, 12)} page ${page}: ${(error as Error).message}`);
      } finally {
        inFlight -= 2;
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const read = pages.filter(Boolean).length;
  if (read < scan.read.length) {
    console.log(`${scan.sha256.slice(0, 12)}: ${read}/${scan.read.length} pages read${stopped ? ", stopped at the budget" : ""}; not written ($${cost.toFixed(4)})`);
    if (stopped) break;
    continue;
  }
  const record: MachineTranscription = { sha256: scan.sha256, kind: "machine-transcription", reviewed: false, models: [PRIMARY, ALTERNATE], pages: pages as Array<MachinePage | null>, cost: Number(cost.toFixed(6)), at: new Date().toISOString() };
  writeFileSync(path.join(textDir(), `${scan.sha256}.machine.json`), JSON.stringify(record));
  done++;
  const disagreements = pages.reduce((s, p) => s + (p?.disagreements.length ?? 0), 0);
  const cut = pages.filter((p) => p?.cutOff).length;
  console.log(`${scan.sha256.slice(0, 12)}: ${scan.read.length} of ${scan.count} pages, ${disagreements} disagreements${cut ? `, ${cut} pages cut off at the token cap` : ""}, $${cost.toFixed(4)} (total $${spent.toFixed(4)})`);
  if (stopped) break;
}
console.log(`${done} PDFs' scanned pages transcribed; spent $${spent.toFixed(4)}${stopped ? " (stopped at the budget)" : ""}`);
