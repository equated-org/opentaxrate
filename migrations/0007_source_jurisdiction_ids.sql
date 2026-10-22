CREATE TABLE "sales_tax_jurisdictions" (
	"state" text NOT NULL,
	"type" text NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"file" text NOT NULL,
	CONSTRAINT "sales_tax_jurisdictions_state_type_code_pk" PRIMARY KEY("state","type","code")
);
--> statement-breakpoint
ALTER TABLE "sales_tax_areas" DROP CONSTRAINT "uq_sales_tax_areas_state_jurisdictions";--> statement-breakpoint
ALTER TABLE "sales_tax_areas" ADD COLUMN "ids" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Keep the codes already loaded, so no state has to be refreshed: Missouri's
-- was its jurisdiction code, every other state's the Streamlined composite
-- SER column.
UPDATE "sales_tax_areas" SET "ids" = jsonb_build_object(
  CASE WHEN "state" = 'MO' THEN 'Jurisdiction Code' ELSE 'Composite SER Code' END, "reporting_code")
  WHERE "reporting_code" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_tax_areas" DROP COLUMN "reporting_code";--> statement-breakpoint
ALTER TABLE "sales_tax_areas" ADD CONSTRAINT "uq_sales_tax_areas_state_jurisdictions" UNIQUE("state","county","place","districts","ids");