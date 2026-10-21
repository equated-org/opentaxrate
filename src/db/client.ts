/** The service's one Postgres connection pool, and Drizzle over it. */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export const databaseUrl = () =>
  process.env.DATABASE_URL || "postgres://opentaxrate:opentaxrate@localhost:5432/opentaxrate";

export const client = postgres(databaseUrl(), { max: Number(process.env.DATABASE_POOL || 10) });
export const db = drizzle(client, { schema });
