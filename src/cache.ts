/**
 * Recent answers held in memory, so a repeated address (a shared link, an
 * example on the landing page) is answered without asking the geocoders
 * again: OPENTAXRATE_CACHE_HOURS=24 keeps each successful answer for a day.
 * Unset, nothing is cached. Refusals and errors are never cached.
 *
 * The least recently used answer is dropped past MAX_ANSWERS entries.
 * Rates are dated, and the key includes the date, so an answer can only go
 * stale by the loaded data changing; the hours bound how long that lasts.
 */
import type { RateQuery } from "./lookup.js";

const MAX_ANSWERS = 5_000;

export class AnswerCache<T> {
  private entries = new Map<string, { value: T; expires: number }>();

  constructor(
    readonly ttlMs: number,
    readonly maxEntries = MAX_ANSWERS,
    private now: () => number = Date.now,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    // Re-inserted so the map's order is by last use.
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T) {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }

  get size() {
    return this.entries.size;
  }
}

const norm = (s: string | undefined) => (s ?? "").toUpperCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();

/** One key for every way of typing the same lookup: case, spacing, commas
 *  and dots don't matter; the date must be resolved (never "today"). */
export function answerKey(q: RateQuery & { date: string }, include: string[]): string {
  return [
    norm(q.state),
    norm(q.street),
    norm(q.city),
    (q.zip ?? "").replace("-", ""),
    q.date,
    [...include].sort().join("+"),
  ].join("|");
}

/** The cache the environment asks for, or undefined. */
export function cacheFromEnv<T>(env: NodeJS.ProcessEnv = process.env): AnswerCache<T> | undefined {
  const hours = Number(env.OPENTAXRATE_CACHE_HOURS);
  if (!env.OPENTAXRATE_CACHE_HOURS?.trim() || !(hours > 0)) return undefined;
  return new AnswerCache<T>(hours * 3_600_000);
}
