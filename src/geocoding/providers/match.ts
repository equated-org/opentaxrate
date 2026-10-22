import { parseStreet, type StreetParts } from "../../address.js";
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
  // The street piece may follow a unit ("Apt 4, 3281 1/2 M St").
  const fraction = /(?:^|,\s*)(\d+)\s+(\d+\/\d+)\s/.exec(text);
  return fraction ? `${fraction[1]} ${fraction[2]}` : parseStreet(text)?.houseText;
};

/** Strictly compare returned address components before accepting coordinates. */
export function matchesAddress(a: AddressToLocate, found: { street?: string; house?: string; city?: string; state?: string; zip?: string; country?: string }) {
  if (!found.street || !found.house || found.country?.toUpperCase() !== "US") return false;
  const state = normalized(a.state);
  const foundState = normalized(found.state ?? "");
  if (foundState !== state && foundState !== STATES[state]?.toUpperCase()) return false;
  // The typed city or ZIP must agree, not both: a mailing city or a
  // neighbouring ZIP is common, and independent providers still have to
  // agree on the point.
  const cityAgrees = !a.city || normalized(found.city ?? "") === normalized(a.city);
  const zipAgrees = !a.zip || found.zip?.slice(0, 5) === a.zip.slice(0, 5);
  if (!cityAgrees && !zipAgrees) return false;
  const line = `${found.house} ${found.street}`;
  const requested = parseStreet(a.street);
  const parsed = parseStreet(line);
  if (!requested || !parsed || requested.streetKey === "POBOX" || houseOf(line) !== houseOf(a.street)) return false;
  // A numbered highway is one road however it's written: "WI 91", "VT Route
  // 14", "United States Highway 95" and "Highway 91" all read as HWY and
  // its number, but only the address's own state's code counts. Nebraska's
  // "NE 281" is read as a direction, so it's put back.
  // The code as a street key reads it: Wyoming's "WY" is also Way's.
  const code = [state, parseStreet(`1 ${state} 1`)?.streetKey.replace(/1$/, "")].filter(Boolean).join("|");
  const road = (x: StreetParts) => {
    const nebraska = state === "NE" && x.preDirectional === "NE" && /^\d+[A-Z]?$/.test(x.streetKey);
    const key = nebraska ? `HWY${x.streetKey}` : x.streetKey;
    return {
      ...x,
      preDirectional: nebraska ? "" : x.preDirectional,
      streetKey: key.replace(new RegExp(`^(?:(?:${code})(?:HWY)?|UNITEDSTATES(?:HWY)?)(?=\\d)`), "HWY"),
    };
  };
  const want = road(requested);
  // Directions must agree: N and S Main can be miles apart.
  const sameName = (x: StreetParts) =>
    (["streetKey", "preDirectional", "postDirectional"] as const).every(key => road(x)[key] === want[key]);
  // A street typed without its type ("42725 London") is the found one with
  // it ("London Dr"); a different type is a different street.
  if (sameName(parsed) && (!requested.suffix || parsed.suffix === requested.suffix)) return true;
  // So is one whose name ends in a type word, typed without its own type
  // ("Ridge Park" for "Ridge Park Dr"): the found street, its type taken out.
  const words = found.street.trim().split(/\s+/);
  let at = -1;
  if (parsed.suffix) for (let i = words.length - 1; i > 0 && at < 0; i--) if (parseStreet(`1 X ${words[i]}`)?.suffix === parsed.suffix) at = i;
  if (at < 1) return false;
  const untyped = parseStreet(`${found.house} ${[...words.slice(0, at), ...words.slice(at + 1)].join(" ")}`);
  return !!untyped && sameName(untyped) && untyped.suffix === requested.suffix;
}
