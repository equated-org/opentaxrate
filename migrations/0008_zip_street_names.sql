CREATE TABLE "zip_street_names" (
	"state" text NOT NULL,
	"zip5" text NOT NULL,
	"street_key" text NOT NULL,
	"street" text NOT NULL,
	"file" text NOT NULL,
	CONSTRAINT "zip_street_names_state_zip5_street_key_pk" PRIMARY KEY("state","zip5","street_key")
);
