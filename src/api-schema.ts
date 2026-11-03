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
import { TAX_CODES } from "./taxability/codes.js";

const rate = (description: string, example = 0.1055) => z.number().openapi({ description, example });

export const RatesByTypeSchema = z
  .object({
    general: z.number().openapi({ description: "A general sale from within the state." }),
    generalInterstate: z.number().nullable().openapi({ description: "A general sale from out of state." }),
    foodDrug: z.number().nullable().openapi({ description: "Food and drugs, where the state taxes them at its food rate." }),
    foodDrugInterstate: z.number().nullable().openapi({ description: "Food and drugs from out of state." }),
  })
  .openapi("RatesByType", {
    description:
      "The address's rate tables by type of sale, as the state's files publish them (a state's food-and-drug rate); null where the publisher gives none. Not this sale's taxability: foodDrug is the published table's rate, even where groceries are exempt. For what a sale is taxed, send code= and read taxability[code].rate.",
  });

const ids = (description: string) => z.record(z.string(), z.string()).openapi({ description, example: { "Locality Code": "9454" } });

/** The location ids a state gives, by key, so a generated client has them
 *  as fields; any other key a state's data names still passes. */
const code = (description: string, example: string) => z.string().optional().openapi({ description, example });
export const LocationIdsSchema = z
  .object({
    "Composite SER Code": code("Streamlined states' location code. In Washington, the DOR location code zero-padded to five digits: 01726 is 1726.", "01726"),
    "Location Code": code("Washington: the DOR's four-digit location code a Combined Excise Tax Return files under; Composite SER Code without its padding zero.", "1726"),
    "Jurisdiction Code": code("Missouri's jurisdiction code for the location.", "15670-019-000"),
    "Tax Area Code": code("California: CDTFA's 12-character tax area code.", "19034D900000"),
    "Local Tax Area Code": code("California: the five-digit county and city code (998 unincorporated) a CDTFA return's schedules ask for; the first five characters of Tax Area Code.", "19034"),
  })
  .catchall(z.string())
  .openapi({
    description:
      "The state's own codes for the whole location, keyed by the name its data gives them; values are strings, leading zeros kept. {} where its data gives none, or the address could be in areas whose ids differ: read a key as possibly absent.",
    example: { "Composite SER Code": "01726", "Location Code": "1726" },
  });

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
    classRates: z
      .object({
        restaurant: z.number().optional().openapi({ description: "Food and drink sold by a restaurant or bar: Arizona's restaurants and bars class (business code 011, plus a city's additional 111), or Utah's county restaurant tax added to the county's rate.", example: 0.039 }),
        grocery: z.number().optional().openapi({ description: "Food for home consumption: Arizona's city rate on it (business code 062), Alabama's local food rate (GROC), Illinois's local grocery rate from 2026.", example: 0.025 }),
      })
      .optional()
      .openapi({
        description:
          "This part's rate on a class of sale its state rates apart from the general sale, on the answer's date, from the same published table as the general rate. Absent for a class the state's data gives no rate for: never read the general rate in its place. Taxability rules use them (rateClass); `rate` stays the general rate.",
        example: { restaurant: 0.039, grocery: 0.025 },
      }),
    ids: ids("The state's own ids for this tax, keyed by its data's column names and unchanged; {} where it publishes none.").optional(),
  })
  .openapi("RatePart", { description: "One tax adding up to the rate." });

export const ReportingSchema = z
  .object({
    agency: z.object({ name: z.string(), url: z.string() }).openapi({ description: "Who the state's return goes to." }),
    form: z.string().nullable().openapi({ description: "The return most sellers file there." }),
    notes: z.array(z.string()).openapi({ description: "Filing that doesn't go through that return: self-collected cities, a remote sellers' program." }),
    locationKey: z.string().nullable().openapi({
      description:
        "The locationIds key the return files this location under: read locationIds[locationKey]. Null where the state's data gives no location code; the key may still be missing from locationIds where the address could be in areas whose codes differ.",
      example: "Location Code",
    }),
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

const TREATMENTS = ["taxable", "special_rate", "exempt", "zero_rated", "conditional", "not_a_sale"] as const;

export const TaxabilityRuleSchema = z
  .object({
    from: z.string().openapi({ description: "First day the rule answers for.", example: "2019-04-08" }),
    to: z.string().optional().openapi({ description: "Last day in force; open-ended when absent." }),
    fromIs: z.enum(["effective", "earliest_verified"]).openapi({
      description: "effective: the sources give from as the day the rule took effect. earliest_verified: the rule is likely older, but earlier dates are not researched.",
    }),
    treatment: z.enum(TREATMENTS),
    rate: z.number().optional().openapi({ description: "For special_rate: the rate this tax charges on the code instead of its general rate (lower, like a grocery rate, or higher, like a meals tax).", example: 0.04 }),
    rateClass: z.enum(["restaurant", "grocery"]).optional().openapi({ description: "For special_rate, in place of rate: each part this rule decides is taxed at its own rate for this class, the part's classRates entry (Arizona's city restaurant rates). A part with no rate for the class is not researched.", example: "restaurant" }),
    base: z.number().optional().openapi({ description: "The share of the charge taxed, where the law taxes only part of it (0 < base < 1): Texas taxes 80% of a data processing charge. The answer's rates already apply it, on the whole charge (6.6% where the general rate is 8.25%); don't reduce the amount as well. Absent: the whole charge.", example: 0.8 }),
    summary: z.string().openapi({ example: "Catering is taxable, including staff, rentals and service charges on the bill." }),
    conditions: z.array(
      z.object({
        when: z.string(),
        treatment: z.enum(["taxable", "special_rate", "exempt", "zero_rated"]),
        rate: z.number().optional().openapi({ description: "The part's rate in this case, where it isn't the part's full rate." }),
        rateClass: z.enum(["restaurant", "grocery"]).optional().openapi({ description: "In this case, each part is taxed at its rate for this class (its classRates entry), as on the rule." }),
        base: z.number().optional().openapi({ description: "In this case, the share of the charge taxed, where the law taxes only part of it (0 < base < 1), as on the rule; the outcomes apply it.", example: 0.8 }),
        code: z.string().optional().openapi({ description: "In an answer for a broad code: the narrower code this case is; send it to settle the answer.", example: "service.professional.design" }),
      }),
    ).openapi({ description: "For a conditional rule, each fact the outcome turns on; for a settled one, exceptions worth knowing: a numeric rate holds unless one of them fits the sale (Kentucky's grandfathered fixed-price contracts)." }),
    citations: z
      .array(
        z.object({
          title: z.string(),
          url: z.string().openapi({ description: "The official page, as published." }),
          quote: z.string().optional().openapi({ description: "The sentence on it the rule rests on, verbatim." }),
          archived: z.string().optional().openapi({
            description: "OpenTaxRate's archived copy that shows the quote, opening at the sentence; it names the original too.",
            example: "https://evidence.opentaxrate.com/sha256/e4465b57cef9b1132a0a459c7ad61459a1285fb8a8e9fa58ac916a12de0aeca2#:~:text=Food%20prepared%20for%20sale,further%20preparation%20are%20taxable",
          }),
          sha256: z.string().optional().openapi({ description: "That copy's SHA-256: the exact bytes the rule was checked against." }),
          page: z.number().int().optional().openapi({ description: "For a PDF, the page the quote is on: open the original or the archived PDF at #page=N.", example: 3 }),
        }),
      )
      .openapi({ description: "The official pages the rule was read from." }),
  })
  .openapi("TaxabilityRule");

export const TaxabilitySchema = z
  .object({
    treatment: z.enum(["taxable", "partial", "not_taxed", "conditional", "not_researched"]).openapi({
      description:
        "taxable: every part at its rate. partial: some parts, a special rate, or a share of the charge (base). not_taxed: no part. conditional: the outcome turns on facts the code doesn't fix, listed in the rules' conditions. not_researched: a part has no researched rule for this code on this date; never use the general rate instead.",
    }),
    rate: z.number().nullable().openapi({ description: "The combined rate on this sale; null exactly when conditional or not researched.", example: 0.08875 }),
    taxes: z.array(
      z
        .object({
          tax: z.string().openapi({ description: "What the rule covers: a state (every part there), CA:GST/HST, a province's HST change (ON/CA:HST), a provincial tax (BC:PST), or * for a nontaxable line.", example: "NY" }),
          parts: z.array(z.string()).openapi({ description: "The codes of the answer's parts this rule decides; together the entries cover every part once." }),
          treatment: z.enum([...TREATMENTS, "not_researched"]),
          rate: z.number().nullable().openapi({ description: "What these parts add to the sale's rate; null when conditional or not researched." }),
          rule: TaxabilityRuleSchema.nullable().openapi({ description: "Null only when not researched." }),
        })
        .openapi("TaxGroup"),
    ),
    outcomes: z
      .array(
        z.object({
          when: z.string().openapi({ description: "The case, as the rules state it. Where several taxes are undecided, only cases that describe the same sale are combined: one wording where the taxes' rules say it alike, else each tax's case joined by \"; and\". On an independent answer, prefixed by its tax." }),
          rate: z.number().openapi({ description: "The sale's combined rate in this case. On an independent answer: this case's rate for its tax plus the settled taxes'.", example: 0.12 }),
          code: z.string().optional().openapi({ description: "The narrower code this case is, where it is one: send it instead to get this answer settled." }),
          tax: z.string().optional().openapi({ description: "Only on an independent answer: the tax (taxes[].tax) this case is for.", example: "VT:local" }),
        }),
      )
      .optional()
      .openapi({ description: "Only when conditional: each case the rules list with the combined rate it gives. Absent when a case's rate can't be computed or there are too many cases (over 24)." }),
    interpreted: z
      .object({
        from: z.enum(["text", "code"]).openapi({ description: "text: the code answered came from describe; code: the caller's code answered." }),
        code: z.string().nullable().openapi({ description: "The code the text points to; null when no one code fits (see candidates), or the text couldn't be read.", example: "food.prepared.hot" }),
        confidence: z.number().optional().openapi({ description: "The model's probability for that code, with its narrower kinds, to two places. A model signal, not proof: thresholds decide what's used.", example: 0.97 }),
        candidates: z.array(z.string()).optional().openapi({ description: "With no one code: the codes the text could be, likeliest first. Send one as code= to settle it." }),
        mismatch: z.literal(true).optional().openapi({ description: "With code=: the text points to a code that is neither the one sent nor broader or narrower than it. The code still answers." }),
        conditions: z
          .array(
            z.object({
              tax: z.string().openapi({ description: "The tax (taxes[].tax) the text settled.", example: "NY" }),
              when: z.array(z.string()).openapi({ description: "The case the text was read as, in the rule's words; several where the rules treat them alike and the text established one of them, likeliest first." }),
              confidence: z.number().openapi({ description: "The model's probability for these cases together, at most 1.", example: 0.95 }),
            }),
          )
          .optional()
          .openapi({ description: "The rules' cases the text settled, one per tax. A tax whose case the text doesn't establish stays conditional." }),
        unestablished: z
          .array(z.string())
          .optional()
          .openapi({
            description:
              "The codes the model leaned to whose defining fact the text doesn't establish (a tea not said to be sweetened isn't a soft drink), narrowest first. The entry then answers by a broader code whose fact it does establish, or is conditional on the candidates.",
            example: ["food.soft_drink"],
          }),
        items: z.literal(true).optional().openapi({ description: "The text names several different items. A code answers only where the text establishes that every item is of it; else the entry is conditional with needs one_item: send one item per request." }),
        unavailable: z.literal(true).optional().openapi({ description: "The model wasn't asked or failed: the entry answers as if no text was sent." }),
      })
      .optional()
      .openapi({ description: "Only with describe=: how the text was read. The model only picks among offered options; the rules decide." }),
    needs: z
      .array(z.enum(["code", "one_item", "seller_kind", "locality", "payment_date", "title_transfer", "qualifying_total", "contract_total", "quantity_by_kind"]))
      .optional()
      .openapi({
        description:
          "Only with describe=, on a conditional answer: the facts it turns on that a description can't settle. code: which code it is; one_item: the line names several different items not all of one code, send one per request; seller_kind: the seller's share of prepared-food or other sales; locality: which local taxes the place levies, only where the answer's parts don't name the place (else unresearched); payment_date: when it was paid for, in a dated tax period; title_transfer: when title passed; qualifying_total, contract_total: an amount; quantity_by_kind: how many units of each kind.",
        example: ["locality"],
      }),
    unresearched: z
      .array(z.enum(["locality"]))
      .optional()
      .openapi({
        description:
          "Only with describe=, on a conditional answer: facts it turns on that the address already settles but the rules haven't researched for this place. locality: which local taxes the place the parts name levies. Nothing for the caller to send.",
        example: ["locality"],
      }),
    independent: z.literal(true).optional().openapi({
      description:
        "Set when several taxes are undecided and their cases don't pair up: the taxes turn on their facts independently; combine one case per tax. Each outcome is then one tax's case; the sale's rate is the settled taxes' rate plus each chosen case's share (its rate less the settled taxes').",
    }),
  })
  .openapi("Taxability", {
    description: "How one kind of sale is taxed at the address on the date: the parts grouped by the rule that decided them, with the rules and their official sources.",
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
    rate: rate("The general rate: the combined rate on a general sale of goods, as a decimal (0.1055 is 10.55%). Not the rate on any particular kind of sale: with code=, the sale's own rate is taxability[code].rate."),
    stateRate: rate("The state's part.", 0.065),
    localRate: rate("Everything else.", 0.0405),
    byType: RatesByTypeSchema,
    parts: z.array(RatePartSchema),
    match: z.enum(["statewide", "street", "zip4", "zip5", "map", "zip_area", "authority"]).openapi({
      description:
        "How the address was placed: one rate statewide, a street range, a ZIP+4 range, a ZIP whose ranges agree, map outlines, a ZIP area with one rate, or the state's own lookup.",
    }),
    locationCode: z.string().nullable().openapi({ description: "OpenTaxRate's key for the combination of taxes. Not a filing code.", example: "53-000-63000" }),
    jurisdictions: z.enum(["settled", "uncertain"]).openapi({
      description:
        "Whether parts name the jurisdictions the tax is paid to. The rate is settled either way; uncertain where the address could be in another combination of jurisdictions with the same total (listed in alternatives), or the state's lookup gave one local part for every local tax.",
    }),
    alternatives: z
      .array(z.object({ locationCode: z.string().nullable(), parts: z.array(RatePartSchema) }))
      .openapi({ description: "The other combinations of jurisdictions the address could be in, each with the same total; empty when settled." }),
    locationIds: LocationIdsSchema,
    zip4: z.string().nullable().openapi({ description: "The address's ZIP+4, where a Streamlined state's files give it." }),
    source: z.string().openapi({ description: "The files or service the rate came from, and the date." }),
    reporting: ReportingSchema.nullable(),
    taxability: z.record(z.string(), TaxabilitySchema).optional().openapi({
      description: `With code=: one entry per code asked, keyed by the code (${Object.keys(TAX_CODES).join(", ")}). With describe= and no code: one entry keyed by the text as sent.`,
    }),
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
    .regex(/^(?:\d{5}(?:-?\d{4})?|[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d)$/)
    .optional()
    .openapi({ description: "Five digits or ZIP+4. Recommended: without it the address is geocoded, and a few more are refused.", example: "98122" }),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .openapi({ description: "YYYY-MM-DD; today when absent.", example: "2026-10-22" }),
  code: z.string().max(300).optional().openapi({
    description: `What was sold, one or more codes separated by commas, from: ${Object.keys(TAX_CODES).join(", ")}. Adds taxability to the answer, one entry per code; an unknown code is a 400.`,
    example: "food.catering,nontaxable",
  }),
  describe: z.string().trim().min(1).max(200).optional().openapi({
    description:
      "What was sold, in plain words: one item, up to 200 characters. Needs an API key (without one, a 403 KEY_REQUIRED). A model (TypeSafe's Jev) only picks among offered options: the code whose definition the words establish, and which of the rules' listed cases they establish; the rules decide the tax. A fact the words don't state stays open, and the answer stays conditional. Alone, it adds taxability keyed by the text as sent; beside one code, the code answers and the text settles its cases and is checked against it. Beside two or more codes it is a 400. Prices in the words never settle a case that turns on an amount.",
    example: "a hot rotisserie chicken from the deli warmer",
  }),
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
      taxabilityCodes: z.array(z.string()).openapi({ description: "The codes with a researched rule here today, for code=; others answer not_researched." }),
      files: z.array(z.object({ kind: z.enum(["rates", "boundaries"]), file: z.string(), rows: z.number(), loadedAt: z.string() })),
    }),
  )
  .openapi("Coverage");
