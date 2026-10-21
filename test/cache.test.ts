/**
 * The answer cache: one key for every spelling of a lookup, answers that
 * expire, and the least recently used dropped first. No database.
 */
import { describe, expect, it, vi } from "vitest";
import { AnswerCache, answerKey, cacheFromEnv } from "../src/cache.js";
import { lookUpRate } from "../src/lookup.js";

vi.mock("../src/lookup.js", async (original) => {
  const actual = await original<typeof import("../src/lookup.js")>();
  return { ...actual, lookUpRate: vi.fn(actual.lookUpRate) };
});

const q = { state: "tx", street: "1100  Congress Ave.", city: "Austin", zip: "78701", date: "2026-10-21" };

describe("the key", () => {
  it("is the same however the address is typed, and differs by date and include", () => {
    const key = answerKey(q, []);
    expect(answerKey({ ...q, state: "TX", street: "1100 CONGRESS AVE", city: " austin " }, [])).toBe(key);
    expect(answerKey({ ...q, date: "2026-10-22" }, [])).not.toBe(key);
    expect(answerKey(q, ["trace"])).not.toBe(key);
    expect(answerKey({ ...q, zip: "78701-1234" }, [])).not.toBe(key);
  });
});

describe("the cache", () => {
  it("returns an answer until it expires", () => {
    let now = 0;
    const cache = new AnswerCache<number>(1_000, 10, () => now);
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    now = 999;
    expect(cache.get("a")).toBe(1);
    now = 1_000;
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("drops the least recently used past its size", () => {
    const cache = new AnswerCache<string>(60_000, 2);
    cache.set("a", "A");
    cache.set("b", "B");
    cache.get("a");
    cache.set("c", "C");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");
  });

  it("is off unless OPENTAXRATE_CACHE_HOURS is set", () => {
    expect(cacheFromEnv({})).toBeUndefined();
    expect(cacheFromEnv({ OPENTAXRATE_CACHE_HOURS: "0" })).toBeUndefined();
    expect(cacheFromEnv({ OPENTAXRATE_CACHE_HOURS: "24" })?.ttlMs).toBe(86_400_000);
  });
});

describe("the API with a cache set", async () => {
  process.env.OPENTAXRATE_CACHE_HOURS = "24";
  const { app } = await import("../src/server.js");
  const calls = () => vi.mocked(lookUpRate).mock.calls.length;

  it("answers a repeated lookup from memory, with the same body", async () => {
    // A statewide state's answer needs no database.
    const url = "/v1/rate?state=DC&street=1350+Pennsylvania+Ave+NW&city=Washington&date=2026-10-21";
    const before = calls();
    const first = await (await app.request(url)).text();
    const second = await (await app.request(url.replace("Washington", "washington"))).text();
    expect(second).toBe(first);
    expect(calls() - before).toBe(1);
    // Asking for the trace is another answer.
    const traced = await (await app.request(`${url}&include=trace`)).json();
    expect(traced.trace).toEqual({ geocoders: [], outlines: [] });
    expect(calls() - before).toBe(2);
  });

  it("never keeps a refusal", async () => {
    const url = "/v1/rate?state=MT&street=418+E+2nd+St&city=Whitefish&date=2026-10-21";
    const before = calls();
    expect((await app.request(url)).status).toBe(422);
    expect((await app.request(url)).status).toBe(422);
    expect(calls() - before).toBe(2);
  });
});
