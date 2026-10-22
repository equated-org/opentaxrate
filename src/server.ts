/**
 * The HTTP API:
 *   GET /v1/rate?street=&city=&state=&zip=&date=  the rate at an address
 *       &include=trace                            ...and how it was placed
 *   GET /v1/coverage                              each state's method and files
 *   GET /v1/suggest?q=                            address suggestions (suggest.ts)
 *   GET /health                                   database reachable
 * With accounts on (BETTER_AUTH_SECRET, auth.ts):
 *   GET|POST /api/auth/*                          sign-in by code, sessions, API keys
 *   GET /v1/account/summary                       credit and this month's lookups
 *   GET /v1/account/requests                      history (requests.ts)
 * A refusal is a 422 whose message names the candidate rates; missing data
 * is a 502. Runtime writes are limited to the geocoding cache and budgets;
 * loading tax data is the CLI's.
 *
 * Who is asking decides which outside services a lookup may use (access.ts):
 * no key is the public tier (OPENTAXRATE_PUBLIC_PROVIDERS), a master key
 * from OPENTAXRATE_MASTER_KEYS or an account's key is the keyed tier, any
 * other key is a 401. Every answer says which in X-OpenTaxRate-Tier. A keyed
 * lookup is charged to the account's credit (refunded unless it answers),
 * answered from the caller's own recent answers when it can (X-OpenTaxRate-
 * Cache), and logged in api_requests.
 *
 * For a public deployment, each off unless set: CORS for the origins in
 * OPENTAXRATE_CORS_ORIGINS, a per-IP limit on /v1/rate
 * (OPENTAXRATE_PUBLIC_LIMIT, limits.ts) for the public tier, a cache of
 * public answers (OPENTAXRATE_CACHE_HOURS, cache.ts), and suggestions
 * relayed to a Photon (OPENTAXRATE_PHOTON_URL, with
 * OPENTAXRATE_SUGGEST_LIMIT).
 */
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "./db/client.js";
import { salesTaxDataReleases } from "./db/schema.js";
import { ADDRESS_RATE_STATES, addressRates, emptyTrace, type AddressRate, type Trace } from "./rates/index.js";
import { RateError } from "./errors.js";
import { lookUpRate } from "./lookup.js";
import { limitFromEnv } from "./limits.js";
import { answerKey, cacheFromEnv } from "./cache.js";
import { geocoderCoverage } from "./geocoding/registry.js";
import { suggestFromEnv } from "./suggest.js";
import { policyFor, resolveAccess, type Access, type AccessVariables } from "./access.js";
import { authFromEnv } from "./auth.js";
import { accountBudget, charge, meteredBudget, PRICE_MICROS, refund } from "./credits.js";
import { cachedAnswer, historyFor, logRequest, monthTotals, pruneRequests, type Caller } from "./requests.js";
import { user } from "./db/auth-schema.js";
import { eq } from "drizzle-orm";

const query = z.object({
  state: z.string().trim().length(2),
  street: z.string().trim().max(200).default(""),
  city: z.string().trim().max(100).default(""),
  zip: z.string().trim().regex(/^\d{5}(?:-?\d{4})?$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Comma-separated extras; only "trace" is known, others are ignored. */
  include: z.string().max(100).optional(),
});

export const app = new Hono<{ Variables: AccessVariables }>();

const origins = (process.env.OPENTAXRATE_CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
if (origins.length)
  app.use("*", cors({ origin: origins, allowMethods: ["GET", "HEAD", "OPTIONS"], exposeHeaders: ["Retry-After", "X-OpenTaxRate-Tier"], maxAge: 600 }));

const auth = authFromEnv();
if (auth) app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Before the limits: a keyed caller isn't counted by IP.
const access = resolveAccess(process.env, auth);
app.use("/v1/rate", access);
app.use("/v1/coverage", access);

const limit = limitFromEnv();
if (limit) app.use("/v1/rate", (c, next) => (c.var.access.tier === "public" ? limit(c, next) : next()));

const suggest = suggestFromEnv();
if (suggest) {
  const suggestLimit = limitFromEnv(process.env, "OPENTAXRATE_SUGGEST_LIMIT");
  if (suggestLimit) app.use("/v1/suggest", suggestLimit);
  app.get("/v1/suggest", suggest);
}

const answers = cacheFromEnv<AddressRate | (AddressRate & { trace: Trace })>();

app.get("/health", async (c) => {
  await db.execute(sql`select 1`);
  return c.json({ ok: true });
});

app.get("/v1/rate", async (c) => {
  const parsed = query.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "Give state (two letters), street, city, and optionally zip and date (YYYY-MM-DD).", code: "BAD_REQUEST" }, 400);
  const { include: includeParam, ...q } = parsed.data;
  const include = (includeParam ?? "").split(",").map((s) => s.trim()).filter((s) => s === "trace");
  const trace = include.length ? emptyTrace() : undefined;
  const date = q.date ?? new Date().toISOString().slice(0, 10);
  c.header("X-OpenTaxRate-Tier", c.var.access.tier);
  if (c.var.access.tier === "keyed") return keyedLookup(c, c.var.access, { ...q, date }, include, trace);
  // The in-memory cache holds public answers only, so a free caller never
  // gets one that paid providers placed.
  const key = answers && c.var.access.tier === "public" ? answerKey({ ...q, date }, include) : undefined;
  const cached = key ? answers!.get(key) : undefined;
  if (cached) return c.json(cached);
  try {
    const rate = await lookUpRate({ ...q, date }, { trace, policy: policyFor(c.var.access) });
    const answer = trace ? { ...rate, trace } : rate;
    if (key) answers!.set(key, answer);
    return c.json(answer);
  } catch (error) {
    if (!(error instanceof RateError)) throw error;
    if (trace && error.status === 422) return c.json({ error: error.message, code: error.code, trace }, 422);
    return c.json({ error: error.message, code: error.code }, error.status);
  }
});

type Query = z.infer<typeof query> & { date: string };

/** A lookup with a key: charged, answered from the caller's own recent
 *  answers when it can, and logged. */
async function keyedLookup(
  c: Context<{ Variables: AccessVariables }>,
  a: Access,
  q: Omit<Query, "include">,
  include: string[],
  trace?: Trace,
) {
  const started = Date.now();
  const caller: Caller = a.userId ? { userId: a.userId, keyId: a.keyId! } : { userId: null, keyId: `master:${a.master}` };
  const price = a.userId ? PRICE_MICROS : 0;
  if (a.userId && !(await charge(a.userId, price)))
    return c.json(
      { error: "This account is out of credit. Add credit in the dashboard, or leave the key off to use the free tier.", code: "NO_CREDITS" },
      402,
    );
  const key = answerKey(q, include);
  const logged = { answerKey: key, query: Object.fromEntries(Object.entries({ ...q, include: include.join(",") }).filter(([, v]) => v)) as Record<string, string> };
  // Only the tax answer is kept: a traced lookup (geocoders' points,
  // outlines) is never stored, so it's never answered from history either.
  let hit: unknown;
  try {
    hit = trace ? undefined : await cachedAnswer(caller, key);
    if (hit !== undefined)
      await logRequest(caller, { ...logged, status: 200, response: hit, cached: true, providers: [], chargedMicros: price, geoCostMicros: 0, ms: Date.now() - started });
  } catch (error) {
    // Charged above; a lookup that can't be answered or logged isn't.
    if (a.userId) await refund(a.userId, price);
    throw error;
  }
  if (hit !== undefined) {
    c.header("X-OpenTaxRate-Cache", "hit");
    return c.json(hit as object);
  }
  c.header("X-OpenTaxRate-Cache", "miss");
  const budget = a.userId ? accountBudget(a.userId) : meteredBudget();
  const done = (status: number, response: unknown, charged: number) =>
    logRequest(caller, { ...logged, status, response, cached: false, providers: budget.paid, chargedMicros: charged, geoCostMicros: budget.spentMicros, ms: Date.now() - started });
  try {
    const rate = await lookUpRate(q, { trace, policy: policyFor(a), budget });
    const answer = trace ? { ...rate, trace } : rate;
    await done(200, rate, price);
    return c.json(answer);
  } catch (error) {
    if (a.userId) await refund(a.userId, price);
    if (!(error instanceof RateError)) {
      await done(500, { code: "INTERNAL" }, 0).catch(() => {});
      throw error;
    }
    const body = trace && error.status === 422 ? { error: error.message, code: error.code, trace } : { error: error.message, code: error.code };
    await done(error.status, { error: error.message, code: error.code }, 0);
    return c.json(body, error.status);
  }
}

if (auth) {
  // The dashboard's reads, by session cookie.
  app.use("/v1/account/*", async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: "Sign in first.", code: "SIGNED_OUT" }, 401);
    c.set("access", { tier: "keyed", userId: session.user.id });
    return next();
  });

  app.get("/v1/account/summary", async (c) => {
    const userId = c.var.access.userId!;
    const [account] = await db.select({ email: user.email, creditMicros: user.creditMicros }).from(user).where(eq(user.id, userId));
    const price = PRICE_MICROS;
    const month = await monthTotals(userId);
    return c.json({
      email: account.email,
      creditMicros: account.creditMicros,
      priceMicros: price,
      lookupsLeft: Math.max(0, Math.floor(account.creditMicros / price)),
      month: month.total,
      lookupsByKey: month.byKey,
    });
  });

  const history = z.object({
    before: z.coerce.number().int().positive().optional(),
    key: z.string().max(100).optional(),
    result: z.enum(["rate", "declined", "error"]).optional(),
    q: z.string().max(100).optional(),
  });
  app.get("/v1/account/requests", async (c) => {
    const f = history.safeParse(c.req.query());
    if (!f.success) return c.json({ error: "Bad filter.", code: "BAD_REQUEST" }, 400);
    const rows = await historyFor(c.var.access.userId!, { before: f.data.before, keyId: f.data.key, result: f.data.result, search: f.data.q });
    return c.json({ requests: rows, next: rows.length === 50 ? rows.at(-1)!.id : null });
  });
}

// Requests past retention, daily; never keeps the process alive.
const prune = () => pruneRequests().catch((error) => console.error(error));
setTimeout(prune, 60_000).unref();
setInterval(prune, 86_400_000).unref();

app.get("/v1/coverage", async (c) => {
  const releases = await db.select().from(salesTaxDataReleases);
  return c.json(
    ADDRESS_RATE_STATES.map((state) => ({
      state,
      method: addressRates.method(state),
      geocoders: geocoderCoverage(policyFor(c.var.access)),
      files: releases.filter((r) => r.state === state).map((r) => ({ kind: r.kind, file: r.file, rows: r.rows, loadedAt: r.loadedAt })),
    })),
  );
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "Internal error", code: "INTERNAL" }, 500);
});
