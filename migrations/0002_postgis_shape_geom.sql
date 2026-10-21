CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
ALTER TABLE "sales_tax_shapes" ADD COLUMN "geom" geometry(MultiPolygon, 4326) NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_sales_tax_shapes_geom" ON "sales_tax_shapes" USING gist ("geom");