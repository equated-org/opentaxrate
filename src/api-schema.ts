/**
 * The public API's contract, as zod schemas: what /v1/rate and /v1/coverage
 * take and answer. server.ts validates queries with them and types its
 * answers by them, and /v1/openapi.json is generated from them, so the spec
 * can't say what the code doesn't do. The engines keep their own types
 * (rates/types.ts, regions.ts); an answer that stops fitting these is a
 * type error in server.ts, and test/openapi.test.ts parses real answers.
 */
import { z } from "@hono/zod-openapi";
import { RATE_ERROR_CODES } from "./errors.js";

const rate = (description: string, example = 0.1055) => z.number().openapi({ description, example });

export const RatesByTypeSchema = z
  .object({
    general: z.number().openapi({ description: "A general sale from within the state." }),
    generalInterstate: z.number().nullable().openapi({ description: "A general sale from out of state." }),
    foodDrug: z.number().nullable().openapi({ description: "Food and drugs, where the state taxes them at its food rate." }),
    foodDrugInterstate: z.number().nullable().openapi({ description: "Food and drugs from out of state." }),
  })
  .openapi("RatesByType", {
    description: "A rate for each kind of sale the state's files rate apart; null where the publisher gives none.",
  });

const ids = (description: string) => z.record(z.string(), z.string()).openapi({ description, example: { "Locality Code": "9454" } });

export const RatePartSchema = z
  .object({
    kind: z.enum(["state", "county", "city", "district"]),
    name: z
      .string()
      .nullable()
      .optional()
      .openapi({ description: "As the state's data writes it, else the Census outline's; null where no source names it.", example: "Seattle" }),
    code: z.string().openapi({ description: "The publisher's jurisdiction type and code.", example: "01:63000" }),
    rate: rate("This part's rate.", 0.065),
    byType: RatesByTypeSchema.optional(),
    ids: ids("The state's own ids for this tax, keyed by its data's column names and unchanged; {} where it publishes none.").optional(),
  })
  .openapi("RatePart", { description: "One tax adding up to the rate." });

export const ReportingSchema = z
  .object({
    agency: z.object({ name: z.string(), url: z.string() }).openapi({ description: "Who the state's return goes to." }),
    form: z.string().nullable().openapi({ description: "The return most sellers file there." }),
    notes: z.array(z.string()).openapi({ description: "Filing that doesn't go through that return: self-collected cities, a remote sellers' program." }),
  })
  .openapi("Reporting");

const REGION_KINDS = ["transit", "tax_area", "special_district", "civil", "boundary_change", "police_jurisdiction", "incentive_zone"] as const;

export const RegionSourceSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    snapshotId: z.string(),
    edition: z.string().nullable(),
    observedAt: z.string(),
    startsOn: z.string().nullable(),
    endsOn: z.string().nullable(),
    dateBasis: z.enum(["published_edition", "latest_snapshot"]).openapi({
      description: "latest_snapshot: an undated source's latest copy; its observedAt is not a legal effective date.",
    }),
    note: z.string().nullable(),
  })
  .openapi("RegionSource");

export const RegionsSchema = z
  .object({
    matches: z.array(
      z
        .object({
          kind: z.enum(REGION_KINDS),
          type: z.string(),
          name: z.string().nullable(),
          ids: z.record(z.string(), z.string()),
          featureId: z.string().openapi({ description: "The feature's id within its snapshot." }),
          attributes: z.record(z.string(), z.unknown()).openapi({ description: "The publisher's attributes, names and units unchanged." }),
          source: RegionSourceSchema,
        })
        .openapi("RegionMatch"),
    ),
    coverage: z.array(
      z
        .object({
          source: z.string(),
          status: z.enum(["evaluated", "unavailable", "date_uncovered", "location_uncertain", "incomplete", "error"]).openapi({
            description: "Only evaluated with no match means the address is outside that source's areas.",
          }),
          details: RegionSourceSchema.optional(),
        })
        .openapi("RegionCoverage"),
    ),
  })
  .openapi("Regions", {
    description: "With include=regions: published areas the address is in. Evidence only; they don't change the rate.",
  });

const ACCURACY = z.enum(["rooftop", "parcel", "point", "interpolated"]);
const point = { lon: z.number(), lat: z.number() };

export const TraceSchema = z
  .object({
    geocoders: z.array(z.object({ source: z.string(), ...point, accuracy: ACCURACY })).openapi({ description: "Every point a geocoder returned." }),
    point: z
      .object({ ...point, accuracy: ACCURACY, source: z.string(), marginMetres: z.number(), spreadMetres: z.number() })
      .optional()
      .openapi({ description: "The point used, and the margin a boundary must be beyond." }),
    outlines: z.array(
      z.object({
        kind: z.enum(["county", "place", "cousub", "district"]),
        fips: z.string(),
        name: z.string(),
        inside: z.boolean(),
        edgeMetres: z.number(),
        foot: z.object(point),
        levies: z.boolean(),
        geometry: z
          .object({ type: z.enum(["Polygon", "MultiPolygon"]), coordinates: z.array(z.unknown()) })
          .optional()
          .openapi({ description: "GeoJSON, clipped and simplified for display." }),
      }),
    ),
    range: z
      .object({ street: z.string(), low: z.number(), high: z.number(), side: z.enum(["odd", "even", "both"]), zip: z.string().nullable(), file: z.string() })
      .optional()
      .openapi({ description: "The street range that decided, when one did." }),
  })
  .openapi("Trace", { description: "With include=trace: how the address was placed. Never changes the answer." });

export const AddressRateSchema = z
  .object({
    state: z.string().openapi({ example: "WA" }),
    rate: rate("The combined rate on a general sale, as a decimal: 0.1055 is 10.55%."),
    stateRate: rate("The state's part.", 0.065),
    localRate: rate("Everything else.", 0.0405),
    byType: RatesByTypeSchema,
    parts: z.array(RatePartSchema),
    match: z.enum(["statewide", "street", "zip4", "zip5", "map", "zip_area", "authority"]).openapi({
      description:
        "How the address was placed: one rate statewide, a street range, a ZIP+4 range, a ZIP whose ranges agree, map outlines, a ZIP area with one rate, or the state's own lookup.",
    }),
    locationCode: z.string().nullable().openapi({ description: "OpenTaxRate's key for the combination of taxes. Not a filing code.", example: "53-000-63000" }),
    locationIds: ids("The state's own ids for the whole location; {} where its data gives none, or the address could be in areas whose ids differ.").openapi({
      example: { "Composite SER Code": "01726" },
    }),
    zip4: z.string().nullable().openapi({ description: "The address's ZIP+4, where a Streamlined state's files give it." }),
    source: z.string().openapi({ description: "The files or service the rate came from, and the date." }),
    reporting: ReportingSchema.nullable(),
    regions: RegionsSchema.optional(),
    trace: TraceSchema.optional(),
  })
  .openapi("AddressRate");

export const ERROR_CODES = [...RATE_ERROR_CODES, "BAD_REQUEST", "INTERNAL"] as const;

export const ErrorSchema = z
  .object({
    error: z.string().openapi({ description: "Why, as a person reads it.", example: "This address is within 12 m of a city line ..." }),
    code: z.enum(ERROR_CODES).openapi({ description: "Stable, for a program." }),
    trace: TraceSchema.optional().openapi({ description: "On a 422, with include=trace." }),
  })
  .openapi("Error");

export const RateQuerySchema = z.object({
  address: z.string().trim().max(300).optional().openapi({
    description: "The whole address on one line. Commas are optional; the state can be a code or its name. The fields below win over it.",
    example: "1410 E Pine St, Seattle, WA 98122",
  }),
  state: z.string().trim().length(2).optional().openapi({ description: "Two-letter state code. Required without address.", example: "WA" }),
  street: z.string().trim().max(200).default("").openapi({ description: "House number and street.", example: "1410 E Pine St" }),
  city: z.string().trim().max(100).default("").openapi({ example: "Seattle" }),
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}(?:-?\d{4})?$/)
    .optional()
    .openapi({ description: "Five digits or ZIP+4. Recommended: without it the address is geocoded, and a few more are refused.", example: "98122" }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .openapi({ description: "YYYY-MM-DD; today when absent.", example: "2026-10-22" }),
  include: z.string().max(100).optional().openapi({ description: "Comma-separated: trace, regions. Others are ignored.", example: "regions" }),
});

export const CoverageSchema = z
  .array(
    z.object({
      state: z.string(),
      method: z.enum(["statewide", "ranges", "map", "authority"]).nullable(),
      geocoders: z.array(
        z.object({
          id: z.string(),
          sources: z.array(z.string()),
          typicalAccuracy: ACCURACY,
          dailyCap: z.number(),
          ratePerSecond: z.number(),
          storable: z.boolean(),
        }),
      ),
      regionSources: z.array(z.object({ id: z.string(), kind: z.enum(REGION_KINDS), type: z.string(), note: z.string() })),
      files: z.array(z.object({ kind: z.enum(["rates", "boundaries"]), file: z.string(), rows: z.number(), loadedAt: z.string() })),
    }),
  )
  .openapi("Coverage");
