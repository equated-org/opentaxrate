ALTER TABLE "sales_tax_shapes" ADD COLUMN "area_id" integer;--> statement-breakpoint
ALTER TABLE "sales_tax_shapes" ADD COLUMN "starts_on" date DEFAULT '0001-01-01' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_tax_shapes" ADD COLUMN "ends_on" date DEFAULT '9999-12-31' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_tax_shapes" ADD CONSTRAINT "sales_tax_shapes_area_id_sales_tax_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."sales_tax_areas"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_sales_tax_shapes_area" ON "sales_tax_shapes" USING btree ("area_id");
