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
  // So is one typed without a type word the found street has, wherever it
  // stands: "Ridge Park" for "Ridge Park Dr", "Forest Extension" for "Forest
  // Avenue Extension", "River 2" for "River Loop 2". Each type word is taken
  // out in turn, and what's left must read as the typed street exactly. An
  // Extension is never dropped: Forest Ave Extension isn't Forest Ave.
  const words = found.street.trim().split(/\s+/);
  if (words.some((word, i) => {
    const type = parseStreet(`1 X ${word}`)?.suffix;
    if (i === 0 || !type || /^EXT/.test(type)) return false;
    const untyped = parseStreet(`${found.house} ${[...words.slice(0, i), ...words.slice(i + 1)].join(" ")}`);
    return !!untyped && sameName(untyped) && untyped.suffix === requested.suffix;
  })) return true;
  // A one-letter typo in the name ("Mian St" for Main St), told from another
  // real street one letter away ("Byers Ln" beside "Myers Ln") by the ZIP's
  // own street list: the found street must be in it and the typed one not,
  // in the typed ZIP, with the same direction and type.
  const streets = a.zipStreets;
  if (!streets?.size || !zipAgrees || !a.zip) return false;
  const typedNames = [requested.streetKey, ...(requested.alternates ?? []).map((x) => x.streetKey)];
  return want.preDirectional === road(parsed).preDirectional && want.postDirectional === road(parsed).postDirectional
    && (!requested.suffix || parsed.suffix === requested.suffix)
    && streets.has(parsed.streetKey) && !typedNames.some((k) => streets.has(k))
    && nameOf(a.street, requested).length >= 5 && oneLetterApart(nameOf(a.street, requested), nameOf(line, parsed));
}

const DIRECTION_WORDS: Record<string, string> = {
  N: "N", NORTH: "N", S: "S", SOUTH: "S", E: "E", EAST: "E", W: "W", WEST: "W",
  NE: "NE", NORTHEAST: "NE", NW: "NW", NORTHWEST: "NW", SE: "SE", SOUTHEAST: "SE", SW: "SW", SOUTHWEST: "SW",
};
/** A street's name as written, without its house number, unit, directions
 *  and type: "MIAN" in "12 N Mian St Apt 4". Street keys abbreviate words
 *  ("Forest" is FRST), so a typo is measured on the words themselves. */
function nameOf(line: string, parts: StreetParts) {
  const words = normalized(line).replace(/[.,]/g, " ").split(/\s+/).filter(Boolean).slice(1);
  if (/^\d+\/\d+$/.test(words[0] ?? "")) words.shift();
  if (parts.unit) {
    const at = words.findIndex((w, i) => i > 0 && (w.startsWith("#") || /^(APT|APARTMENT|STE|SUITE|UNIT|BLDG|FL|FLOOR|RM|ROOM|LOT|SPC|TRLR|PH)$/.test(w)));
    if (at > 0) words.length = at;
  }
  if (parts.preDirectional && DIRECTION_WORDS[words[0]] === parts.preDirectional) words.shift();
  if (parts.postDirectional && DIRECTION_WORDS[words.at(-1) ?? ""] === parts.postDirectional) words.pop();
  if (parts.suffix && words.length > 1 && parseStreet(`1 X ${words.at(-1)}`)?.suffix === parts.suffix) words.pop();
  return words.join("");
}

/** One letter added, dropped, changed, or two side by side swapped. */
function oneLetterApart(a: string, b: string) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const d = [...a].flatMap((ch, i) => (ch === b[i] ? [] : [i]));
    return d.length === 1 || (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]);
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return [...long].some((_, i) => long.slice(0, i) + long.slice(i + 1) === short);
}
