/**
 * An address in the Postal Service's own form, with its ZIP+4, from a
 * standardizing service. Only Geocodio for now, used when GEOCODIO_API_KEY
 * is set; addressStandardizer() returns undefined otherwise.
 *
 * The ZIP+4 is what matters: a state that publishes only ZIP+4 ranges (Utah)
 * can place an address by it, and in any range state it settles a ZIP the
 * typed street didn't. Only a single, confident, in-state match with exactly
 * one ZIP+4 is used; anything less is no answer, never a guess. A ZIP+4 the
 * Postal Service marks inexact (a building's, when no unit was given) is
 * used and said so: a building's units don't lie in different tax areas.
 * Rural addresses often have no ZIP+4 at all, and get no answer here.
 */

export interface AddressToStandardize {
  street: string;
  city: string;
  state: string;
  zip?: string | null;
}

export interface StandardAddress {
  /** The street line as the Postal Service writes it, e.g. "350 N State St". */
  street: string;
  city: string;
  state: string;
  zip5: string;
  plus4: string;
  /** False when the ZIP+4 is the building's or block's rather than the
   *  address's own (Geocodio's exact_match). */
  exact: boolean;
  /** Who standardized it, for the answer's source. */
  source: string;
}

export type Standardizer = (a: AddressToStandardize) => Promise<StandardAddress | null>;

const GEOCODIO = "https://api.geocod.io/v2/geocode";
const TIMEOUT_MS = 5_000;
/** Geocodio's own score for the match, 0 to 1. */
const MIN_ACCURACY = 0.9;
const PLACED = ["rooftop", "point", "range_interpolation"];

export function addressStandardizer(): Standardizer | undefined {
  const key = process.env.GEOCODIO_API_KEY;
  if (!key) return undefined;
  return async (a) => {
    const url = new URL(GEOCODIO);
    url.search = new URLSearchParams({
      street: a.street,
      city: a.city,
      state: a.state,
      ...(a.zip ? { postal_code: a.zip.slice(0, 5) } : {}),
      fields: "zip4",
      limit: "2",
      api_key: key,
    }).toString();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) return null;
      return fromGeocodio(await response.json(), a.state);
    } catch {
      return null;
    }
  };
}

interface GeocodioResult {
  accuracy?: number;
  accuracy_type?: string;
  formatted_address?: string;
  address_components?: {
    number?: string;
    formatted_street?: string;
    city?: string;
    /** v2's names; v1 called them state and zip. */
    state_province?: string;
    postal_code?: string;
    state?: string;
    zip?: string;
  };
  fields?: { zip4?: { plus4?: string[]; exact_match?: boolean } };
}

/** The one usable answer in a Geocodio response, or null. */
export function fromGeocodio(body: unknown, state: string): StandardAddress | null {
  const results = ((body as { results?: GeocodioResult[] })?.results ?? []).filter(
    (r) =>
      (r.accuracy ?? 0) >= MIN_ACCURACY &&
      PLACED.includes(r.accuracy_type ?? "") &&
      (r.address_components?.state_province ?? r.address_components?.state)?.toUpperCase() === state,
  );
  if (results.length !== 1) return null;
  const [r] = results;
  const c = r.address_components!;
  const zip5 = c.postal_code ?? c.zip;
  const plus4 = r.fields?.zip4?.plus4 ?? [];
  if (plus4.length !== 1 || !/^\d{4}$/.test(plus4[0])) return null;
  if (!c.number || !c.formatted_street || !zip5 || !/^\d{5}$/.test(zip5)) return null;
  return {
    street: `${c.number} ${c.formatted_street}`,
    city: c.city ?? "",
    state,
    zip5,
    plus4: plus4[0],
    exact: r.fields?.zip4?.exact_match !== false,
    source: "Geocodio",
  };
}
