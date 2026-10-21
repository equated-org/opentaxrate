import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { client, db } from "../src/db/client.js";
import { postgresGeocodeBudget as budget } from "../src/geocoding/budget.js";
import { postgresGeocodeCache as cache } from "../src/geocoding/cache.js";
import { GeocoderError, type GeocoderProvider } from "../src/geocoding/types.js";

const prefix = `geocoder-test:${randomUUID()}`;
function provider(suffix: string, overrides = {}): GeocoderProvider {
  return { id: suffix, cacheId: `${prefix}:${suffix}`, budgetId: `${prefix}:${suffix}`, sources: [suffix],
    typicalAccuracy: "point", costPerCall: 0, dailyCap: 3, ratePerSecond: 1e9, storable: true,
    geocode: async () => null, ...overrides };
}
beforeAll(async () => {
  const [row] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (!row.name.endsWith("_test")) throw new Error("Geocoding storage tests require a *_test database");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => {
  await db.execute(sql`delete from geocoder_usage where provider like ${`${prefix}%`}`);
  await db.execute(sql`delete from geocode_results where provider like ${`${prefix}%`}`);
  await client.end();
});

describe("shared geocoder quotas", () => {
  it("never exceeds a daily cap under concurrent reservations", async () => {
    const p = provider("concurrent");
    const reservations = await Promise.all(Array.from({ length: 30 }, () => budget.reserve(p)));
    expect(reservations.filter(Boolean)).toHaveLength(3);
    const [row] = await db.execute<{ calls: number }>(sql`select calls from geocoder_usage where provider = ${p.budgetId}`);
    expect(row.calls).toBe(3);
  });
  it("shares per-second spacing across callers", async () => {
    const p = provider("spacing", { dailyCap: 100, ratePerSecond: 0.01 });
    expect(await budget.reserve(p)).toBe(true);
    expect(await budget.reserve(p)).toBe(false);
  });
  it("queues calls that arrive together instead of skipping the provider", async () => {
    const p = provider("queue", { dailyCap: 100, ratePerSecond: 5 });
    const started = Date.now();
    const finished: number[] = [];
    const reservations = await Promise.all([0, 1].map(async () => {
      const ok = await budget.reserve(p);
      finished.push(Date.now() - started);
      return ok;
    }));
    expect(reservations).toEqual([true, true]);
    expect(Math.max(...finished)).toBeGreaterThanOrEqual(150);
  });
  it("does not send a first call when the cap is zero", async () => {
    expect(await budget.reserve(provider("zero", { dailyCap: 0 }))).toBe(false);
  });
  it("read-only mode makes no usage writes", async () => {
    vi.stubEnv("OPENTAXRATE_GEOCODE_READ_ONLY", "true");
    const p = provider("readonly");
    expect(await budget.reserve(p)).toBe(false);
    expect(await db.execute(sql`select 1 from geocoder_usage where provider = ${p.budgetId}`)).toHaveLength(0);
  });
  it.each([429, 503])("opens the breaker after quota or repeated failure (%s)", async status => {
    const p = provider(`breaker-${status}`, { dailyCap: 100 });
    for (let i = 0; i < (status === 429 ? 1 : 5); i++) budget.failure(p, new GeocoderError(status));
    expect(await budget.reserve(p)).toBe(false);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    expect(await budget.reserve(p)).toBe(true);
    expect(await budget.reserve(p)).toBe(false);
    budget.success(p);
    expect(await budget.reserve(p)).toBe(true);
  });
});

describe("persistent geocoding cache", () => {
  it("distinguishes a negative hit from a miss, and expires stale rows", async () => {
    const p = provider("negative");
    expect(await cache.get("address", p.cacheId)).toBeUndefined();
    await cache.put("address", p.cacheId, null);
    expect(await cache.get("address", p.cacheId)).toBeNull();
    await db.execute(sql`update geocode_results set expires_at = now() - interval '1 second' where provider = ${p.cacheId}`);
    expect(await cache.get("address", p.cacheId)).toBeUndefined();
  });
  it("upserts a provider result without touching other providers", async () => {
    const a = provider("cache-a"), b = provider("cache-b");
    const point = { provider: "cache-a", source: "osm", lon: -97, lat: 30, accuracy: "point" as const };
    await cache.put("address", a.cacheId, null);
    await cache.put("address", b.cacheId, null);
    await cache.put("address", a.cacheId, point);
    expect(await cache.get("address", a.cacheId)).toEqual(point);
    expect(await cache.get("address", b.cacheId)).toBeNull();
  });
});
