/**
 * A per-IP limit on lookups, for an API open to the public:
 * OPENTAXRATE_PUBLIC_LIMIT="10/min,200/day" allows 10 a minute and 200 a day
 * from each address. Unset, there is no limit.
 *
 * The address is the socket's peer, or Cloudflare's CF-Connecting-IP header
 * when OPENTAXRATE_TRUST_CF=1 (only safe when the origin accepts nothing but
 * Cloudflare's ranges, since anyone else can send the header).
 *
 * Counts are fixed windows held in memory, one process's own. Windows that
 * have ended are swept out, and at most MAX_KEYS addresses are held, so
 * memory stays bounded however many addresses call.
 */
import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

export interface Window {
  limit: number;
  ms: number;
}

const UNITS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  second: 1_000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
};

/** "10/min,200/day" as windows; throws on anything else, so a typo in the
 *  setting fails at start rather than leaving the API unlimited. */
export function parseLimits(spec: string): Window[] {
  return spec
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(\d+)\s*\/\s*(\d*)\s*([a-z]+?)s?$/i.exec(part);
      const unit = m && UNITS[m[3].toLowerCase()];
      if (!m || !unit || Number(m[1]) < 1)
        throw new Error(`OPENTAXRATE_PUBLIC_LIMIT: can't read "${part}"; write it like 10/min,200/day.`);
      return { limit: Number(m[1]), ms: unit * Number(m[2] || 1) };
    });
}

/** At most this many addresses are counted at once; past it, the oldest
 *  are dropped. */
const MAX_KEYS = 100_000;

export class PerIpLimiter {
  /** Per address, one window start and count per configured window. */
  private counts = new Map<string, Array<{ start: number; count: number }>>();
  private sweptAt = 0;

  constructor(
    readonly windows: Window[],
    private now: () => number = Date.now,
  ) {}

  /** Counts one lookup for `key`: null when allowed, else the seconds until
   *  the window that is full ends. A refused lookup isn't counted. */
  take(key: string): number | null {
    const now = this.now();
    this.sweep(now);
    const held = this.counts.get(key);
    const slots = this.windows.map((w, i) => {
      const slot = held?.[i];
      return slot && now - slot.start < w.ms ? slot : { start: now, count: 0 };
    });
    let wait = 0;
    slots.forEach((slot, i) => {
      if (slot.count >= this.windows[i].limit)
        wait = Math.max(wait, Math.ceil((slot.start + this.windows[i].ms - now) / 1000));
    });
    if (wait) return Math.max(wait, 1);
    for (const slot of slots) slot.count++;
    // Re-inserted so the map's order is by last use, for dropping the oldest.
    this.counts.delete(key);
    this.counts.set(key, slots);
    if (this.counts.size > MAX_KEYS) this.counts.delete(this.counts.keys().next().value!);
    return null;
  }

  get size() {
    return this.counts.size;
  }

  /** Drops addresses whose windows have all ended, at most once per
   *  shortest window. */
  private sweep(now: number) {
    const shortest = Math.min(...this.windows.map((w) => w.ms));
    if (now - this.sweptAt < shortest) return;
    this.sweptAt = now;
    for (const [key, slots] of this.counts)
      if (slots.every((slot, i) => now - slot.start >= this.windows[i].ms)) this.counts.delete(key);
  }
}

/** The caller's address: CF-Connecting-IP when trusted, else the socket's. */
export function clientAddress(c: Context, trustCf: boolean): string {
  if (trustCf) {
    const cf = c.req.header("CF-Connecting-IP")?.trim();
    if (cf) return cf;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // No Node socket (an in-process request, as in tests).
    return "unknown";
  }
}

/** Middleware answering 429 with Retry-After once an address is over any
 *  window. */
export function perIpLimit(limiter: PerIpLimiter, trustCf: boolean): MiddlewareHandler {
  return async (c, next) => {
    const wait = limiter.take(clientAddress(c, trustCf));
    if (wait === null) return next();
    c.header("Retry-After", String(wait));
    return c.json({ error: `Too many lookups from this address. Try again in ${wait} s.`, code: "RATE_LIMITED" }, 429);
  };
}

/** The limit the environment sets, or undefined when it sets none. */
export function limitFromEnv(env: NodeJS.ProcessEnv = process.env): MiddlewareHandler | undefined {
  const spec = env.OPENTAXRATE_PUBLIC_LIMIT?.trim();
  if (!spec) return undefined;
  return perIpLimit(new PerIpLimiter(parseLimits(spec)), env.OPENTAXRATE_TRUST_CF === "1");
}
