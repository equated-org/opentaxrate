/**
 * The picker a description is read by: a model that, given the text and a
 * few choice questions, picks one offered option per question with a
 * confidence and (where it gives them) a probability for every option. It
 * never sees a rate, a treatment, the address or the date: only the text
 * and each option's words. Jev proposes; the rules decide (describe.ts).
 *
 *   jevPicker      TypeSafe's Jev: one call asks every question
 *   cachedPicker   answers kept by (model, instructions, options, text), so
 *                  a repeat costs nothing: in memory in the server, in a
 *                  JSON file for the benchmark
 *   paidPicker     asks only when a budget pays for the call
 *
 * Any failure (no key, a timeout, an error, an option not offered) is no
 * answer, and the caller answers as if no text was sent.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface Question {
  instructions: string;
  /** Option id → the words it means. */
  options: Record<string, string>;
}

export interface Picked {
  choice: string;
  confidence: number;
  /** Option id → probability, where the picker gives them. */
  probabilities?: Record<string, number>;
}

/** Answers every question about `text`, or null on any failure. */
export interface Picker {
  /** Part of every cache key: a cached answer is the model's that gave it. */
  readonly model: string;
  pick(text: string, questions: Record<string, Question>): Promise<Record<string, Picked> | null>;
}

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** Pinned, so cached answers and the benchmark's numbers stay the model's
 *  they were measured on; OPENTAXRATE_DESCRIBE_MODEL moves it. */
export const DESCRIBE_MODEL = process.env.OPENTAXRATE_DESCRIBE_MODEL || "jev-1.14.0";

/** Jev, or null without TYPESAFE_API_KEY. */
export function jevPicker(options: { model?: string; timeoutMs?: number } = {}): Picker | null {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return null;
  const model = options.model ?? DESCRIBE_MODEL;
  const timeoutMs = options.timeoutMs ?? 3_000;
  return {
    model,
    async pick(text, questions) {
      const body = {
        model,
        // The text is data: one field of the state, never an instruction.
        state: JSON.stringify({ description: text }),
        questions: Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { type: "choice", instructions: q.instructions, criteria: q.options }])),
      };
      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) return null;
        const reply = (await response.json()) as { answers?: Record<string, { choice?: unknown; confidence?: unknown; probabilities?: unknown }> };
        return checkedAnswers(questions, reply.answers);
      } catch {
        return null;
      }
    },
  };
}

/** How far a pick's probabilities may sum from 1, for the provider's
 *  rounding (Jev's sum to 1 exactly). */
const SUM_SLACK = 0.02;

const isProbability = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/** Each question's answer, only if every one is an offered option with a
 *  confidence between 0 and 1 and, where given, probabilities that are each
 *  between 0 and 1 for offered options and sum to 1; anything else is no
 *  answer. */
export function checkedAnswers(questions: Record<string, Question>, answers: Record<string, { choice?: unknown; confidence?: unknown; probabilities?: unknown }> | undefined): Record<string, Picked> | null {
  if (!answers) return null;
  const out: Record<string, Picked> = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = answers[id];
    if (!a || typeof a.choice !== "string" || !isProbability(a.confidence) || !Object.hasOwn(q.options, a.choice)) return null;
    let probabilities: Record<string, number> | undefined;
    if (a.probabilities !== undefined && a.probabilities !== null) {
      if (typeof a.probabilities !== "object") return null;
      const all = Object.entries(a.probabilities as Record<string, unknown>);
      if (!all.every(([, v]) => isProbability(v))) return null;
      const sum = all.reduce((s, [, v]) => s + (v as number), 0);
      if (Math.abs(sum - 1) > SUM_SLACK) return null;
      probabilities = Object.fromEntries(all.filter(([k]) => Object.hasOwn(q.options, k)) as Array<[string, number]>);
    }
    out[id] = { choice: a.choice, confidence: a.confidence, ...(probabilities && Object.keys(probabilities).length ? { probabilities } : {}) };
  }
  return out;
}

/** Where cached answers are kept. */
export interface PickStore {
  get(key: string): Picked | undefined;
  set(key: string, pick: Picked): void;
}

/** In memory, the oldest dropped past `max`. */
export function memoryStore(max = 20_000): PickStore {
  const map = new Map<string, Picked>();
  return {
    get: (key) => map.get(key),
    set(key, pick) {
      map.set(key, pick);
      if (map.size > max) map.delete(map.keys().next().value!);
    },
  };
}

/** A JSON file of answers, read once and written by save(): the benchmark
 *  replays it, so a rerun is free and gives the same numbers. */
export function fileStore(file: string): PickStore & { save(): void; readonly added: number } {
  const map = new Map<string, Picked>(existsSync(file) ? Object.entries(JSON.parse(readFileSync(file, "utf8")) as Record<string, Picked>) : []);
  let added = 0;
  return {
    get: (key) => map.get(key),
    set(key, pick) {
      if (!map.has(key)) added++;
      map.set(key, pick);
    },
    save() {
      if (added) writeFileSync(file, `${JSON.stringify(Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b))), null, 0)}\n`);
    },
    get added() {
      return added;
    },
  };
}

/** The cache key of one question about `text`. */
export const pickKey = (model: string, q: Question, text: string) =>
  createHash("sha256").update(JSON.stringify([model, q.instructions, q.options, text])).digest("hex");

/** `picker`, asked only for the questions `store` has no answer to. */
export function cachedPicker(picker: Picker, store: PickStore): Picker {
  return {
    model: picker.model,
    async pick(text, questions) {
      const out: Record<string, Picked> = {};
      const missing: Record<string, Question> = {};
      for (const [id, q] of Object.entries(questions)) {
        const hit = store.get(pickKey(picker.model, q, text));
        if (hit) out[id] = hit;
        else missing[id] = q;
      }
      if (!Object.keys(missing).length) return out;
      const asked = await picker.pick(text, missing);
      if (!asked) return null;
      for (const [id, pick] of Object.entries(asked)) {
        store.set(pickKey(picker.model, missing[id], text), pick);
        out[id] = pick;
      }
      return out;
    },
  };
}

/** `picker`, each call paid for first by `pay` (a budget's spend); no
 *  answer when it won't pay. */
export function paidPicker(picker: Picker, pay: () => Promise<boolean>): Picker {
  return { model: picker.model, pick: async (text, questions) => ((await pay()) ? picker.pick(text, questions) : null) };
}
