/**
 * A one-line address ("1410 E Pine St, Seattle, WA 98122") → the fields a
 * lookup takes, for /v1/rate?address=. The same reading as the site's search
 * box (client/src/lib/search/parse.ts): change one, change the other.
 * Accepts "number street, city, ST 12345" with commas optional, the state as
 * a code or a full name, and the ZIP optional; or a Canadian address, the
 * province as a code or a name and the postal code ("M5V 3L9") optional.
 */
import { STATES } from "./geocoding/providers/match.js";
import { postalCode, PROVINCES } from "./rates/canada.js";

export interface ParsedAddress {
  street: string;
  city: string;
  /** Two-letter state or province code. */
  state: string;
  zip: string;
}

export type ParseResult = { ok: true; address: ParsedAddress } | { ok: false; reason: "number" | "state" | "city" };

/** Street types and directions: the last one of these ends the street when
 *  there are no commas ("1100 Congress Ave Austin TX"). */
const STREET_END = new Set(
  (
    "st street ave av avenue rd road blvd boulevard dr drive ln lane way ct court pl place pkwy parkway " +
    "hwy highway cir circle ter terrace trl trail sq square loop row run pike tpke turnpike expy expressway " +
    "fwy freeway plz plaza aly alley xing crossing cv cove pt point walk path pass bnd bend " +
    "n s e w ne nw se sw north south east west"
  ).split(" ")
);
const UNIT = /^(apt|unit|ste|suite|#)/i;

const PLACES: Record<string, string> = {
  ...(STATES as Record<string, string>),
  ...Object.fromEntries(Object.entries(PROVINCES).map(([code, p]) => [code, p.name])),
};

/** Full names longest first, so "West Virginia" wins over "Virginia". */
const NAMES = [...Object.entries(PLACES), ["QC", "Québec"]]
  .map(([code, name]) => [code, name.toLowerCase().split(" ")] as const)
  .sort((a, b) => b[1].length - a[1].length);

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "");

export function parseAddress(text: string): ParseResult {
  // Tokens keep a trailing-comma flag, so commas can split street and city.
  let tokens = text
    .replace(/,/g, " , ")
    .split(/\s+/)
    .filter(Boolean);
  const dropTrailingCommas = () => {
    while (tokens.at(-1) === ",") tokens.pop();
  };
  dropTrailingCommas();
  if (!/^\d/.test(tokens[0] ?? "")) return { ok: false, reason: "number" };

  const dropCountry = () => {
    if (/^(usa|us|united states|canada)$/i.test(tokens.at(-1) ?? "") && tokens.length > 2) {
      tokens = tokens.slice(0, -1);
      dropTrailingCommas();
    }
  };
  dropCountry();
  let zip = "";
  const last = tokens.at(-1) ?? "";
  // A Canadian postal code may be written as one token or two ("M5V 3L9").
  const postal = tokens.length > 2 ? postalCode(tokens.slice(-2).join(" ")) : null;
  if (/^\d{5}(?:-?\d{4})?$/.test(last) && tokens.length > 1) {
    zip = last;
    tokens = tokens.slice(0, -1);
    dropTrailingCommas();
  } else if (postal && /^\d[a-z]\d$/i.test(last)) {
    zip = postal;
    tokens = tokens.slice(0, -2);
    dropTrailingCommas();
  } else if (postalCode(last) && tokens.length > 1) {
    zip = postalCode(last)!;
    tokens = tokens.slice(0, -1);
    dropTrailingCommas();
  }
  dropCountry();

  let state = "";
  const lower = tokens.map((t) => t.toLowerCase().replace(/\.$/, ""));
  const code = (lower.at(-1) ?? "").replace(/\./g, "").toUpperCase();
  if (code.length === 2 && PLACES[code] && tokens.length > 2) {
    state = code;
    tokens = tokens.slice(0, -1);
  } else {
    for (const [c, words] of NAMES) {
      const tail = lower.slice(-words.length);
      if (tokens.length > words.length + 1 && tail.join(" ") === words.join(" ")) {
        state = c;
        tokens = tokens.slice(0, -words.length);
        break;
      }
    }
  }
  dropTrailingCommas();
  if (!state) return { ok: false, reason: "state" };

  const commas = tokens.flatMap((t, i) => (t === "," ? [i] : []));
  let street: string;
  let city: string;
  if (commas.length) {
    const cut = commas.at(-1)!;
    city = clean(tokens.slice(cut + 1).join(" "));
    // A unit after a comma ("1 Main St, Apt 4, Town") stays with the street.
    street = clean(tokens.slice(0, cut).filter((t) => t !== ",").join(" "));
  } else {
    let cut = -1;
    for (let i = tokens.length - 2; i >= 1; i--)
      if (STREET_END.has(tokens[i].toLowerCase().replace(/\.$/, ""))) {
        cut = i;
        break;
      }
    // No street type to go by: take the last word as the city.
    if (cut < 0) cut = tokens.length - 2;
    // Keep a unit with the street ("1 Main St Apt 4 Town").
    while (cut + 2 < tokens.length && UNIT.test(tokens[cut + 1])) cut += 2;
    street = clean(tokens.slice(0, cut + 1).join(" "));
    city = clean(tokens.slice(cut + 1).join(" "));
  }
  if (!city || !/^\d/.test(street) || street.split(" ").length < 2) return { ok: false, reason: "city" };
  return { ok: true, address: { street, city, state, zip: zip.replace(/^(\d{5})(\d{4})$/, "$1-$2") } };
}

/** Why a line wasn't read, for the 400. */
export const PARSE_HINT: Record<"number" | "state" | "city", string> = {
  number: "Start the address with the house number, like 1410 E Pine St, Seattle, WA 98122.",
  state: "Give the city and state, like 1410 E Pine St, Seattle, WA 98122.",
  city: "Give the city and state, like 1410 E Pine St, Seattle, WA 98122.",
};
