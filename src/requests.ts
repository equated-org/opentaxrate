/**
 * api_requests, the one table behind a key's lookups: each is logged here
 * with the tax answer only (never a trace's geocoder points), a repeat
 * within CACHE_HOURS is answered from the
 * caller's own last answer here, and the dashboard reads its history and
 * the month's totals from here. Rows are kept RETENTION_DAYS.
 *
 * The caller is an account (user_id, shared by all its keys) or a master
 * key (user_id null, key_id "master:<name>").
 */
import { and, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db } from "./db/client.js";
import { apiRequests } from "./db/schema.js";

export const RETENTION_DAYS = 90;

export interface Caller {
  userId: string | null;
  keyId: string;
}

/** How long a caller's repeat lookup is answered from its own history. */
export const CACHE_HOURS = 24;

const owner = (c: Caller) => (c.userId ? eq(apiRequests.userId, c.userId) : and(isNull(apiRequests.userId), eq(apiRequests.keyId, c.keyId))!);

/** The caller's last answer to the same lookup, if recent enough. */
export async function cachedAnswer(caller: Caller, answerKey: string): Promise<unknown | undefined> {
  const [row] = await db
    .select({ response: apiRequests.response })
    .from(apiRequests)
    .where(
      and(
        owner(caller),
        eq(apiRequests.answerKey, answerKey),
        eq(apiRequests.status, 200),
        gte(apiRequests.at, sql`now() - make_interval(hours => ${CACHE_HOURS})`),
      ),
    )
    .orderBy(desc(apiRequests.at))
    .limit(1);
  return row?.response;
}

export interface LoggedRequest {
  answerKey: string;
  query: Record<string, string>;
  status: number;
  response: unknown;
  cached: boolean;
  providers: string[];
  chargedMicros: number;
  geoCostMicros: number;
  ms: number;
}

export async function logRequest(caller: Caller, r: LoggedRequest) {
  await db.insert(apiRequests).values({ userId: caller.userId, keyId: caller.keyId, ...r });
}

export interface HistoryFilter {
  /** Rows older than this id, for the next page. */
  before?: number;
  keyId?: string;
  result?: "rate" | "declined" | "error";
  /** Text in the street or city. */
  search?: string;
  limit?: number;
}

export async function historyFor(userId: string, f: HistoryFilter = {}) {
  const where: SQL[] = [eq(apiRequests.userId, userId)];
  if (f.before) where.push(lt(apiRequests.id, f.before));
  if (f.keyId) where.push(eq(apiRequests.keyId, f.keyId));
  if (f.result === "rate") where.push(eq(apiRequests.status, 200));
  if (f.result === "declined") where.push(eq(apiRequests.status, 422));
  if (f.result === "error") where.push(sql`${apiRequests.status} not in (200, 422)`);
  if (f.search?.trim()) {
    const like = `%${f.search.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    where.push(sql`(${apiRequests.query}->>'street' ilike ${like} or ${apiRequests.query}->>'city' ilike ${like})`);
  }
  return db
    .select({
      id: apiRequests.id,
      at: apiRequests.at,
      keyId: apiRequests.keyId,
      query: apiRequests.query,
      status: apiRequests.status,
      response: apiRequests.response,
      cached: apiRequests.cached,
      providers: apiRequests.providers,
      chargedMicros: apiRequests.chargedMicros,
      ms: apiRequests.ms,
    })
    .from(apiRequests)
    .where(and(...where))
    .orderBy(desc(apiRequests.id))
    .limit(Math.min(f.limit ?? 50, 100));
}

/** This calendar month (UTC) so far, in all and per key. */
export async function monthTotals(userId: string) {
  const rows = await db
    .select({
      keyId: apiRequests.keyId,
      lookups: sql<number>`count(*)::int`,
      charged: sql<number>`count(*) filter (where ${apiRequests.chargedMicros} > 0)::int`,
      declined: sql<number>`count(*) filter (where ${apiRequests.status} = 422)::int`,
      chargedMicros: sql<number>`coalesce(sum(${apiRequests.chargedMicros}), 0)::bigint`,
    })
    .from(apiRequests)
    .where(and(eq(apiRequests.userId, userId), gte(apiRequests.at, sql`date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'`)))
    .groupBy(apiRequests.keyId);
  const total = { lookups: 0, charged: 0, declined: 0, chargedMicros: 0 };
  for (const r of rows) {
    total.lookups += r.lookups;
    total.charged += r.charged;
    total.declined += r.declined;
    total.chargedMicros += Number(r.chargedMicros);
  }
  return { total, byKey: Object.fromEntries(rows.map((r) => [r.keyId, r.lookups])) };
}

/** Deletes rows past retention; returns how many. */
export async function pruneRequests(): Promise<number> {
  const gone = await db.execute(sql`delete from api_requests where at < now() - make_interval(days => ${RETENTION_DAYS})`);
  return gone.count ?? 0;
}
