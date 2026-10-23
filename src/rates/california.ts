/**
 * Reads California's current combined sales-tax rate from the CDTFA.
 * Only a single tax area with a confident rooftop address match is accepted;
 * boundary ambiguity and coarse geocodes need a manual lookup.
 */
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import type { LocatedPoint } from "../geocoding/types.js";
import { RateError } from "../errors.js";
import { HELD_PREFIX } from "./shapes.js";
import { indexedTaxAreas } from "./range-polygons.js";
import type { Trace } from "./types.js";

interface StateTaxAddress {
  street: string;
  city: string;
  zip: string;
}

const responseSchema = z.object({
  taxRateInfo: z.array(
    z.object({
      rate: z.number().gt(0).lt(1),
      tac: z.string().min(1),
    }),
  ),
  geocodeInfo: z.object({
    matchCodes: z.array(z.string()),
    confidence: z.string(),
    calcMethod: z.string(),
  }),
});

const pointSchema = z.object({
  taxRateInfo: z.array(z.object({ rate: z.number().gt(0).lt(1), tac: z.string().min(1) })),
});

export const californiaSalesTaxService = {
  /** CDTFA's rate at a point: every tax area within its 50 m buffer, so one
   *  area means no boundary within 50 m. Null when the service fails. */
  async atPoint(lon: number, lat: number) {
    const url = new URL("https://services.maps.cdtfa.ca.gov/api/taxrate/GetRateByLngLat");
    url.search = new URLSearchParams({ Longitude: String(lon), Latitude: String(lat) }).toString();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      const parsed = pointSchema.safeParse(await response.json());
      return parsed.success ? parsed.data.taxRateInfo : null;
    } catch {
      return null;
    }
  },

  async lookup(address: StateTaxAddress) {
    const url = new URL(
      "https://services.maps.cdtfa.ca.gov/api/taxrate/GetRateByAddress",
    );
    url.search = new URLSearchParams({
      address: address.street,
      city: address.city,
      // CDTFA accepts five digits and geocodes the street, not a ZIP-only rate.
      zip: address.zip.slice(0, 5),
    }).toString();

    let payload: unknown;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 400) {
        throw new RateError(
          "California tax lookup rejected the address. Verify the street, city, and ZIP.",
          422,
        );
      }
      if (!response.ok) {
        throw new RateError("California tax lookup is unavailable", 502);
      }
      payload = await response.json();
    } catch (error) {
      if (error instanceof RateError) throw error;
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new RateError(
        timedOut
          ? "California tax lookup timed out"
          : "California tax lookup is unavailable or returned an invalid response",
        timedOut ? 504 : 502,
      );
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new RateError(
        "California tax lookup returned an invalid response",
        502,
      );
    }
    const { taxRateInfo, geocodeInfo } = parsed.data;
    if (
      taxRateInfo.length !== 1 ||
      geocodeInfo.confidence !== "High" ||
      geocodeInfo.calcMethod !== "Rooftop" ||
      geocodeInfo.matchCodes.length !== 1 ||
      geocodeInfo.matchCodes[0] !== "Good"
    ) {
      throw new RateError(
        taxRateInfo.length === 0
          ? "California found no tax area for this address. Verify the street, city, and ZIP before retrying."
          : taxRateInfo.length > 1
            ? "California returned multiple tax areas for this address. Confirm the correct area with California's lookup; no rate has been selected."
            : "California did not return a single Good, High-confidence rooftop address match. Verify the address with California's lookup; no approximate rate has been returned.",
        422,
      );
    }

    return {
      rate: taxRateInfo[0].rate,
      locationCode: taxRateInfo[0].tac,
      locationCodeType: "ca_cdtfa_tax_area" as const,
      lookedUpAt: new Date().toISOString(),
      source: "https://services.maps.cdtfa.ca.gov/",
    };
  },
};

/** CDTFA's codes for a tax area, as `locationIds`: the 12-character tax
 *  area code its lookups and layers give, and its first five characters,
 *  the county and city (998 unincorporated) a return's schedules ask for
 *  (CDTFA-531-FL1 lists them; every prefix in CDTFA's layer is there).
 *  {} for a code that doesn't start with five digits. */
export function californiaLocationIds(tac: string): Record<string, string> {
  const local = /^\d{5}/.exec(tac)?.[0];
  return local ? { "Tax Area Code": tac, "Local Tax Area Code": local } : {};
}

/** Whether any dated CDTFA tax area, verified or held, is indexed for the
 *  date: without one the address needn't be placed to look for one. */
export async function californiaIndexedOn(date: string) {
  const [row] = await db.execute<{ indexed: boolean }>(sql`
    select exists (select 1 from sales_tax_shapes where state = 'CA'
      and (area_id is not null or fips like ${`${HELD_PREFIX}%`}) and ${date} between starts_on and ends_on) as indexed`);
  return Boolean(row?.indexed);
}

/** A dated CDTFA tax area, indexed as an ordinary verified area (its one
 *  district "tac:<code>") with a dated "tac" row holding CDTFA's total:
 *  verified with that rate; near_edge when the point's margin reaches an
 *  outline (`held` when that outline couldn't be verified); unresolved
 *  inside a held outline, where verified areas disagree, or where the
 *  area's rate isn't dated to the day. Null where none is indexed at the
 *  point. The outlines are read as every verified area's are
 *  (indexedTaxAreas), with no ZIP's candidates to narrow them: California
 *  publishes none, and its areas are all built by verification. */
export async function californiaIndexedRate(point: LocatedPoint, date: string, trace?: Trace): Promise<
  | { status: "verified"; rate: number; code: string; file: string }
  | { status: "near_edge"; held: boolean }
  | { status: "unresolved" }
  | null
> {
  const found = await indexedTaxAreas("CA", [], point, date, trace);
  if (!found) return null;
  if (found.status === "near_edge") return { status: "near_edge", held: found.held };
  if (found.status === "unresolved" || !found.areas.length) return { status: "unresolved" };
  const rows = await db.execute<{ code: string; rate: string }>(sql`
    select r.code, r.rate from sales_tax_areas a
    join sales_tax_jurisdiction_rates r on r.state = 'CA' and r.type = 'tac' and a.districts = 'tac:' || r.code
      and ${date} between r.starts_on and r.ends_on
    where a.state = 'CA' and a.id in (${sql.join(found.areas.map((id) => sql`${id}`), sql`, `)})`);
  const rated = new Set(rows.map((r) => `${r.code}|${Number(r.rate)}`));
  if (rated.size !== 1 || rows.length < found.areas.length) {
    // No single dated rate: the outline that held the point levies nothing shown.
    for (const o of trace?.outlines ?? []) if (o.fips.startsWith("area:")) o.levies = false;
    return { status: "unresolved" };
  }
  return { status: "verified", rate: Number(rows[0].rate), code: rows[0].code, file: found.file };
}
