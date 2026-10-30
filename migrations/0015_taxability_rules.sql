CREATE TABLE "taxability_rules" (
	"tax" text NOT NULL,
	"code" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date DEFAULT '9999-12-31' NOT NULL,
	"from_is" text NOT NULL,
	"treatment" text NOT NULL,
	"follows" text,
	"summary" text NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb NOT NULL,
	"notes" text,
	"file" text NOT NULL,
	CONSTRAINT "taxability_rules_tax_code_starts_on_pk" PRIMARY KEY("tax","code","starts_on"),
	CONSTRAINT "ck_taxability_rules_dates" CHECK ("taxability_rules"."ends_on" >= "taxability_rules"."starts_on"),
	CONSTRAINT "ck_taxability_rules_from_is" CHECK ("taxability_rules"."from_is" in ('effective', 'earliest_verified')),
	CONSTRAINT "ck_taxability_rules_treatment" CHECK ("taxability_rules"."treatment" in ('taxable', 'exempt', 'zero_rated', 'conditional', 'follows')),
	CONSTRAINT "ck_taxability_rules_follows" CHECK (("taxability_rules"."treatment" = 'follows') = ("taxability_rules"."follows" is not null)),
	CONSTRAINT "ck_taxability_rules_conditional" CHECK ("taxability_rules"."treatment" <> 'conditional' or jsonb_array_length("taxability_rules"."conditions") > 0),
	CONSTRAINT "ck_taxability_rules_cited" CHECK (jsonb_typeof("taxability_rules"."citations") = 'array' and jsonb_array_length("taxability_rules"."citations") > 0)
);
--> statement-breakpoint
-- Two rules for one tax and code never cover the same day; a drizzle
-- schema can't say this, so it lives here.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "taxability_rules" ADD CONSTRAINT "ex_taxability_rules_no_overlap"
  EXCLUDE USING gist ("tax" WITH =, "code" WITH =, daterange("starts_on", "ends_on", '[]') WITH &&);--> statement-breakpoint
-- The experimental research table never had an importer or a reader.
DROP TABLE "tax_rule_rows" CASCADE;