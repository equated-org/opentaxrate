/**
 * The HTTP API:
 *   GET /v1/rate?street=&city=&state=&zip=&date=  the rate at an address
 *   GET /v1/coverage                              each state's method and files
 *   GET /health                                   database reachable
 * A refusal is a 422 whose message names the candidate rates; missing data
 * is a 502. Read-only; loading data is the CLI's.
 */
import { Hono } from "hono";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "./db.js";
import { salesTaxDataReleases } from "./schema.js";
import { ADDRESS_RATE_STATES, addressRates } from "./engine/index.js";
import { RateError } from "./errors.js";
import { lookUpRate } from "./lookup.js";

const query = z.object({
  state: z.string().trim().length(2),
  street: z.string().trim().max(200).default(""),
  city: z.string().trim().max(100).default(""),
  zip: z.string().trim().regex(/^\d{5}(?:-?\d{4})?$/).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const app = new Hono();

app.get("/health", async (c) => {
  await db.execute(sql`select 1`);
  return c.json({ ok: true });
});

app.get("/v1/rate", async (c) => {
  const parsed = query.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "Give state (two letters), street, city, and optionally zip and date (YYYY-MM-DD).", code: "BAD_REQUEST" }, 400);
  try {
    return c.json(await lookUpRate(parsed.data));
  } catch (error) {
    if (!(error instanceof RateError)) throw error;
    return c.json({ error: error.message, code: error.code }, error.status);
  }
});

app.get("/v1/coverage", async (c) => {
  const releases = await db.select().from(salesTaxDataReleases);
  return c.json(
    ADDRESS_RATE_STATES.map((state) => ({
      state,
      method: addressRates.method(state),
      files: releases.filter((r) => r.state === state).map((r) => ({ kind: r.kind, file: r.file, rows: r.rows, loadedAt: r.loadedAt })),
    })),
  );
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "Internal error", code: "INTERNAL" }, 500);
});
