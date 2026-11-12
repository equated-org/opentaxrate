ALTER TABLE "apikey" ALTER COLUMN "rate_limit_max" SET DEFAULT 600;--> statement-breakpoint
-- Keys created at the old default move to the new one; a limit set by hand stays.
UPDATE "apikey" SET "rate_limit_max" = 600 WHERE "rate_limit_max" = 120;
