import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { GeocoderError, type GeocoderProvider } from "./types.js";

export interface GeocodeBudget {
  reserve(provider: GeocoderProvider): Promise<boolean>;
  success(provider: GeocoderProvider): void;
  failure(provider: GeocoderProvider, error: unknown): void;
}
const breakers = new Map<string, { errors: number; until: number; trial: boolean }>();

/** Calls further out than this in a provider's queue are skipped rather than waited for. */
const MAX_WAIT_MS = 2_000;

/** Both quotas and request spacing are atomic across all API replicas: each
 * call takes the provider's next free slot and waits for it, so lookups that
 * arrive together queue briefly instead of skipping a provider. Reserved
 * calls are never refunded: timeouts may already have been billed. */
export const postgresGeocodeBudget: GeocodeBudget = {
  async reserve(p) {
    if (process.env.OPENTAXRATE_GEOCODE_READ_ONLY === "true" || !p.dailyCap || !p.ratePerSecond) return false;
    const breaker = breakers.get(p.budgetId);
    if (breaker && (breaker.until > Date.now() || breaker.trial)) return false;
    if (breaker?.until) breaker.trial = true;
    const gap = 1000 / p.ratePerSecond;
    try {
      const rows = await db.execute<{ wait_ms: number }>(sql`
        insert into geocoder_usage (provider, day, calls, next_call_at)
        values (${p.budgetId}, (now() at time zone 'UTC')::date, 1, now() + ${gap} * interval '1 millisecond')
        on conflict (provider, day) do update set
          calls = geocoder_usage.calls + 1,
          next_call_at = greatest(geocoder_usage.next_call_at, now()) + ${gap} * interval '1 millisecond'
        where geocoder_usage.calls < ${p.dailyCap}
          and geocoder_usage.next_call_at <= now() + ${MAX_WAIT_MS} * interval '1 millisecond'
        returning greatest(0, extract(epoch from next_call_at - now()) * 1000 - ${gap})::float8 as wait_ms`);
      if (!rows.length) {
        if (breaker) breaker.trial = false;
        return false;
      }
      const wait = Number(rows[0].wait_ms);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      return true;
    } catch {
      if (breaker) breaker.trial = false;
      return false; // No reservation, no call, including on a missing migration.
    }
  },
  success(p) { breakers.delete(p.budgetId); },
  failure(p, error) {
    const prior = breakers.get(p.budgetId);
    const errors = (prior?.errors ?? 0) + 1;
    const open = errors >= 5 || (error instanceof GeocoderError && error.status === 429) || prior?.trial;
    breakers.set(p.budgetId, { errors, until: open ? Date.now() + 60_000 : 0, trial: false });
  },
};
