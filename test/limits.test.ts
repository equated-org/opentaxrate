/**
 * The per-IP limit: how a setting reads, when a lookup is refused and for
 * how long, which address is counted, and that only /v1/rate is limited.
 * No database: every request here is refused before a lookup would run.
 */
import { describe, expect, it } from "vitest";
import { clientIpHeader, parseLimits, PerIpLimiter } from "../src/limits.js";

const MIN = 60_000;
const DAY = 86_400_000;

describe("the setting", () => {
  it("reads counts per unit, and refuses what it can't read", () => {
    expect(parseLimits("10/min, 200/day")).toEqual([
      { limit: 10, ms: MIN },
      { limit: 200, ms: DAY },
    ]);
    expect(parseLimits("5/10s,1000/hours")).toEqual([
      { limit: 5, ms: 10_000 },
      { limit: 1000, ms: 3_600_000 },
    ]);
    expect(() => parseLimits("10 per minute")).toThrow(/10\/min,200\/day/);
    expect(() => parseLimits("10/fortnight")).toThrow();
  });
});

describe("the limiter", () => {
  it("refuses the 11th lookup in a minute, says when to retry, and allows it once the minute ends", () => {
    let now = 1_000_000;
    const limiter = new PerIpLimiter(parseLimits("10/min,200/day"), () => now);
    for (let i = 0; i < 10; i++) {
      expect(limiter.take("203.0.113.7")).toBeNull();
      now += 1_000;
    }
    // The minute began 10 s ago.
    expect(limiter.take("203.0.113.7")).toBe(50);
    // Another address has its own count.
    expect(limiter.take("198.51.100.1")).toBeNull();
    now += 50_000;
    expect(limiter.take("203.0.113.7")).toBeNull();
  });

  it("holds to the day's limit across minutes", () => {
    let now = 0;
    const limiter = new PerIpLimiter(parseLimits("10/min,25/day"), () => now);
    for (let i = 0; i < 25; i++) {
      expect(limiter.take("a")).toBeNull();
      now += 10_000;
    }
    expect(limiter.take("a")).toBe(Math.ceil((DAY - now) / 1000));
  });

  it("forgets addresses whose windows have ended", () => {
    let now = 0;
    const limiter = new PerIpLimiter(parseLimits("10/min"), () => now);
    for (let i = 0; i < 1000; i++) limiter.take(`10.0.${i >> 8}.${i & 255}`);
    expect(limiter.size).toBe(1000);
    now += MIN;
    limiter.take("10.1.0.1");
    expect(limiter.size).toBe(1);
  });
});

describe("clientIpHeader", () => {
  it("prefers the named header, falls back to CF-Connecting-IP, else none", () => {
    expect(clientIpHeader({ OPENTAXRATE_CLIENT_IP_HEADER: "X-Client-IP", OPENTAXRATE_TRUST_CF: "1" })).toBe("X-Client-IP");
    expect(clientIpHeader({ OPENTAXRATE_TRUST_CF: "1" })).toBe("CF-Connecting-IP");
    expect(clientIpHeader({})).toBeUndefined();
  });
});

describe("the API with a limit set", async () => {
  process.env.OPENTAXRATE_PUBLIC_LIMIT = "10/min,200/day";
  process.env.OPENTAXRATE_TRUST_CF = "1";
  const { app } = await import("../src/server.js");
  // A malformed query is answered without the database, and still counts.
  const lookUp = (headers: Record<string, string> = {}, socket = "192.0.2.1") =>
    app.request("/v1/rate?state=X", { headers }, { incoming: { socket: { remoteAddress: socket } } });

  it("answers the 11th call within a minute with 429 and Retry-After", async () => {
    for (let i = 0; i < 10; i++) expect((await lookUp({ "CF-Connecting-IP": "203.0.113.7" })).status).toBe(400);
    const limited = await lookUp({ "CF-Connecting-IP": "203.0.113.7" });
    expect(limited.status).toBe(429);
    const wait = Number(limited.headers.get("Retry-After"));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
    expect(await limited.json()).toEqual({
      error: `Too many lookups from this address. Try again in ${wait} s.`,
      code: "RATE_LIMITED",
    });
  });

  it("counts by CF-Connecting-IP when trusted, else by the socket's address", async () => {
    expect((await lookUp({ "CF-Connecting-IP": "203.0.113.8" })).status).toBe(400);
    // No header: the socket's address, which has its own count.
    for (let i = 0; i < 10; i++) expect((await lookUp({}, "192.0.2.9")).status).toBe(400);
    expect((await lookUp({}, "192.0.2.9")).status).toBe(429);
  });

  it("doesn't limit other routes", async () => {
    for (let i = 0; i < 12; i++) expect((await app.request("/v1/nothing")).status).toBe(404);
  });
});
