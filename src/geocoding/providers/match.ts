import { parseStreet } from "../../address.js";
import type { AddressToLocate } from "../types.js";

// Photon deployments return either state names or postal abbreviations.
export const STATES = Object.fromEntries([
  "AL|Alabama", "AK|Alaska", "AZ|Arizona", "AR|Arkansas", "CA|California",
  "CO|Colorado", "CT|Connecticut", "DE|Delaware", "DC|District of Columbia",
  "FL|Florida", "GA|Georgia", "HI|Hawaii", "ID|Idaho", "IL|Illinois",
  "IN|Indiana", "IA|Iowa", "KS|Kansas", "KY|Kentucky", "LA|Louisiana",
  "ME|Maine", "MD|Maryland", "MA|Massachusetts", "MI|Michigan", "MN|Minnesota",
  "MS|Mississippi", "MO|Missouri", "MT|Montana", "NE|Nebraska", "NV|Nevada",
  "NH|New Hampshire", "NJ|New Jersey", "NM|New Mexico", "NY|New York",
  "NC|North Carolina", "ND|North Dakota", "OH|Ohio", "OK|Oklahoma", "OR|Oregon",
  "PA|Pennsylvania", "RI|Rhode Island", "SC|South Carolina", "SD|South Dakota",
  "TN|Tennessee", "TX|Texas", "UT|Utah", "VT|Vermont", "VA|Virginia",
  "WA|Washington", "WV|West Virginia", "WI|Wisconsin", "WY|Wyoming",
].map(s => s.split("|")));

export const normalized = (s: string) => s.trim().toUpperCase().replace(/\s+/g, " ");
// Keep lettered, fractional, hyphenated and grid numbers distinct.
export const houseOf = (line: string) => {
  const text = normalized(line);
  const fraction = /^(\d+)\s+(\d+\/\d+)\s/.exec(text);
  return fraction ? `${fraction[1]} ${fraction[2]}` : parseStreet(text)?.houseText;
};

/** Strictly compare returned address components before accepting coordinates. */
export function matchesAddress(a: AddressToLocate, found: { street?: string; house?: string; city?: string; state?: string; zip?: string; country?: string }) {
  if (!found.street || !found.house || found.country?.toUpperCase() !== "US") return false;
  const state = normalized(a.state);
  const foundState = normalized(found.state ?? "");
  if (foundState !== state && foundState !== STATES[state]?.toUpperCase()) return false;
  if (a.city && normalized(found.city ?? "") !== normalized(a.city)) return false;
  if (a.zip && found.zip?.slice(0, 5) !== a.zip.slice(0, 5)) return false;
  const line = `${found.house} ${found.street}`;
  const requested = parseStreet(a.street);
  const parsed = parseStreet(line);
  if (!requested || !parsed || requested.streetKey === "POBOX" || houseOf(line) !== houseOf(a.street)) return false;
  return (["streetKey", "suffix", "preDirectional", "postDirectional"] as const).every(key => parsed[key] === requested[key]);
}
