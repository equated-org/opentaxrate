/**
 * One rate lookup as the API and the CLI ask it: the address placed on the
 * map (by every configured geocoder together) only when the engine needs it.
 */
import { addressRates, type AddressRate } from "./rates/index.js";
import { locateAddress } from "./geocoding/index.js";
import { addressStandardizer } from "./standardize/index.js";
import { mapboxGeocoder } from "./geocoding/mapbox.js";

export interface RateQuery {
  state: string;
  street: string;
  city: string;
  zip?: string;
  /** YYYY-MM-DD; today when absent. */
  date?: string;
}

export function lookUpRate(q: RateQuery): Promise<AddressRate> {
  const state = q.state.toUpperCase();
  const date = q.date ?? new Date().toISOString().slice(0, 10);
  const primary = mapboxGeocoder();
  const standardizer = addressStandardizer();
  return addressRates.at(
    {
      state,
      street: q.street,
      city: q.city,
      zip: q.zip,
      locate: () => locateAddress({ street: q.street, city: q.city, state, zip: q.zip }, primary),
      standardize: standardizer && (() => standardizer({ street: q.street, city: q.city, state, zip: q.zip })),
    },
    date,
  );
}
