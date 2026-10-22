/**
 * Prepaid credit: what a lookup with an account's key costs, and the rule
 * that no account costs more in paid geocoders than it pays.
 *
 * Amounts are millionths of a dollar (µ$), so one lookup at $1.95 per 1,000
 * is the whole number 1,950. An answered lookup is charged; a declined or
 * failed one is refunded. Each charge also adds GEO_SHARE of itself to the
 * account's geocoder allowance, and a paid provider (or the Geocodio
 * standardizer, or Jev) is asked only when the allowance covers its list
 * price, which then comes out of it. The rest of each charge covers Stripe's
 * fee and hosting.
 */
import { sql } from "drizzle-orm";
import { db } from "./db/client.js";
import { creditGrants } from "./db/schema.js";
import { postgresGeocodeBudget, type GeocodeBudget } from "./geocoding/budget.js";
import type { GeocoderProvider } from "./geocoding/types.js";

/** Share of each charge an account may spend on paid geocoders. */
export const GEO_SHARE = 0.8;
/** Jev's list price per pick: about $0.12 per 1,000. */
export const JEV_PRICE = 0.00012;

/** One lookup's price in µ$: $1.95 per 1,000. */
export const PRICE_MICROS = 1950;
/** Lookups a new account starts with. */
export const TRIAL_LOOKUPS = 100;

export const toMicros = (dollars: number) => Math.round(dollars * 1_000_000);

/** A new account's trial credit. */
export async function grantTrial(userId: string) {
  await addCredit(userId, "trial", TRIAL_LOOKUPS * PRICE_MICROS);
}

/** Adds credit, once per Stripe id when one is given. Returns false when
 *  that id was credited already. */
export async function addCredit(
  userId: string,
  kind: "trial" | "purchase" | "refund" | "adjust",
  micros: number,
  stripeId?: string,
  /** A transaction to run in, for a caller that read first (a refund). */
  within?: Transaction,
): Promise<boolean> {
  const run = async (tx: Transaction) => {
    const inserted = await tx
      .insert(creditGrants)
      .values({ userId, kind, micros, stripeId })
      .onConflictDoNothing({ target: creditGrants.stripeId })
      .returning({ id: creditGrants.id });
    if (!inserted.length) return false;
    await tx.execute(sql`update "user" set credit_micros = credit_micros + ${micros} where id = ${userId}`);
    return true;
  };
  return within ? run(within) : db.transaction(run);
}

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Takes one lookup's price from the account, and grows its allowance.
 *  False when the credit doesn't cover it. */
export async function charge(userId: string, price = PRICE_MICROS): Promise<boolean> {
  const rows = await db.execute(sql`
    update "user" set credit_micros = credit_micros - ${price},
      geo_allowance_micros = geo_allowance_micros + ${Math.floor(price * GEO_SHARE)}
    where id = ${userId} and credit_micros >= ${price}
    returning id`);
  return rows.length > 0;
}

/** Undoes charge() for a lookup that didn't answer. The allowance may go
 *  below zero if it was spent; paid providers wait until it recovers. */
export async function refund(userId: string, price = PRICE_MICROS) {
  await db.execute(sql`
    update "user" set credit_micros = credit_micros + ${price},
      geo_allowance_micros = geo_allowance_micros - ${Math.floor(price * GEO_SHARE)}
    where id = ${userId}`);
}

/** Takes `micros` from the allowance if it covers them. */
async function spendAllowance(userId: string, micros: number): Promise<boolean> {
  if (micros <= 0) return true;
  const rows = await db.execute(sql`
    update "user" set geo_allowance_micros = geo_allowance_micros - ${micros}
    where id = ${userId} and geo_allowance_micros >= ${micros}
    returning id`);
  return rows.length > 0;
}

async function returnAllowance(userId: string, micros: number) {
  if (micros > 0)
    await db.execute(sql`update "user" set geo_allowance_micros = geo_allowance_micros + ${micros} where id = ${userId}`);
}

/** A lookup's spending on paid services: the allowance first, then the
 *  vendor's shared cap. Records what was spent and on whom. */
export interface AccountBudget extends GeocodeBudget {
  /** Pays for one call of `micros` outside the geocoders (Jev). */
  spend(what: string, micros: number): Promise<boolean>;
  readonly spentMicros: number;
  readonly paid: string[];
}

export function accountBudget(userId: string, base: GeocodeBudget = postgresGeocodeBudget): AccountBudget {
  let spentMicros = 0;
  const paid: string[] = [];
  const price = (p: GeocoderProvider) => toMicros(p.pricePerCall ?? p.costPerCall);
  return {
    async reserve(p) {
      const micros = price(p);
      if (!(await spendAllowance(userId, micros))) return false;
      if (!(await base.reserve(p))) {
        await returnAllowance(userId, micros);
        return false;
      }
      if (micros > 0) {
        spentMicros += micros;
        paid.push(p.id);
      }
      return true;
    },
    success: (p) => base.success(p),
    failure: (p, error) => base.failure(p, error),
    async spend(what, micros) {
      if (!(await spendAllowance(userId, micros))) return false;
      spentMicros += micros;
      paid.push(what);
      return true;
    },
    get spentMicros() {
      return spentMicros;
    },
    get paid() {
      return paid;
    },
  };
}

/** A master key's spending: no allowance, only the vendors' caps, but the
 *  same record of what was spent. */
export function meteredBudget(base: GeocodeBudget = postgresGeocodeBudget): AccountBudget {
  let spentMicros = 0;
  const paid: string[] = [];
  return {
    async reserve(p) {
      if (!(await base.reserve(p))) return false;
      const micros = toMicros(p.pricePerCall ?? p.costPerCall);
      if (micros > 0) {
        spentMicros += micros;
        paid.push(p.id);
      }
      return true;
    },
    success: (p) => base.success(p),
    failure: (p, error) => base.failure(p, error),
    async spend(what, micros) {
      spentMicros += micros;
      paid.push(what);
      return true;
    },
    get spentMicros() {
      return spentMicros;
    },
    get paid() {
      return paid;
    },
  };
}
