import {
  pgTable,
  serial,
  text,
  integer,
  smallint,
  numeric,
  customType,
  date,
  timestamp,
  index,
  unique,
  jsonb,
  primaryKey,
  bigint,
  bigserial,
  boolean,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { SourcedPoint } from "../geocoding/types.js";

/** Runtime-only tables: refresh never reads or replaces these rows. */
export const geocodeResults = pgTable("geocode_results", {
  addressKey: text("address_key").notNull(),
  provider: text("provider").notNull(),
  result: jsonb("result").$type<SourcedPoint | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.addressKey, t.provider] }), index("idx_geocode_results_expiry").on(t.expiresAt)]);

export const geocoderUsage = pgTable("geocoder_usage", {
  provider: text("provider").notNull(),
  day: date("day").notNull(),
  calls: integer("calls").notNull(),
  nextCallAt: timestamp("next_call_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.provider, t.day] })]);

/**
 * Every lookup made with a key: one table that is the caller's history (the
 * dashboard), their answer cache (a repeat within a day is answered from
 * their own last 200 here) and the meter (what each lookup was charged and
 * cost). Kept 90 days. user_id is null for a master key, whose key_id is
 * "master:<name>"; key_id has no foreign key, so rows outlive a deleted key.
 */
export const apiRequests = pgTable("api_requests", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id"),
  keyId: text("key_id").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  /** answerKey(): the normalized address, date and includes. */
  answerKey: text("answer_key").notNull(),
  query: jsonb("query").$type<Record<string, string>>().notNull(),
  status: smallint("status").notNull(),
  response: jsonb("response").notNull(),
  cached: boolean("cached").notNull().default(false),
  /** Paid providers called, by registry id. */
  providers: text("providers").array().notNull().default([]),
  /** What the account was charged, and what paid providers cost at list
   *  price, in millionths of a dollar. */
  chargedMicros: integer("charged_micros").notNull().default(0),
  geoCostMicros: integer("geo_cost_micros").notNull().default(0),
  ms: integer("ms").notNull(),
}, t => [
  // The cache: an account's own answers, or a master key's.
  index("idx_api_requests_cache").on(t.userId, t.answerKey, t.at.desc()),
  index("idx_api_requests_key_cache").on(t.keyId, t.answerKey, t.at.desc()),
  index("idx_api_requests_history").on(t.userId, t.at.desc()),
  index("idx_api_requests_at").on(t.at),
]);

/** Credit added to an account: the trial, a Stripe purchase, a refund
 *  (negative), or a correction. A purchase's Stripe session id is unique, so
 *  a webhook sent twice credits once. */
export const creditGrants = pgTable("credit_grants", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").$type<"trial" | "purchase" | "refund" | "adjust">().notNull(),
  micros: bigint("micros", { mode: "number" }).notNull(),
  stripeId: text("stripe_id").unique(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("idx_credit_grants_user").on(t.userId, t.at)]);

/**
 * Equated's own copy of the states' sales tax rate and boundary data, which
 * turns a street address into the taxing areas around it and their rates on a
 * date. No org owns these rows; a state's rows are replaced whole each time a
 * newer release of its files is loaded.
 *
 *   street range or ZIP+4 → area (county, city, districts) → each one's dated rate
 *
 * An area is one combination of taxing jurisdictions; many address ranges
 * share it, which keeps the range tables narrow. County and city outlines
 * from the Census Bureau settle a ZIP the files split, by where the address
 * falls.
 */

/** One state file Equated loaded, so every rate can name what it came from. */
export const salesTaxDataReleases = pgTable(
  "sales_tax_data_releases",
  {
    id: serial("id").primaryKey(),
    state: text("state").notNull(),
    kind: text("kind").$type<"rates" | "boundaries">().notNull(),
    /** The publisher's file name, e.g. "OHB2026Q4SEP17". */
    file: text("file").notNull(),
    rows: integer("rows").notNull(),
    loadedAt: timestamp("loaded_at").notNull().defaultNow(),
    /** For rates whose source lists some only in its newest edition (Texas's
     *  districts outside cities, from the current quarter's list): that
     *  edition's first day. A rate starting on it may have applied before;
     *  null where every rate's start is the publisher's (rates/map.ts). For
     *  boundaries listing only the ranges in force on their edition
     *  (Missouri's): that edition's first day, before which the ranges
     *  aren't read (rates/ranges.ts). */
    firstListed: date("first_listed"),
  },
  (t) => [unique("uq_sales_tax_data_releases_state_kind").on(t.state, t.kind)],
);

/** One combination of taxing jurisdictions an address can fall in. Its id is
 *  given by the loader (state FIPS × 1,000,000 + a counter), so a state's
 *  areas are replaced without a sequence to coordinate. */
export const salesTaxAreas = pgTable(
  "sales_tax_areas",
  {
    id: integer("id").primaryKey(),
    state: text("state").notNull(),
    /** County FIPS, three digits. */
    county: text("county"),
    /** Place (city) FIPS, five digits. */
    place: text("place"),
    /** Special districts as sorted "type:code" pairs joined by spaces, e.g.
     *  "63:31000"; empty when there are none. */
    districts: text("districts").notNull().default(""),
    /** The ids its boundary file gives the whole combination, keyed by the
     *  publisher's column name, e.g. {"Composite SER code": "01726"} for a
     *  Washington location; {} when it gives none. */
    ids: jsonb("ids").$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [
    unique("uq_sales_tax_areas_state_jurisdictions").on(
      t.state,
      t.county,
      t.place,
      t.districts,
      t.ids,
    ),
  ],
);

/** A run of house numbers on one street that falls in one area. */
export const salesTaxStreetRanges = pgTable(
  "sales_tax_street_ranges",
  {
    state: text("state").notNull(),
    /** The street's name as matching compares it (see src/address.ts). */
    streetKey: text("street_key").notNull(),
    /** The street as the file writes it, e.g. "SW 17TH ST". */
    street: text("street").notNull(),
    preDirectional: text("pre_directional").notNull().default(""),
    suffix: text("suffix").notNull().default(""),
    postDirectional: text("post_directional").notNull().default(""),
    /** Numeric house numbers; null when the range uses lettered numbers,
     *  which then match `house_text` exactly. */
    houseLow: integer("house_low"),
    houseHigh: integer("house_high"),
    houseText: text("house_text"),
    /** O, E or B: which side of the street. */
    parity: text("parity").notNull(),
    /** Unit range for a range that covers only some units of a building. */
    unitLow: text("unit_low"),
    unitHigh: text("unit_high"),
    city: text("city").notNull().default(""),
    zip5: text("zip5").notNull().default(""),
    plus4: text("plus4"),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    areaId: integer("area_id").notNull(),
  },
  (t) => [
    index("idx_sales_tax_street_ranges_street").on(t.state, t.streetKey),
    index("idx_sales_tax_street_ranges_zip").on(t.state, t.zip5),
  ],
);

/** Every street the Census Bureau's TIGER address features name in a ZIP,
 *  for the map-read states, whose rate files list no streets. Read by the
 *  geocoder matcher to tell a typo ("Mian St", no such street) from a
 *  different street one letter away ("Myers Ln" beside "Byers Ln"). The
 *  Streamlined states' streets come from their range files instead. */
export const zipStreetNames = pgTable(
  "zip_street_names",
  {
    state: text("state").notNull(),
    zip5: text("zip5").notNull(),
    /** The street's name as matching compares it (see src/address.ts). */
    streetKey: text("street_key").notNull(),
    /** The street as TIGER writes it, e.g. "N Main St". */
    street: text("street").notNull(),
    file: text("file").notNull(),
  },
  (t) => [primaryKey({ columns: [t.state, t.zip5, t.streetKey] })],
);

/** A run of ZIP+4 codes (or a whole ZIP) within one ZIP that falls in one
 *  area. A ZIP-wide row is the publisher's default, not an address match. */
export const salesTaxZipRanges = pgTable(
  "sales_tax_zip_ranges",
  {
    state: text("state").notNull(),
    zip5: text("zip5").notNull(),
    plus4Low: smallint("plus4_low").notNull(),
    plus4High: smallint("plus4_high").notNull(),
    kind: text("kind").$type<"zip4" | "zip5">().notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    areaId: integer("area_id").notNull(),
  },
  (t) => [index("idx_sales_tax_zip_ranges_zip").on(t.state, t.zip5)],
);

/** One jurisdiction's general sales tax rate over a span of dates. */
export const salesTaxJurisdictionRates = pgTable(
  "sales_tax_jurisdiction_rates",
  {
    id: serial("id").primaryKey(),
    state: text("state").notNull(),
    /** The publisher's jurisdiction type: 45 state, 00 county, 01 city, any
     *  other a special district. */
    type: text("type").notNull(),
    code: text("code").notNull(),
    /** General rate on a sale delivered within the state, as a decimal. */
    rate: numeric("rate", { precision: 8, scale: 6 }).notNull(),
    /** The Streamlined files' other rates: the general rate on a sale from
     *  outside the state, and the rate on food and drugs a state taxes at
     *  its food rate, from within and outside the state. Null where the
     *  publisher gives none (map-read states, Missouri). A food rate is the
     *  rate where food is taxed, not whether it is: Ohio's equals its
     *  general rate though Ohio exempts groceries. */
    rateInterstate: numeric("rate_interstate", { precision: 8, scale: 6 }),
    foodDrugRate: numeric("food_drug_rate", { precision: 8, scale: 6 }),
    foodDrugRateInterstate: numeric("food_drug_rate_interstate", { precision: 8, scale: 6 }),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
  },
  (t) => [
    index("idx_sales_tax_jurisdiction_rates_code").on(t.state, t.code),
  ],
);

/** One jurisdiction a rate row names, as its publisher describes it: the
 *  name and every identifying column its source gives, keyed by the
 *  publisher's own column name and kept verbatim ({"Locality Code": "9454",
 *  "Administered": "SELF"} for Montgomery, Alabama). Keyed like the rate rows
 *  and replaced with them, so a part's "type:code" finds its row. A source
 *  with neither names nor ids (the Streamlined rate files) has no rows. */
export const salesTaxJurisdictions = pgTable(
  "sales_tax_jurisdictions",
  {
    state: text("state").notNull(),
    /** The rate row's type, e.g. 00, 01, x, kx, spd, 99. */
    type: text("type").notNull(),
    code: text("code").notNull(),
    /** As the publisher writes it; null when it gives none. */
    name: text("name"),
    ids: jsonb("ids").$type<Record<string, string>>().notNull().default({}),
    /** The release it came from, e.g. "taxrates.csv". */
    file: text("file").notNull(),
  },
  (t) => [primaryKey({ columns: [t.state, t.type, t.code] })],
);

/** A PostGIS multipolygon in WGS84 longitude and latitude. NAD83, which the
 *  Census files use, is within a metre or two of it across the US. */
const multiPolygon = customType<{ data: string }>({
  dataType: () => "geometry(MultiPolygon, 4326)",
});

/** Immutable evidence snapshots. These are acquisition/verification data,
 * not automatically approved rate-engine inputs. A changed source keeps its
 * previous geometry and attributes instead of rewriting history. */
export const taxSourceSnapshots = pgTable("tax_source_snapshots", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  state: text("state").notNull(),
  url: text("url").notNull(),
  sha256: text("sha256").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  rows: integer("rows").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("idx_tax_source_snapshots_source").on(t.source, t.observedAt),
  check("ck_tax_source_snapshots_no_policies", sql`${t.source} not like 'sst-%' and coalesce(${t.metadata}->>'status', '') not in ('evidence-only', 'needs-normalization')`),
]);

export const taxSourceFeatures = pgTable("tax_source_features", {
  snapshotId: text("snapshot_id").notNull().references(() => taxSourceSnapshots.id, { onDelete: "cascade" }),
  featureId: text("feature_id").notNull(),
  /** Publisher identifiers and rates, with original field names and units. */
  attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull(),
  geom: multiPolygon("geom").notNull(),
}, t => [primaryKey({ columns: [t.snapshotId, t.featureId] }), index("idx_tax_source_features_geom").using("gist", t.geom)]);

/** Legacy experimental research storage. No importer or API consumer is
 * enabled; public snapshots exclude these rows. Retained for migration
 * compatibility, not as a supported transaction-policy feature. */
export const taxRuleRows = pgTable("tax_rule_rows", {
  snapshotId: text("snapshot_id").notNull().references(() => taxSourceSnapshots.id, { onDelete: "cascade" }),
  rowId: text("row_id").notNull(),
  reference: text("reference"),
  definition: text("definition").notNull(),
  cells: jsonb("cells").$type<Array<Record<string, unknown>>>().notNull(),
  context: jsonb("context").$type<Record<string, unknown>>().notNull(),
}, t => [primaryKey({ columns: [t.snapshotId, t.rowId] }), index("idx_tax_rule_rows_reference").on(t.reference)]);

/** Each ZIP's area as the Census Bureau draws it (a ZIP Code Tabulation
 *  Area: the census blocks where most addresses use that ZIP), from its
 *  cartographic boundary file, kept for ZIPs in the map-read states. Read
 *  only to tell whether a whole ZIP has one rate, for an address no
 *  geocoder could place (rates/map.ts). */
export const zipAreas = pgTable(
  "zip_areas",
  {
    zip5: text("zip5").primaryKey(),
    geom: multiPolygon("geom").notNull(),
    /** The file it came from, e.g. "cb_2020_us_zcta520_500k". */
    file: text("file").notNull(),
  },
  (t) => [index("idx_zip_areas_geom").using("gist", t.geom)],
);

/** A county's, city's or town's outline from the Census Bureau's TIGER files,
 *  or a special district's from its state, repaired, with seams between its
 *  pieces dissolved, and simplified to about a metre. A town is a county
 *  subdivision, the unit Wisconsin and Vermont tax by. */
export const salesTaxShapes = pgTable(
  "sales_tax_shapes",
  {
    state: text("state").notNull(),
    kind: text("kind")
      .$type<"county" | "place" | "cousub" | "district">()
      .notNull(),
    /** County FIPS (three digits), or place or county subdivision FIPS
     *  (five), as the state's boundary files write them; for a special
     *  district, the code its state's rate table uses. */
    fips: text("fips").notNull(),
    name: text("name").notNull(),
    /** A verified complete tax-area outline; removed when its SST area is rebuilt. */
    areaId: integer("area_id").references(() => salesTaxAreas.id, { onDelete: "cascade" }),
    /** The dates the outline is in force. A verified supplemental outline
     *  carries its source period. A loader's outline starts on its
     *  edition's first day (a TIGER year's January 1, a Texas quarter's),
     *  or 0001-01-01 for the first edition loaded, and ends the day before
     *  an edition that changes or drops it; the newest ends 9999-12-31. */
    startsOn: date("starts_on").notNull().default("0001-01-01"),
    endsOn: date("ends_on").notNull().default("9999-12-31"),
    geom: multiPolygon("geom").notNull(),
    /** The file it came from, e.g. "tl_2026_49_place". */
    file: text("file").notNull(),
  },
  (t) => [
    // One row per edition: a new edition ends the rows it changes
    // (ingest/load.ts writeEdition) rather than replacing them.
    unique("uq_sales_tax_shapes_state_kind_fips_starts").on(t.state, t.kind, t.fips, t.startsOn),
    index("idx_sales_tax_shapes_geom").using("gist", t.geom),
    index("idx_sales_tax_shapes_area").on(t.areaId),
  ],
);
