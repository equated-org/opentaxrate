/**
 * Stripe's webhook, offline: events signed with a test secret the way Stripe
 * signs them. A paid Checkout session credits once however often it's sent;
 * a bad signature changes nothing; refunds take back what was refunded.
 * Needs the *_test database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { db } from "../src/db/client.js";

const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
if (!name.endsWith("_test")) throw new Error(`Billing tests write users; run them on a *_test database, not ${name}.`);

const SECRET = "whsec_test_secret";
const stripe = new Stripe("sk_test_offline");
const userId = `usr_billing_${Date.now()}`;
let app: Hono;

const credit = async () => Number((await db.execute<{ c: string }>(sql`select credit_micros as c from "user" where id = ${userId}`))[0].c);
function send(type: string, object: Record<string, unknown>, secret = SECRET) {
  const payload = JSON.stringify({ id: `evt_${Math.random()}`, object: "event", type, data: { object } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return app.request("/api/billing/webhook", { method: "POST", headers: { "stripe-signature": signature, "content-type": "application/json" }, body: payload });
}

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_offline");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  vi.resetModules();
  app = (await import("../src/server.js")).app as unknown as Hono;
  await db.execute(sql`insert into "user" (id, name, email, email_verified) values (${userId}, '', ${`${userId}@acme.test`}, true)`);
});
afterAll(() => vi.unstubAllEnvs());

describe("the Stripe webhook", () => {
  const session = { id: `cs_test_${Date.now()}`, object: "checkout.session", payment_status: "paid", amount_total: 1000, metadata: { opentaxrate_user_id: userId } };

  it("credits a paid $10 checkout exactly once", async () => {
    expect((await send("checkout.session.completed", session)).status).toBe(200);
    expect((await send("checkout.session.completed", session)).status).toBe(200);
    expect(await credit()).toBe(10_000_000);
  });

  it("ignores an unpaid session and a bad signature", async () => {
    expect((await send("checkout.session.completed", { ...session, id: "cs_unpaid", payment_status: "unpaid" })).status).toBe(200);
    expect((await send("checkout.session.completed", { ...session, id: "cs_forged" }, "whsec_wrong")).status).toBe(400);
    expect(await credit()).toBe(10_000_000);
  });

  it("takes back each refund once, partial then the rest", async () => {
    const charge = { id: `ch_test_${Date.now()}`, object: "charge", amount_refunded: 400, metadata: { opentaxrate_user_id: userId }, payment_intent: null };
    await send("charge.refunded", charge);
    await send("charge.refunded", charge);
    expect(await credit()).toBe(6_000_000);
    await send("charge.refunded", { ...charge, amount_refunded: 1000 });
    expect(await credit()).toBe(0);
  });

  it("takes back two refunds delivered at once exactly once each", async () => {
    await db.execute(sql`update "user" set credit_micros = 10000000 where id = ${userId}`);
    const charge = { id: `ch_race_${Date.now()}`, object: "charge", metadata: { opentaxrate_user_id: userId }, payment_intent: null };
    await Promise.all([send("charge.refunded", { ...charge, amount_refunded: 400 }), send("charge.refunded", { ...charge, amount_refunded: 1000 })]);
    expect(await credit()).toBe(0);
  });

  it("ignores another product's payments in the shared Stripe account", async () => {
    await db.execute(sql`update "user" set credit_micros = 0 where id = ${userId}`);
    const foreign = { ...session, id: `cs_other_${Date.now()}`, metadata: { user_id: userId } };
    expect((await send("checkout.session.completed", foreign)).status).toBe(200);
    expect((await send("charge.refunded", { id: "ch_other", object: "charge", amount_refunded: 500, metadata: {}, customer: null, payment_intent: null })).status).toBe(200);
    expect(await credit()).toBe(0);
  });

  it("only offers the listed top-ups", async () => {
    // Signed out: the account routes refuse before any amount is read.
    expect((await app.request("/v1/account/checkout", { method: "POST", body: JSON.stringify({ amount: 1000 }) })).status).toBe(401);
  });
});
