CREATE TABLE "sales_tax_class_rates" (
	"state" text NOT NULL,
	"type" text NOT NULL,
	"code" text NOT NULL,
	"class" text NOT NULL,
	"rate" numeric(8, 6) NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "ck_sales_tax_class_rates_dates" CHECK ("sales_tax_class_rates"."ends_on" >= "sales_tax_class_rates"."starts_on"),
	CONSTRAINT "ck_sales_tax_class_rates_class" CHECK ("sales_tax_class_rates"."class" in ('restaurant', 'grocery'))
);
--> statement-breakpoint
ALTER TABLE "taxability_rules" DROP CONSTRAINT "ck_taxability_rules_special_rate";--> statement-breakpoint
ALTER TABLE "taxability_rules" ADD COLUMN "rate_class" text;--> statement-breakpoint
CREATE INDEX "idx_sales_tax_class_rates_code" ON "sales_tax_class_rates" USING btree ("state","type","code");--> statement-breakpoint
ALTER TABLE "taxability_rules" ADD CONSTRAINT "ck_taxability_rules_rate_class" CHECK ("taxability_rules"."rate_class" is null or ("taxability_rules"."rate" is null and "taxability_rules"."rate_class" in ('restaurant', 'grocery')));--> statement-breakpoint
ALTER TABLE "taxability_rules" ADD CONSTRAINT "ck_taxability_rules_special_rate" CHECK (("taxability_rules"."treatment" = 'special_rate') = ("taxability_rules"."rate" is not null or "taxability_rules"."rate_class" is not null));