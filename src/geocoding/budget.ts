import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { GeocoderError, type GeocoderProvider } from "./types.js";

export interface GeocodeBudget {
  reserve(provider: GeocoderProvider): Promise<boolean>;
  success(provider: GeocoderProvider): void;
  failure(provider: GeocoderProvider, error: unknown): void;
}
const breakers = new Map<string, { errors: number; until: number; trial: boolean }>();

/** Both quotas and minimum request spacing are atomic across all API replicas.
 * Reserved calls are never refunded: timeouts may already have been billed. */
export const postgresGeocodeBudget: GeocodeBudget = {
  async reserve(p) {
    if (process.env.OPENTAXRATE_GEOCODE_READ_ONLY === "true" || !p.dailyCap || !p.ratePerSecond) return false;
    const breaker = breakers.get(p.budgetId);
    if (breaker && (breaker.until > Date.now() || breaker.trial)) return false;
    if (breaker?.until) breaker.trial = true;
    try {
      const rows = await db.execute(sql`
        insert into geocoder_usage (provider, day, calls, next_call_at)
        values (${p.budgetId}, (now() at time zone 'UTC')::date, 1,
          now() + ${1000 / p.ratePerSecond} * interval '1 millisecond')
        on conflict (provider, day) do update set
          calls = geocoder_usage.calls + 1,
          next_call_at = now() + ${1000 / p.ratePerSecond} * interval '1 millisecond'
        where geocoder_usage.calls < ${p.dailyCap} and geocoder_usage.next_call_at <= now()
        returning calls`);
      if (!rows.length && breaker) breaker.trial = false;
      return rows.length > 0;
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
