/**
 * The HTTP API:
 *   GET /v1/rate?street=&city=&state=&zip=&date=  the rate at an address
 *       &include=trace                            ...and how it was placed
 *   GET /v1/coverage                              each state's method and files
 *   GET /v1/suggest?q=                            address suggestions (suggest.ts)
 *   GET /health                                   database reachable
 * A refusal is a 422 whose message names the candidate rates; missing data
 * is a 502. Runtime writes are limited to the geocoding cache and budgets;
 * loading tax data is the CLI's.
 *
 * For a public deployment, each off unless set: CORS for the origins in
 * OPENTAXRATE_CORS_ORIGINS, a per-IP limit on /v1/rate
 * (OPENTAXRATE_PUBLIC_LIMIT, limits.ts), an answer cache
 * (OPENTAXRATE_CACHE_HOURS, cache.ts), and suggestions relayed to a Photon
 * (OPENTAXRATE_PHOTON_URL, with OPENTAXRATE_SUGGEST_LIMIT).
 */
import { Hono } from "hono";
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

const query = z.object({
  state: z.string().trim().length(2),
  street: z.string().trim().max(200).default(""),
  city: z.string().trim().max(100).default(""),
  zip: z.string().trim().regex(/^\d{5}(?:-?\d{4})?$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Comma-separated extras; only "trace" is known, others are ignored. */
  include: z.string().max(100).optional(),
});

export const app = new Hono();

const origins = (process.env.OPENTAXRATE_CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
if (origins.length)
  app.use("*", cors({ origin: origins, allowMethods: ["GET", "HEAD", "OPTIONS"], exposeHeaders: ["Retry-After"], maxAge: 600 }));

const limit = limitFromEnv();
if (limit) app.use("/v1/rate", limit);

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
  const key = answers && answerKey({ ...q, date }, include);
  const cached = key ? answers!.get(key) : undefined;
  if (cached) return c.json(cached);
  try {
    const rate = await lookUpRate({ ...q, date }, { trace });
    const answer = trace ? { ...rate, trace } : rate;
    if (key) answers!.set(key, answer);
    return c.json(answer);
  } catch (error) {
    if (!(error instanceof RateError)) throw error;
    if (trace && error.status === 422) return c.json({ error: error.message, code: error.code, trace }, 422);
    return c.json({ error: error.message, code: error.code }, error.status);
  }
});

app.get("/v1/coverage", async (c) => {
  const releases = await db.select().from(salesTaxDataReleases);
  return c.json(
    ADDRESS_RATE_STATES.map((state) => ({
      state,
      method: addressRates.method(state),
      geocoders: geocoderCoverage(),
      files: releases.filter((r) => r.state === state).map((r) => ({ kind: r.kind, file: r.file, rows: r.rows, loadedAt: r.loadedAt })),
    })),
  );
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "Internal error", code: "INTERNAL" }, 500);
});
