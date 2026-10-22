/**
 * Who is asking, and which outside services their lookup may use:
 *   - no key: the public tier, limited to OPENTAXRATE_PUBLIC_PROVIDERS
 *     (e.g. "photon,pelias", the geocoders we host); every provider when
 *     unset, so a self-hosted API behaves as before;
 *   - a master key from OPENTAXRATE_MASTER_KEYS ("app=otr_master_…,…"):
 *     the keyed tier, every provider, for our own apps and tests;
 *   - an account's key (otr_live_…, auth.ts): the keyed tier, paid from the
 *     account's credit (credits.ts), 120 lookups a minute;
 *   - any other key: 401. A key never falls back to the public tier.
 * The key is read from x-api-key or Authorization: Bearer.
 *
 * Provider ids are the registry's (census, nominatim, photon, pelias,
 * geocodio, smarty, mapbox, here, esri, google) plus jev; the Geocodio
 * standardizer runs only where geocodio is allowed.
 */
import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import type { Auth } from "./auth.js";

export type Tier = "public" | "keyed";

export interface Access {
  tier: Tier;
  /** The master key's name, for a master key. */
  master?: string;
  /** The account and key, for an account's key. */
  userId?: string;
  keyId?: string;
}

export interface ProviderPolicy {
  allows(id: string): boolean;
}

export const EVERY_PROVIDER: ProviderPolicy = { allows: () => true };

const PUBLIC: Access = { tier: "public" };

const list = (value: string | undefined) => (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** The providers a lookup with this access may use. */
export function policyFor(access: Access, env: NodeJS.ProcessEnv = process.env): ProviderPolicy {
  if (access.tier === "keyed") return EVERY_PROVIDER;
  const allowed = list(env.OPENTAXRATE_PUBLIC_PROVIDERS);
  if (!allowed.length) return EVERY_PROVIDER;
  const set = new Set(allowed.map((id) => id.toLowerCase()));
  return { allows: (id) => set.has(id) };
}

const MASTER_PREFIX = "otr_master_";
/** Random characters a master key needs after its prefix. */
const MASTER_MIN = 32;

const digest = (key: string) => createHash("sha256").update(key).digest("hex");

/** OPENTAXRATE_MASTER_KEYS as key digest → name. Throws on a key that is
 *  malformed or too short, so a weak key stops the server at start rather
 *  than being accepted. */
export function masterKeys(env: NodeJS.ProcessEnv = process.env): Map<string, string> {
  const keys = new Map<string, string>();
  for (const entry of list(env.OPENTAXRATE_MASTER_KEYS)) {
    const at = entry.indexOf("=");
    const name = at > 0 ? entry.slice(0, at).trim() : "master";
    const key = at > 0 ? entry.slice(at + 1).trim() : entry;
    if (!/^[\w-]+$/.test(name))
      throw new Error(`OPENTAXRATE_MASTER_KEYS: "${name}" isn't a name; write name=otr_master_…`);
    if (!key.startsWith(MASTER_PREFIX) || key.length - MASTER_PREFIX.length < MASTER_MIN)
      throw new Error(
        `OPENTAXRATE_MASTER_KEYS: the key for "${name}" must be ${MASTER_PREFIX} and at least ${MASTER_MIN} random characters; make one with: echo ${MASTER_PREFIX}$(openssl rand -hex 24)`,
      );
    keys.set(digest(key), name);
  }
  return keys;
}

/** The key a request sends, if any. */
export function presentedKey(c: Context): string | undefined {
  const header = c.req.header("x-api-key")?.trim();
  if (header) return header;
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization")?.trim() ?? "");
  return bearer?.[1];
}

export type AccessVariables = { access: Access };

/** Middleware setting c.var.access, or answering 401 for a key it doesn't
 *  know and 429 for an account key over its per-minute limit. */
export function resolveAccess(
  env: NodeJS.ProcessEnv = process.env,
  auth?: Auth,
): MiddlewareHandler<{ Variables: AccessVariables }> {
  const masters = masterKeys(env);
  return async (c, next) => {
    const key = presentedKey(c);
    if (!key) {
      c.set("access", PUBLIC);
      return next();
    }
    const master = masters.get(digest(key));
    if (master) {
      c.set("access", { tier: "keyed", master });
      return next();
    }
    if (auth) {
      const verified = await auth.api.verifyApiKey({ body: { key } }).catch(() => null);
      if (verified?.valid && verified.key) {
        c.set("access", { tier: "keyed", userId: verified.key.referenceId, keyId: verified.key.id });
        return next();
      }
      if (verified?.error?.code === "RATE_LIMITED") {
        const ms = Number((verified.error as { details?: { tryAgainIn?: number } }).details?.tryAgainIn ?? 60_000);
        const wait = Math.max(1, Math.ceil(ms / 1000));
        c.header("Retry-After", String(wait));
        return c.json({ error: `This key is over 120 lookups a minute. Try again in ${wait} s.`, code: "KEY_LIMITED" }, 429);
      }
    }
    return c.json(
      { error: "This API key isn't valid. Check it, or leave it off to use the free tier.", code: "INVALID_API_KEY" },
      401,
    );
  };
}
