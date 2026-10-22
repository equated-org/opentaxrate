/**
 * Checkout creation and polling confirmation, using an offline Stripe client.
 * Needs the *_test database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { db } from "../src/db/client.js";

const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
if (!name.endsWith("_test")) throw new Error(`Billing tests write users; run them on a *_test database, not ${name}.`);

const userId = `usr_billing_${Date.now()}`;
let app: Hono;

const credit = async () => Number((await db.execute<{ c: string }>(sql`select credit_micros as c from "user" where id = ${userId}`))[0].c);

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_offline");
  vi.resetModules();
  app = (await import("../src/server.js")).app as unknown as Hono;
  await db.execute(sql`insert into "user" (id, name, email, email_verified) values (${userId}, '', ${`${userId}@acme.test`}, true)`);
});
afterAll(() => vi.unstubAllEnvs());

describe("account checkout", () => {
  it("refuses to start Checkout signed out", async () => {
    // Signed out: the account routes refuse before any amount is read.
    expect((await app.request("/v1/account/checkout", { method: "POST", body: JSON.stringify({ amount: 1000 }) })).status).toBe(401);
  });
});

describe("Checkout", () => {
  it("returns to the page's origin when it's one of ours, else the dashboard's", async () => {
    const { createBilling } = await import("../src/billing.js");
    const sent: Array<{ success_url: string; cancel_url: string }> = [];
    const fake = {
      customers: { create: async () => ({ id: `cus_fake_${userId}` }) },
      checkout: { sessions: { create: async (p: { success_url: string; cancel_url: string }) => (sent.push(p), { url: "https://checkout.stripe.com/x" }) } },
    } as unknown as Stripe;
    const billing = createBilling(fake, ["https://opentaxrate.com", "http://localhost:5174"]);
    await billing.createCheckout(userId, 1000, "http://localhost:5174");
    await billing.createCheckout(userId, 1000, "https://evil.example");
    await billing.createCheckout(userId, 1000);
    expect(sent.map((p) => p.success_url)).toEqual([
      "http://localhost:5174/dashboard?paid={CHECKOUT_SESSION_ID}",
      "https://opentaxrate.com/dashboard?paid={CHECKOUT_SESSION_ID}",
      "https://opentaxrate.com/dashboard?paid={CHECKOUT_SESSION_ID}",
    ]);
    expect(sent[0].cancel_url).toBe("http://localhost:5174/dashboard");
  });

  it("takes whole dollars from $5 to $1,000", async () => {
    const { validTopUp } = await import("../src/billing.js");
    expect([500, 1000, 1700, 100_000].every(validTopUp)).toBe(true);
    expect([0, 400, 550, 100_100, 1000.5, NaN].some(validTopUp)).toBe(false);
  });

  it("credits a session on return once, only for its own buyer and only when paid", async () => {
    const { createBilling } = await import("../src/billing.js");
    const id = `cs_test_return_${Date.now()}`;
    const sessions: Record<string, unknown> = {
      [id]: { id, payment_status: "paid", amount_total: 500, metadata: { opentaxrate_user_id: userId } },
      [`${id}_unpaid`]: { id: `${id}_unpaid`, payment_status: "unpaid", amount_total: 500, metadata: { opentaxrate_user_id: userId } },
    };
    const missing = new Stripe.errors.StripeInvalidRequestError({ message: "No such checkout.session", type: "invalid_request_error" });
    const fake = {
      checkout: { sessions: { retrieve: async (s: string) => sessions[s] ?? Promise.reject(missing) } },
    } as unknown as Stripe;
    const billing = createBilling(fake, ["https://opentaxrate.com"]);
    const before = await credit();
    expect(await billing.confirm("usr_someone_else", id)).toBe(false);
    expect(await billing.confirm(userId, `${id}_unpaid`)).toBe(false);
    expect(await billing.confirm(userId, "cs_test_nope")).toBe(false);
    expect(await credit()).toBe(before);
    expect(await billing.confirm(userId, id)).toBe(true);
    expect(await billing.confirm(userId, id)).toBe(true);
    expect(await credit()).toBe(before + 5_000_000);
  });
});
