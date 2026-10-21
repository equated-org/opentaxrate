import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { geocodeResults } from "../db/schema.js";
import { fingerprint } from "./registry.js";
import type { AddressToLocate, SourcedPoint } from "./types.js";

/** Keep the complete identity, including house letters/fractions and units.
 * Only unambiguous spelling aliases are folded; no fuzzy/range street keys. */
export function addressCacheKey(a: AddressToLocate) {
  const normalize = (s: string) => s.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ");
  const aliases: Record<string, string> = { AVENUE: "AVE", STREET: "ST", ROAD: "RD", BOULEVARD: "BLVD",
    DRIVE: "DR", LANE: "LN", COURT: "CT", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W" };
  const street = normalize(a.street).replace(/\b(AVENUE|STREET|ROAD|BOULEVARD|DRIVE|LANE|COURT|NORTH|SOUTH|EAST|WEST)\b/g,
    word => aliases[word]);
  return fingerprint(JSON.stringify(["v1", normalize(a.state), normalize(a.city), street, normalize(a.zip ?? "")]));
}

export interface GeocodeCache {
  /** undefined = miss; null = a confirmed negative hit. */
  get(key: string, provider: string): Promise<SourcedPoint | null | undefined>;
  put(key: string, provider: string, point: SourcedPoint | null): Promise<void>;
}
export const postgresGeocodeCache: GeocodeCache = {
  async get(key, provider) {
    const [row] = await db.select({ result: geocodeResults.result }).from(geocodeResults).where(and(
      eq(geocodeResults.addressKey, key), eq(geocodeResults.provider, provider), gt(geocodeResults.expiresAt, new Date()),
    ));
    return row ? row.result : undefined;
  },
  async put(key, provider, point) {
    const expiresAt = new Date(Date.now() + (point ? 365 : 30) * 86_400_000);
    await db.insert(geocodeResults).values({ addressKey: key, provider, result: point, expiresAt })
      .onConflictDoUpdate({ target: [geocodeResults.addressKey, geocodeResults.provider], set: {
        result: point, expiresAt, createdAt: sql`now()`,
      } });
  },
};
