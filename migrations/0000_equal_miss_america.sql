CREATE TABLE "sales_tax_areas" (
	"id" integer PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"county" text,
	"place" text,
	"districts" text DEFAULT '' NOT NULL,
	CONSTRAINT "uq_sales_tax_areas_state_jurisdictions" UNIQUE("state","county","place","districts")
);
--> statement-breakpoint
CREATE TABLE "sales_tax_data_releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"kind" text NOT NULL,
	"file" text NOT NULL,
	"rows" integer NOT NULL,
	"loaded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sales_tax_data_releases_state_kind" UNIQUE("state","kind")
);
--> statement-breakpoint
CREATE TABLE "sales_tax_jurisdiction_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"type" text NOT NULL,
	"code" text NOT NULL,
	"rate" numeric(8, 6) NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_tax_shapes" (
	"state" text NOT NULL,
	"kind" text NOT NULL,
	"fips" text NOT NULL,
	"name" text NOT NULL,
	"rings" jsonb NOT NULL,
	"min_lon" double precision NOT NULL,
	"min_lat" double precision NOT NULL,
	"max_lon" double precision NOT NULL,
	"max_lat" double precision NOT NULL,
	"file" text NOT NULL,
	CONSTRAINT "uq_sales_tax_shapes_state_kind_fips" UNIQUE("state","kind","fips")
);
--> statement-breakpoint
CREATE TABLE "sales_tax_street_ranges" (
	"state" text NOT NULL,
	"street_key" text NOT NULL,
	"street" text NOT NULL,
	"pre_directional" text DEFAULT '' NOT NULL,
	"suffix" text DEFAULT '' NOT NULL,
	"post_directional" text DEFAULT '' NOT NULL,
	"house_low" integer,
	"house_high" integer,
	"house_text" text,
	"parity" text NOT NULL,
	"unit_low" text,
	"unit_high" text,
	"city" text DEFAULT '' NOT NULL,
	"zip5" text DEFAULT '' NOT NULL,
	"plus4" text,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"area_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_tax_zip_ranges" (
	"state" text NOT NULL,
	"zip5" text NOT NULL,
	"plus4_low" smallint NOT NULL,
	"plus4_high" smallint NOT NULL,
	"kind" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"area_id" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_sales_tax_jurisdiction_rates_code" ON "sales_tax_jurisdiction_rates" USING btree ("state","code");--> statement-breakpoint
CREATE INDEX "idx_sales_tax_shapes_box" ON "sales_tax_shapes" USING btree ("state","min_lon","max_lon");--> statement-breakpoint
CREATE INDEX "idx_sales_tax_street_ranges_street" ON "sales_tax_street_ranges" USING btree ("state","street_key");--> statement-breakpoint
CREATE INDEX "idx_sales_tax_street_ranges_zip" ON "sales_tax_street_ranges" USING btree ("state","zip5");--> statement-breakpoint
CREATE INDEX "idx_sales_tax_zip_ranges_zip" ON "sales_tax_zip_ranges" USING btree ("state","zip5");