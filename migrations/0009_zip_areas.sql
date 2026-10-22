CREATE TABLE "zip_areas" (
	"zip5" text PRIMARY KEY NOT NULL,
	"geom" geometry(MultiPolygon, 4326) NOT NULL,
	"file" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_zip_areas_geom" ON "zip_areas" USING gist ("geom");