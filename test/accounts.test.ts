/**
 * Accounts end to end on the *_test database: sign in by an emailed code,
 * get the trial credit, create a key, and spend it. Connecticut answers from
 * its one statewide rate (no loaded data, no geocoder), so a lookup there is
 * an answered, charged one; "ZZ" is declined and refunded.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { db } from "../src/db/client.js";
import type { GeocodeBudget } from "../src/geocoding/budget.js";
import type { GeocoderProvider } from "../src/geocoding/types.js";

const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
if (!name.endsWith("_test")) throw new Error(`Account tests write users; run them on a *_test database, not ${name}.`);

const EMAIL = `dana+${Date.now()}@acme.test`;
const ORIGIN = "http://localhost:8080";
const PRICE = 1950;
let app: Hono;
let codes: string[] = [];
let cookie = "";
let userId = "";

const json = (body: unknown, extra: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", origin: ORIGIN, cookie, ...extra },
  body: JSON.stringify(body),
});
const credit = async () =>
  Number((await db.execute<{ c: string }>(sql`select credit_micros as c from "user" where id = ${userId}`))[0].c);
const rate = (key: string, q = "state=CT&street=1+Main+St&city=Hartford") => app.request(`/v1/rate?${q}`, { headers: { "x-api-key": key } });

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("BETTER_AUTH_URL", ORIGIN);
  vi.resetModules();
  const mail = await import("../src/mail.js");
  mail.setMailer(async (m) => {
    codes.push(/\b(\d{6})\b/.exec(m.text)![1]);
  });
  app = (await import("../src/server.js")).app as unknown as Hono;
});
afterAll(() => vi.unstubAllEnvs());

describe("an account", () => {
  it("signs in with an emailed code, verified, with its trial credit", async () => {
    const sent = await app.request("/api/auth/email-otp/send-verification-otp", json({ email: EMAIL, type: "sign-in" }));
    expect(sent.status).toBe(200);
    expect(codes).toHaveLength(1);
    const wrong = await app.request("/api/auth/sign-in/email-otp", json({ email: EMAIL, otp: codes[0] === "000000" ? "111111" : "000000" }));
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    const signedIn = await app.request("/api/auth/sign-in/email-otp", json({ email: EMAIL, otp: codes[0] }));
    expect(signedIn.status).toBe(200);
    cookie = signedIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const body = (await signedIn.json()) as { user: { id: string; emailVerified: boolean } };
    expect(body.user.emailVerified).toBe(true);
    userId = body.user.id;
    expect(await credit()).toBe(100 * PRICE);
    // Three lookups' worth, for the spending tests.
    await db.execute(sql`update "user" set credit_micros = ${3 * PRICE} where id = ${userId}`);
  });

  it("spends one lookup's price per answer, refunds declines, and stops at zero", async () => {
    const created = await app.request("/api/auth/api-key/create", json({ name: "production" }));
    expect(created.status).toBe(200);
    const { key } = (await created.json()) as { key: string };
    expect(key).toMatch(/^otr_live_/);

    const first = await rate(key);
    expect(first.status).toBe(200);
    expect(first.headers.get("x-opentaxrate-tier")).toBe("keyed");
    expect(first.headers.get("x-opentaxrate-cache")).toBe("miss");
    expect(await credit()).toBe(2 * PRICE);

    const again = await rate(key);
    expect(again.headers.get("x-opentaxrate-cache")).toBe("hit");
    expect(await again.json()).toEqual(await (await rate(key, "state=CT&street=1%20MAIN%20ST.&city=hartford")).json());
    // A traced lookup is answered fresh and stored without its trace.
    await db.execute(sql`update "user" set credit_micros = credit_micros + ${PRICE} where id = ${userId}`);
    const traced = await rate(key, "state=CT&street=1+Main+St&city=Hartford&include=trace");
    expect(traced.headers.get("x-opentaxrate-cache")).toBe("miss");
    expect(await traced.json()).toHaveProperty("trace");
    const [stored] = await db.execute<{ r: Record<string, unknown> }>(
      sql`select response as r from api_requests where user_id = ${userId} and answer_key like '%|trace' order by id desc limit 1`);
    expect(stored.r).not.toHaveProperty("trace");
    expect(await credit()).toBe(0);

    const declined = await rate(key, "state=ZZ&street=1+Main+St&city=Nowhere");
    expect(declined.status).toBe(402); // out of credit before it's asked
    await db.execute(sql`update "user" set credit_micros = ${PRICE} where id = ${userId}`);
    expect((await rate(key, "state=ZZ&street=1+Main+St&city=Nowhere")).status).toBe(422);
    expect(await credit()).toBe(PRICE);

    // Keyless still works at $0.
    await db.execute(sql`update "user" set credit_micros = 0 where id = ${userId}`);
    expect((await app.request("/v1/rate?state=CT&street=1+Main+St&city=Hartford")).status).toBe(200);
    expect((await rate(key)).status).toBe(402);
  });

  it("answers exactly as many concurrent lookups as the credit covers", async () => {
    const { key } = (await (await app.request("/api/auth/api-key/create", json({ name: "load" }))).json()) as { key: string };
    await db.execute(sql`update "user" set credit_micros = ${5 * PRICE} where id = ${userId}`);
    const statuses = await Promise.all(
      Array.from({ length: 30 }, (_, i) => rate(key, `state=CT&street=${i + 10}+Elm+St&city=Hartford`).then((r) => r.status)),
    );
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.filter((s) => s === 402)).toHaveLength(25);
    expect(await credit()).toBe(0);
  });

  it("shows its history and this month's totals, by session only", async () => {
    const summary = await app.request("/v1/account/summary", { headers: { cookie } });
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ email: EMAIL, priceMicros: PRICE, month: { declined: 1 } });
    const history = (await (await app.request("/v1/account/requests?result=declined", { headers: { cookie } })).json()) as {
      requests: Array<{ status: number; chargedMicros: number }>;
    };
    expect(history.requests).toHaveLength(1);
    expect(history.requests[0]).toMatchObject({ status: 422, chargedMicros: 0 });
    expect((await app.request("/v1/account/summary")).status).toBe(401);
  });

  it("is refused for a deleted key", async () => {
    const { key, id } = (await (await app.request("/api/auth/api-key/create", json({ name: "gone" }))).json()) as { key: string; id: string };
    expect((await app.request("/api/auth/api-key/delete", json({ keyId: id }))).status).toBe(200);
    expect((await rate(key)).status).toBe(401);
  });
});

describe("the geocoder allowance", () => {
  const provider = (id: string, price: number) => ({ id, costPerCall: price, pricePerCall: price }) as GeocoderProvider;
  const base: GeocodeBudget = { reserve: async () => true, success: () => {}, failure: () => {} };

  it("pays a paid provider only while it covers the list price, and free ones always", async () => {
    const { accountBudget, charge } = await import("../src/credits.js");
    await db.execute(sql`update "user" set credit_micros = ${PRICE}, geo_allowance_micros = 0 where id = ${userId}`);
    expect(await charge(userId, PRICE)).toBe(true); // adds 80%: 1,560 µ$
    const budget = accountBudget(userId, base);
    expect(await budget.reserve(provider("google", 0.005))).toBe(false);
    expect(await budget.reserve(provider("census", 0))).toBe(true);
    expect(await budget.reserve(provider("geocodio", 0.001))).toBe(true);
    expect(await budget.reserve(provider("mapbox", 0.00075))).toBe(false); // 560 left
    expect(budget.paid).toEqual(["geocodio"]);
    expect(budget.spentMicros).toBe(1000);
  });
});
