/**
 * The main content of the archived web pages rules cite, for the evidence
 * archive's text view (docs/data.md#evidence): two models are each shown
 * the page's text (pageText, the one quotes are checked against) with its
 * lines numbered, and each answers only the numbers of the first and last
 * lines of the page's own content, the site's menus, search boxes and
 * "up/next" links around it left out. Nothing they say is shown as text:
 * the view shows the page's own lines, from the earlier of the two first
 * lines to the later of the two last (a model that cuts a page short is
 * outvoted by one that doesn't), and only when every quote marked on the
 * page lies inside (the Worker checks); otherwise the whole text. Two
 * answers that don't overlap crop nothing.
 *
 * Kept in the page's text record (artifacts/evidence-text/<sha256>.json) as
 * `crop: { firstLine, lastLine, model, cost, at, answers }`, by the page's
 * hash, so a page is asked about once. Run by scripts/crop-pages.mts, and
 * by `opentaxrate evidence` when OPENROUTER_API_KEY is set.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { askModel } from "./pdf-machine.js";
import { textDir, type PdfText, type TextCrop } from "./pdf-text.js";

/** The two models, each with OpenRouter's price (US dollars a million tokens). */
export const CROP_MODELS: Record<string, { in: number; out: number }> = {
  "google/gemini-3.1-flash-lite": { in: 0.25, out: 1.5 },
  "google/gemini-2.5-flash-lite": { in: 0.1, out: 0.4 },
};
/** Each line as the models see it, at most this long: enough to tell a
 *  menu from a paragraph, and a long page stays cheap. */
const SHOWN = 160;
/** Pages longer than this many lines aren't cropped: on a whole code or act
 *  the site's menus are a sliver, and a model may cut the page short. */
export const MAX_LINES = 3000;
const MAX_TOKENS = 60;

export const cropPrompt = (lines: string[]) =>
  "Below is the text of an archived web page, one numbered line per block (long lines are cut short here). " +
  "Which lines are the page's main content: the document itself (a statute, regulation, ruling, notice, publication or guidance), from its own title or heading " +
  "to its last part, with everything that belongs to it (its notes, history, effective dates, footnotes, tables and contact lines for its subject), " +
  "but not the website around it (menus, search boxes, login, breadcrumbs, share links, 'up' and 'next' links, lists of other pages, date pickers, the site's footer)? " +
  "When unsure whether a line belongs to the document, include it. " +
  'Answer with JSON only, nothing else: {"first": <number of the first line of the main content>, "last": <number of its last line>}.\n\n' +
  lines.map((l, i) => `${i + 1}: ${l.length > SHOWN ? `${l.slice(0, SHOWN)}…` : l}`).join("\n");

/** The most asking one model about a page could cost: its prompt (a token
 *  for every three characters, generously) and the answer. */
export const worstCropCost = (lines: string[], model: string) => {
  const price = CROP_MODELS[model] ?? { in: 1, out: 4 };
  return (cropPrompt(lines).length / 3 / 1e6) * price.in + (MAX_TOKENS / 1e6) * price.out + 0.0001;
};

/** The two line numbers in a model's answer, when they're lines of the page
 *  in order. */
export function parseCrop(answer: string, lines: number): { firstLine: number; lastLine: number } | null {
  const first = /"first"\s*:\s*(\d+)/.exec(answer)?.[1], last = /"last"\s*:\s*(\d+)/.exec(answer)?.[1];
  if (!first || !last) return null;
  const [a, b] = [Number(first), Number(last)];
  return a >= 1 && a <= b && b <= lines ? { firstLine: a, lastLine: b } : null;
}

/** The lines both answers keep between them: from the earlier first to the
 *  later last; none when either answer is unusable or they don't overlap. */
export function unionOf(answers: TextCrop["answers"]): { firstLine: number; lastLine: number } | null {
  const usable = answers.filter((a) => a.firstLine && a.lastLine) as Array<{ firstLine: number; lastLine: number }>;
  if (usable.length < 2 || usable.length !== answers.length) return null;
  const overlap = Math.min(...usable.map((a) => a.lastLine)) >= Math.max(...usable.map((a) => a.firstLine));
  return overlap ? { firstLine: Math.min(...usable.map((a) => a.firstLine)), lastLine: Math.max(...usable.map((a) => a.lastLine)) } : null;
}

/** Where each line starts in a text. */
export const lineStarts = (text: string) => {
  const starts = [0];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
};

/** The crop's span of a one-page text, [start, end), and whether every mark
 *  lies inside it: only then does the text view show it. */
export function cropSpan(record: PdfText): { start: number; end: number; holdsMarks: boolean } | null {
  if (!record.crop?.firstLine || !record.crop.lastLine || record.kind !== "html") return null;
  const text = record.pages[0];
  const starts = lineStarts(text);
  const { firstLine, lastLine } = record.crop;
  if (lastLine > starts.length) return null;
  const start = starts[firstLine - 1];
  const end = lastLine < starts.length ? starts[lastLine] - 1 : text.length;
  return { start, end, holdsMarks: (record.marks ?? []).every((m) => m.start >= start && m.end <= end) };
}

/** Whether a page still needs a model's answer. */
const waitingFor = (record: PdfText) => Object.keys(CROP_MODELS).filter((m) => !record.crop?.answers?.some((a) => a.model === m));

/** The pages that can be cropped: web pages of more than one line and at
 *  most MAX_LINES. */
export const croppable = (record: PdfText) => {
  if (record.kind !== "html" || !record.pages[0]?.includes("\n")) return false;
  return record.pages[0].split("\n").length <= MAX_LINES;
};

/** Whether a page has both answers (cropped or not). */
export const cropDone = (record: PdfText) => !waitingFor(record).length;

/**
 * Asks each model about each page in `records` it hasn't answered for, in
 * the order given, until `budget` (US dollars) would be passed, counting
 * what the calls still running could cost. Writes each page's record once
 * both answers are in. Never logs the key.
 */
export async function cropPages(records: PdfText[], options: { key: string; budget: number; log?: (line: string) => void }) {
  const log = options.log ?? (() => {});
  const todo = records.filter((r) => croppable(r) && !cropDone(r));
  let spent = 0, reserved = 0, stopped = false;
  const tally = { asked: 0, pages: 0, cropped: 0, holdsMarks: 0, disagree: 0, unusable: 0, failed: 0 };
  const queue = [...todo];
  const worker = async () => {
    for (let record = queue.shift(); record; record = queue.shift()) {
      const lines = record.pages[0].split("\n");
      const models = waitingFor(record);
      const worst = models.reduce((sum, m) => sum + worstCropCost(lines, m), 0);
      if (spent + reserved + worst > options.budget) {
        stopped = true;
        continue;
      }
      reserved += worst;
      try {
        // An answer kept from an earlier run (one model's) is reused.
        const answers: TextCrop["answers"] = [...(record.crop?.answers ?? [])];
        let cost = record.crop?.cost ?? 0;
        for (const model of models) {
          const answer = await askModel({ key: options.key, model, prompt: cropPrompt(lines), maxTokens: MAX_TOKENS, reasoning: { enabled: false } });
          spent += answer.cost;
          cost += answer.cost;
          tally.asked++;
          const picked = parseCrop(answer.text, lines.length);
          if (!picked) {
            tally.unusable++;
            log(`${record.sha256.slice(0, 12)}: ${model} gave no usable answer (${JSON.stringify(answer.text.slice(0, 80))})`);
          }
          answers.push({ model, ...(picked ?? { unusable: answer.text.slice(0, 200) }) });
        }
        const union = unionOf(answers);
        if (!union && answers.every((a) => a.firstLine)) tally.disagree++;
        record.crop = { ...(union ?? {}), model: answers.map((a) => a.model).join(" and "), cost: Number(cost.toFixed(6)), at: new Date().toISOString(), answers };
        writeFileSync(path.join(textDir(), `${record.sha256}.json`), JSON.stringify(record));
        tally.pages++;
        if (union) tally.cropped++;
        const span = cropSpan(record);
        if (span?.holdsMarks) tally.holdsMarks++;
        log(
          `${record.sha256.slice(0, 12)}: ${answers.map((a) => (a.firstLine ? `${a.firstLine}–${a.lastLine}` : "?")).join(" and ")} → ${union ? `lines ${union.firstLine}–${union.lastLine} of ${lines.length}${span?.holdsMarks ? "" : " (a mark outside: not shown)"}` : "no crop"}`,
        );
      } catch (error) {
        tally.failed++;
        log(`${record.sha256.slice(0, 12)}: ${(error as Error).message.slice(0, 200)}`);
      } finally {
        reserved -= worst;
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return { ...tally, waiting: todo.length - tally.pages - tally.failed, tooLong: records.filter((r) => r.kind === "html" && !croppable(r) && r.pages[0]?.includes("\n")).length, spent, stopped };
}
