/**
 * A keyed lookup is charged before it's answered, so a failure after that,
 * even on a repeat answered from history, must give the charge back. Needs
 * the *_test database.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { db } from "../src/db/client.js";

const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
if (!name.endsWith("_test")) throw new Error(`These tests write users; run them on a *_test database, not ${name}.`);

afterAll(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("../src/requests.js");
});

describe("a keyed lookup that fails after its charge", () => {
  it("is refunded when its answer from history can't be logged", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret");
    vi.resetModules();
    vi.doMock("../src/requests.js", async (original) => ({
      ...(await original<typeof import("../src/requests.js")>()),
      cachedAnswer: async () => ({ rate: 0.0635 }),
      logRequest: async () => {
        throw new Error("database unavailable");
      },
    }));
    const { createAuth } = await import("../src/auth.js");
    const { app } = (await import("../src/server.js")) as unknown as { app: Hono };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const userId = `usr_refund_${Date.now()}`;
    await db.execute(sql`insert into "user" (id, name, email, email_verified, credit_micros) values (${userId}, '', ${`${userId}@acme.test`}, true, 5000)`);
    const { key } = await createAuth().api.createApiKey({ body: { userId } });

    const response = await app.request("/v1/rate?state=CT&street=1+Main+St&city=Hartford", { headers: { "x-api-key": key } });
    expect(response.status).toBe(500);
    const [row] = await db.execute<{ c: string }>(sql`select credit_micros as c from "user" where id = ${userId}`);
    expect(Number(row.c)).toBe(5000);
  });
});
