/**
 * Accounts (Better Auth): sign-in by a code sent to your email, which also
 * proves the address, and API keys for verified accounts. On only when
 * BETTER_AUTH_SECRET is set; mounted at /api/auth/* by server.ts.
 *
 *   BETTER_AUTH_SECRET   signs sessions (openssl rand -base64 32)
 *   BETTER_AUTH_URL      the origin the dashboard is served from, e.g.
 *                        https://opentaxrate.com (the Worker forwards
 *                        /api/auth/* there, so cookies are first-party)
 *
 * A new account gets its trial credit (credits.ts). Keys are otr_live_…,
 * stored hashed, 120 lookups a minute each.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { db } from "./db/client.js";
import * as schema from "./db/auth-schema.js";
import { sendMail, signInCodeMail } from "./mail.js";
import { grantTrial } from "./credits.js";
import { clientIpHeader } from "./limits.js";

const list = (value: string | undefined) => (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function createAuth(env: NodeJS.ProcessEnv = process.env) {
  const baseURL = env.BETTER_AUTH_URL || "http://localhost:8080";
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    basePath: "/api/auth",
    trustedOrigins: [baseURL, ...list(env.OPENTAXRATE_CORS_ORIGINS)],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    advanced: {
      // Better Auth's own limits (on sending codes, say) count the visitor
      // the Worker or Caddy names, as the API's limits do.
      ipAddress: { ipAddressHeaders: [clientIpHeader(env) ?? "x-client-ip"] },
    },
    databaseHooks: {
      user: { create: { after: async (user) => grantTrial(user.id) } },
    },
    hooks: {
      // Keys only for verified accounts. Signing in by code verifies the
      // address, so this only matters if another way to sign in is added.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/api-key/create") return;
        const session = await getSessionFromCtx(ctx);
        if (session && !session.user.emailVerified)
          throw new APIError("FORBIDDEN", { message: "Verify your email before creating an API key." });
      }),
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        storeOTP: "hashed",
        async sendVerificationOTP({ email, otp }) {
          await sendMail(signInCodeMail(email, otp), env);
        },
      }),
      apiKey({
        defaultPrefix: "otr_live_",
        apiKeyHeaders: ["x-api-key"],
        // Enough to tell keys apart in the dashboard: otr_live_ and 4 more.
        startingCharactersConfig: { charactersLength: 13 },
        rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 120 },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** The accounts service, or undefined when BETTER_AUTH_SECRET is unset. */
export function authFromEnv(env: NodeJS.ProcessEnv = process.env): Auth | undefined {
  return env.BETTER_AUTH_SECRET ? createAuth(env) : undefined;
}
