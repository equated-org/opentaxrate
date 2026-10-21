CREATE TABLE "geocode_results" (
  "address_key" text NOT NULL,
  "provider" text NOT NULL,
  "result" jsonb,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  PRIMARY KEY ("address_key", "provider")
);
--> statement-breakpoint
CREATE INDEX "idx_geocode_results_expiry" ON "geocode_results" ("expires_at");
--> statement-breakpoint
CREATE TABLE "geocoder_usage" (
  "provider" text NOT NULL,
  "day" date NOT NULL,
  "calls" integer NOT NULL CHECK ("calls" >= 0),
  "next_call_at" timestamptz NOT NULL,
  PRIMARY KEY ("provider", "day")
);
