ALTER TABLE "sales_tax_jurisdiction_rates" ADD COLUMN "rate_interstate" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "sales_tax_jurisdiction_rates" ADD COLUMN "food_drug_rate" numeric(8, 6);--> statement-breakpoint
ALTER TABLE "sales_tax_jurisdiction_rates" ADD COLUMN "food_drug_rate_interstate" numeric(8, 6);