/**
 * Reads California's current combined sales-tax rate from the CDTFA.
 * Only a single tax area with a confident rooftop address match is accepted;
 * boundary ambiguity and coarse geocodes need a manual lookup.
 */
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { marginOf, type LocatedPoint } from "../geocoding/types.js";
import { RateError } from "../errors.js";
import { HELD_PREFIX, isHeld, outlinesAt, padAround } from "./shapes.js";
import { traceOutline, type Trace } from "./types.js";

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

/** Whether any dated CDTFA tax area, verified or held, is indexed for the
 *  date: without one the address needn't be placed to look for one. */
export async function californiaIndexedOn(date: string) {
  const [row] = await db.execute<{ indexed: boolean }>(sql`
    select exists (select 1 from sales_tax_shapes where state = 'CA'
      and (fips like 'tac:%' or fips like ${`${HELD_PREFIX}%`}) and ${date} between starts_on and ends_on) as indexed`);
  return Boolean(row?.indexed);
}

/** A dated CDTFA tax area loaded into the ordinary shape and rate tables:
 *  verified with its rate; near_edge when the point's margin reaches an
 *  outline (`held` when that outline couldn't be verified); unresolved
 *  inside a held outline or where verified areas disagree. Null where none
 *  is indexed at the point. */
export async function californiaIndexedRate(point: LocatedPoint, date: string, trace?: Trace): Promise<
  | { status: "verified"; rate: number; code: string; file: string }
  | { status: "near_edge"; held: boolean }
  | { status: "unresolved" }
  | null
> {
  const margin=marginOf(point);
  const outlines=await outlinesAt("CA",point,date,"indexed",padAround(point));
  const tacOf=(fips:string)=>fips.startsWith("tac:")?fips.split(":")[1]:null;
  const codes=[...new Set(outlines.map(o=>tacOf(o.fips)).filter((c):c is string=>c!==null))];
  const rates=codes.length?await db.execute<{code:string;rate:string}>(sql`
    select code,rate from sales_tax_jurisdiction_rates where state='CA' and type='tac'
      and code in (${sql.join(codes.map(c=>sql`${c}`),sql`, `)}) and ${date} between starts_on and ends_on`):[];
  // Each outline with each of its tax area's rates on the date, or none.
  const rows=outlines.flatMap(o=>{
    const own=rates.filter(r=>r.code===tacOf(o.fips));
    return own.length?own.map(r=>({...o,code:r.code as string|null,rate:Number(r.rate)})):[{...o,code:null,rate:NaN}];
  });
  const result = (() => {
    // An outline without its dated rate is as unverified as a held one.
    const held=rows.filter(r=>isHeld(r.fips) || r.code===null), verified=rows.filter(r=>!held.includes(r));
    if(held.some(r=>r.inside && r.edgeMetres>margin)) return {status:"unresolved" as const};
    if(held.some(r=>r.edgeMetres<=margin)) return {status:"near_edge" as const,held:true};
    const inside=verified.filter(r=>r.inside);
    if(!inside.length) return null;
    if(verified.some(r=>r.edgeMetres<=margin)) return {status:"near_edge" as const,held:false};
    const first=inside[0];
    if(inside.some(r=>r.code!==first.code || r.rate!==first.rate)) return {status:"unresolved" as const};
    return {status:"verified" as const,rate:first.rate,code:first.code!,file:first.file};
  })();
  if(trace) for(const r of rows)
    traceOutline(trace,r).levies=result?.status==="verified" && r.inside && r.code===result.code;
  return result;
}
