/**
 * Reads California's current combined sales-tax rate from the CDTFA.
 * Only a single tax area with a confident rooftop address match is accepted;
 * boundary ambiguity and coarse geocodes need a manual lookup.
 */
import { z } from "zod";
import { RateError } from "../errors.js";

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
