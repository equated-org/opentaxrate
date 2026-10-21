/**
 * One rate lookup as the API and the CLI ask it: the address placed on the
 * map (by every configured geocoder together) only when the engine needs it.
 */
import { addressRates, locateAddress, type AddressRate } from "./engine/index.js";
import { mapboxGeocoder } from "./geocoders.js";

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
  return addressRates.at(
    {
      state,
      street: q.street,
      city: q.city,
      zip: q.zip,
      locate: () => locateAddress({ street: q.street, city: q.city, state, zip: q.zip }, primary),
    },
    date,
  );
}
