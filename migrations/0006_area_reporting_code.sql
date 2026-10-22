ALTER TABLE "sales_tax_areas" DROP CONSTRAINT "uq_sales_tax_areas_state_jurisdictions";--> statement-breakpoint
ALTER TABLE "sales_tax_areas" ADD COLUMN "reporting_code" text;--> statement-breakpoint
ALTER TABLE "sales_tax_areas" ADD CONSTRAINT "uq_sales_tax_areas_state_jurisdictions" UNIQUE("state","county","place","districts","reporting_code");