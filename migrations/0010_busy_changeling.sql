CREATE TABLE "tax_rule_rows" (
	"snapshot_id" text NOT NULL,
	"row_id" text NOT NULL,
	"reference" text,
	"definition" text NOT NULL,
	"cells" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	CONSTRAINT "tax_rule_rows_snapshot_id_row_id_pk" PRIMARY KEY("snapshot_id","row_id")
);
--> statement-breakpoint
CREATE TABLE "tax_source_features" (
	"snapshot_id" text NOT NULL,
	"feature_id" text NOT NULL,
	"attributes" jsonb NOT NULL,
	"geom" geometry(MultiPolygon, 4326) NOT NULL,
	CONSTRAINT "tax_source_features_snapshot_id_feature_id_pk" PRIMARY KEY("snapshot_id","feature_id")
);
--> statement-breakpoint
CREATE TABLE "tax_source_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"state" text NOT NULL,
	"url" text NOT NULL,
	"sha256" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"rows" integer NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_rule_rows" ADD CONSTRAINT "tax_rule_rows_snapshot_id_tax_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."tax_source_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_source_features" ADD CONSTRAINT "tax_source_features_snapshot_id_tax_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."tax_source_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tax_rule_rows_reference" ON "tax_rule_rows" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "idx_tax_source_features_geom" ON "tax_source_features" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "idx_tax_source_snapshots_source" ON "tax_source_snapshots" USING btree ("source","observed_at");