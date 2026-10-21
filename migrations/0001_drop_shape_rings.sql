-- Outlines move to PostGIS geometry; the old JSON rows are reloaded by refresh.
DELETE FROM "sales_tax_shapes";--> statement-breakpoint
DROP INDEX "idx_sales_tax_shapes_box";--> statement-breakpoint
ALTER TABLE "sales_tax_shapes" DROP COLUMN "rings";--> statement-breakpoint
ALTER TABLE "sales_tax_shapes" DROP COLUMN "min_lon";--> statement-breakpoint
ALTER TABLE "sales_tax_shapes" DROP COLUMN "min_lat";--> statement-breakpoint
ALTER TABLE "sales_tax_shapes" DROP COLUMN "max_lon";--> statement-breakpoint
ALTER TABLE "sales_tax_shapes" DROP COLUMN "max_lat";