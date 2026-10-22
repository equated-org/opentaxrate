/**
 * Buying credit: a one-time Stripe Checkout payment of $10, $25 or $50,
 * credited by Stripe's webhook. The request path never calls Stripe; the
 * balance in Postgres (credits.ts) decides who can look up.
 *
 *   STRIPE_SECRET_KEY       sk_test_… or sk_live_… (your secret manager)
 *   STRIPE_WEBHOOK_SECRET   whsec_… for POST /api/billing/webhook
 *   BETTER_AUTH_URL         where Checkout returns to (the dashboard's origin)
 *
 * A purchase is credited once per Checkout session id, however many times
 * Stripe sends the event; a refund takes back what was refunded, once.
 * The Stripe account is shared with other products, so only events carrying
 * METADATA_KEY are ours; everything else is ignored.
 */
import Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { db } from "./db/client.js";
import { user } from "./db/auth-schema.js";
import { addCredit } from "./credits.js";

/** Top-ups offered, in cents. */
export const TOP_UPS = [1000, 2500, 5000] as const;

/** One cent in millionths of a dollar. */
const MICROS_PER_CENT = 10_000;

/** Marks a Checkout session and its payment as OpenTaxRate credit, and
 *  names the account to credit. */
export const METADATA_KEY = "opentaxrate_user_id";

export interface Billing {
  createCheckout(userId: string, cents: number): Promise<string>;
  /** Verifies and applies one webhook delivery; throws on a bad signature. */
  handleWebhook(raw: string, signature: string): Promise<void>;
}

export function billingFromEnv(env: NodeJS.ProcessEnv = process.env): Billing | undefined {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return undefined;
  return createBilling(new Stripe(key), env.STRIPE_WEBHOOK_SECRET?.trim() ?? "", env.BETTER_AUTH_URL || "http://localhost:8080");
}

export function createBilling(stripe: Stripe, webhookSecret: string, origin: string): Billing {
  async function customerFor(userId: string) {
    const [account] = await db.select({ email: user.email, customer: user.stripeCustomerId }).from(user).where(eq(user.id, userId));
    if (!account) throw new Error("No such account.");
    if (account.customer) return account.customer;
    const customer = await stripe.customers.create({ email: account.email, metadata: { [METADATA_KEY]: userId } }, { idempotencyKey: `customer-${userId}` });
    await db.update(user).set({ stripeCustomerId: customer.id }).where(eq(user.id, userId));
    return customer.id;
  }

  async function userForPaymentIntent(id: string | Stripe.PaymentIntent | null): Promise<string | undefined> {
    if (!id) return undefined;
    const intent = typeof id === "string" ? await stripe.paymentIntents.retrieve(id) : id;
    return intent.metadata?.[METADATA_KEY] || undefined;
  }

  return {
    async createCheckout(userId, cents) {
      if (!(TOP_UPS as readonly number[]).includes(cents)) throw new Error(`Top-ups are ${TOP_UPS.join(", ")} cents.`);
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: await customerFor(userId),
        line_items: [
          {
            price_data: { currency: "usd", unit_amount: cents, product_data: { name: "OpenTaxRate credit" } },
            quantity: 1,
          },
        ],
        metadata: { [METADATA_KEY]: userId },
        payment_intent_data: { metadata: { [METADATA_KEY]: userId } },
        success_url: `${origin}/dashboard?paid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/dashboard`,
      });
      if (!session.url) throw new Error("Stripe didn't return a Checkout URL.");
      return session.url;
    },

    async handleWebhook(raw, signature) {
      if (!webhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
      const event = stripe.webhooks.constructEvent(raw, signature, webhookSecret);
      if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
        const session = event.data.object;
        const userId = session.metadata?.[METADATA_KEY];
        if (session.payment_status !== "paid" || !userId || !session.amount_total) return;
        await addCredit(userId, "purchase", session.amount_total * MICROS_PER_CENT, session.id);
      } else if (event.type === "charge.refunded") {
        const charge = event.data.object;
        // Only charges from our Checkout: they carry the key on the charge
        // or its payment, and come with a customer we created.
        const userId = charge.metadata?.[METADATA_KEY] || (charge.customer ? await userForPaymentIntent(charge.payment_intent) : undefined);
        if (!userId) return;
        // amount_refunded is the charge's total so far: take back only what
        // earlier refund events haven't, one event per charge at a time, as
        // Stripe may deliver two at once.
        await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`refund:${charge.id}`}))`);
          const [{ taken }] = await tx.execute<{ taken: string }>(sql`
            select coalesce(-sum(micros), 0) as taken from credit_grants where kind = 'refund' and starts_with(stripe_id, ${`refund:${charge.id}:`})`);
          const owed = charge.amount_refunded * MICROS_PER_CENT - Number(taken);
          if (owed > 0) await addCredit(userId, "refund", -owed, `refund:${charge.id}:${charge.amount_refunded}`, tx);
        });
      }
    },
  };
}
