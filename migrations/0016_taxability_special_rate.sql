ALTER TABLE "taxability_rules" DROP CONSTRAINT "ck_taxability_rules_treatment";--> statement-breakpoint
ALTER TABLE "taxability_rules" ADD COLUMN "rate" double precision;--> statement-breakpoint
ALTER TABLE "taxability_rules" ADD CONSTRAINT "ck_taxability_rules_special_rate" CHECK (("taxability_rules"."treatment" = 'special_rate') = ("taxability_rules"."rate" is not null));--> statement-breakpoint
ALTER TABLE "taxability_rules" ADD CONSTRAINT "ck_taxability_rules_treatment" CHECK ("taxability_rules"."treatment" in ('taxable', 'special_rate', 'exempt', 'zero_rated', 'conditional', 'follows'));