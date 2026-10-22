/**
 * Buying credit through Stripe Checkout, confirmed by polling the paid
 * session when the buyer returns to the dashboard. Each session credits once.
 * The lookup path uses the balance in Postgres and never calls Stripe.
 *
 * STRIPE_SECRET_KEY is a test key locally and a live key in production.
 * BETTER_AUTH_URL and OPENTAXRATE_CORS_ORIGINS choose the return origin.
 */
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { user } from "./db/auth-schema.js";
import { addCredit } from "./credits.js";

/** What a top-up may be, in cents: whole dollars in this range. */
export const MIN_CENTS = 500;
export const MAX_CENTS = 100_000;

export const validTopUp = (cents: number) => Number.isInteger(cents) && cents % 100 === 0 && cents >= MIN_CENTS && cents <= MAX_CENTS;

/** One cent in millionths of a dollar. */
const MICROS_PER_CENT = 10_000;

/** Marks a Checkout session and its payment as OpenTaxRate credit, and
 *  names the account to credit. */
export const METADATA_KEY = "opentaxrate_user_id";

export interface Billing {
  /** `from` is the page's origin; Checkout returns there when it's one
   *  of ours, else to the first. */
  createCheckout(userId: string, cents: number, from?: string): Promise<string>;
  /** Credits a Checkout session the buyer came back from, if it's theirs
   *  and paid. Returns whether it's paid (credited now or before); false
   *  for a session that isn't, or doesn't exist. */
  confirm(userId: string, sessionId: string): Promise<boolean>;
}

export function billingFromEnv(env: NodeJS.ProcessEnv = process.env): Billing | undefined {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return undefined;
  const origins = [env.BETTER_AUTH_URL || "http://localhost:8080", ...(env.OPENTAXRATE_CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean)];
  return createBilling(new Stripe(key), origins);
}

export function createBilling(stripe: Stripe, origins: string[]): Billing {
  async function customerFor(userId: string) {
    const [account] = await db.select({ email: user.email, customer: user.stripeCustomerId }).from(user).where(eq(user.id, userId));
    if (!account) throw new Error("No such account.");
    if (account.customer) return account.customer;
    const customer = await stripe.customers.create({ email: account.email, metadata: { [METADATA_KEY]: userId } }, { idempotencyKey: `customer-${userId}` });
    await db.update(user).set({ stripeCustomerId: customer.id }).where(eq(user.id, userId));
    return customer.id;
  }

  /** Credits a paid session once, by its id. */
  async function creditSession(session: Stripe.Checkout.Session) {
    const userId = session.metadata?.[METADATA_KEY];
    if (session.payment_status !== "paid" || !userId || !session.amount_total) return false;
    await addCredit(userId, "purchase", session.amount_total * MICROS_PER_CENT, session.id);
    return true;
  }

  return {
    async createCheckout(userId, cents, from) {
      if (!validTopUp(cents)) throw new Error(`A top-up is whole dollars from $${MIN_CENTS / 100} to $${MAX_CENTS / 100}.`);
      const origin = from && origins.includes(from) ? from : origins[0];
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

    async confirm(userId, sessionId) {
      const session = await stripe.checkout.sessions.retrieve(sessionId).catch((error: unknown) => {
        if (error instanceof Stripe.errors.StripeInvalidRequestError) return undefined;
        throw error;
      });
      if (!session) return false;
      // Someone else's session id credits no one.
      if (session.metadata?.[METADATA_KEY] !== userId) return false;
      return creditSession(session);
    },
  };
}
