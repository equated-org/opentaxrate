/**
 * The shapes every address-rate engine shares: a rate's parts, and its
 * rates by type of sale.
 */

export interface RatePart {
  kind: "state" | "county" | "city" | "district";
  /** The publisher's jurisdiction type and code, e.g. "00:061". */
  code: string;
  rate: number;
  /** This part's rate for each kind of sale, where its file rates them apart. */
  byType?: RatesByType;
}

/** A rate for each kind of sale the Streamlined files rate apart. `general`
 *  is the rate on a general sale from within the state; the others are null
 *  where the publisher gives none. A food and drug rate is what applies
 *  where the state taxes food at its food rate, not whether an item is
 *  taxable. */
export interface RatesByType {
  general: number;
  generalInterstate: number | null;
  foodDrug: number | null;
  foodDrugInterstate: number | null;
}

export const RATE_TYPES = ["general", "generalInterstate", "foodDrug", "foodDrugInterstate"] as const;

/** Only the general rate known. */
export const generalOnly = (rate: number): RatesByType => ({
  general: rate,
  generalInterstate: null,
  foodDrug: null,
  foodDrugInterstate: null,
});

/** Parts' rates added type by type; a type any part lacks is unknown. */
export function sumByType(parts: RatesByType[]): RatesByType {
  const sum = (type: (typeof RATE_TYPES)[number]) => {
    let total = 0;
    for (const p of parts) {
      const r = p[type];
      if (r === null) return null;
      total += r;
    }
    return Math.round(total * 1e6) / 1e6;
  };
  return {
    general: sum("general")!,
    generalInterstate: sum("generalInterstate"),
    foodDrug: sum("foodDrug"),
    foodDrugInterstate: sum("foodDrugInterstate"),
  };
}

/** The types every one of `rates` agrees on; null for the rest. */
export function agreedByType(rates: RatesByType[]): RatesByType {
  const agreed = { ...rates[0] };
  for (const type of RATE_TYPES.slice(1) as Exclude<(typeof RATE_TYPES)[number], "general">[])
    if (rates.some((r) => r[type] !== agreed[type])) agreed[type] = null;
  return agreed;
}

