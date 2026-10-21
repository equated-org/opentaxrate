/**
 * Reads a US street line into the parts the states' boundary files index by,
 * so a typed address and a file's range of the same street compare equal.
 *
 * The street's name becomes a key with its type ("St", "Avenue"), its
 * directions ("N", "Southwest") and spacing taken out, ordinals reduced to
 * their number, direction words in the name abbreviated ("East St" is "E
 * St"), and highway names folded together. The type and directions are
 * kept apart, to tell "Oak St" from "Oak Ave" when both exist. Both sides go
 * through the same reading, so the file's "MC COLLISTER" "Dr" and a typed
 * "McCollister Drive" meet on one key.
 */

export interface StreetParts {
  /** The house number when it is a plain number. */
  house: number | null;
  /** The house number as written, for lettered ones like "W258S7120". */
  houseText: string;
  preDirectional: string;
  streetKey: string;
  suffix: string;
  postDirectional: string;
  unit: string | null;
  /** Other ways a file may have written the name, tried when the street's
   *  own key finds nothing: its words run together unabbreviated ("Oak
   *  Hollow" as "OAKHOLLOW"), and a last word read as the type kept in the
   *  name instead ("Oak Ridge" as "OAKRIDGE", any type). */
  alternates?: { streetKey: string; suffix: string }[];
}

const DIRECTIONS: Record<string, string> = {
  N: "N",
  NORTH: "N",
  S: "S",
  SOUTH: "S",
  E: "E",
  EAST: "E",
  W: "W",
  WEST: "W",
  NE: "NE",
  NORTHEAST: "NE",
  NW: "NW",
  NORTHWEST: "NW",
  SE: "SE",
  SOUTHEAST: "SE",
  SW: "SW",
  SOUTHWEST: "SW",
};

/** USPS street types (Publication 28) and their common spellings. */
const SUFFIX_SPELLINGS: Record<string, string> = {
  ALY: "ALLEY ALLEE ALLY",
  ANX: "ANNEX ANEX ANNX",
  ARC: "ARCADE",
  AVE: "AVENUE AV AVEN AVENU AVN AVNUE",
  BYU: "BAYOU BAYOO",
  BCH: "BEACH",
  BND: "BEND",
  BLF: "BLUFF BLUF",
  BLFS: "BLUFFS",
  BTM: "BOTTOM BOT BOTTM",
  BLVD: "BOULEVARD BOUL BOULV BLV",
  BR: "BRANCH BRNCH",
  BRG: "BRIDGE BRDGE",
  BRK: "BROOK",
  BYP: "BYPASS BYPA BYPAS BYPS",
  CP: "CAMP CMP",
  CYN: "CANYON CANYN CNYN",
  CPE: "CAPE",
  CSWY: "CAUSEWAY CAUSWA",
  CTR: "CENTER CEN CENT CENTR CENTRE CNTER CNTR",
  CIR: "CIRCLE CIRC CIRCL CRCL CRCLE",
  CLF: "CLIFF",
  CLFS: "CLIFFS",
  CLB: "CLUB",
  CMN: "COMMON",
  COR: "CORNER",
  CORS: "CORNERS",
  CRSE: "COURSE",
  CT: "COURT CRT",
  CTS: "COURTS",
  CV: "COVE",
  CRK: "CREEK",
  CRES: "CRESCENT CRSENT CRSNT",
  CRST: "CREST",
  XING: "CROSSING CRSSNG",
  XRD: "CROSSROAD",
  CURV: "CURVE",
  DL: "DALE",
  DM: "DAM",
  DV: "DIVIDE DIV DVD",
  DR: "DRIVE DRIV DRV",
  EST: "ESTATE",
  ESTS: "ESTATES",
  EXPY: "EXPRESSWAY EXP EXPR EXPRESS EXPW",
  EXT: "EXTENSION EXTN EXTNSN",
  FLS: "FALLS",
  FRY: "FERRY FRRY",
  FLD: "FIELD",
  FLDS: "FIELDS",
  FLT: "FLAT",
  FLTS: "FLATS",
  FRD: "FORD",
  FRST: "FOREST FORESTS",
  FRG: "FORGE FORG",
  FRK: "FORK",
  FRKS: "FORKS",
  FWY: "FREEWAY FREEWY FRWAY FRWY",
  GDN: "GARDEN GARDN GRDEN GRDN",
  GDNS: "GARDENS GRDNS",
  GTWY: "GATEWAY GATEWY GATWAY GTWAY",
  GLN: "GLEN",
  GRN: "GREEN",
  GRV: "GROVE GROV",
  HBR: "HARBOR HARB HARBR HRBOR",
  HVN: "HAVEN",
  HTS: "HEIGHTS HT",
  HWY: "HIGHWAY HIGHWY HIWAY HIWY HWAY",
  HL: "HILL",
  HLS: "HILLS",
  HOLW: "HOLLOW HLLW HOLLOWS HOLWS",
  INLT: "INLET",
  IS: "ISLAND ISLND",
  ISS: "ISLANDS",
  JCT: "JUNCTION JCTION JCTN JUNCTN JUNCTON",
  KY: "KEY",
  KNL: "KNOLL KNOL",
  KNLS: "KNOLLS",
  LK: "LAKE",
  LKS: "LAKES",
  LNDG: "LANDING LNDNG",
  LN: "LANE",
  LDG: "LODGE LDGE LODG",
  LOOP: "LOOPS",
  MNR: "MANOR",
  MDW: "MEADOW",
  MDWS: "MEADOWS",
  ML: "MILL",
  MLS: "MILLS",
  MSN: "MISSION MISSN MSSN",
  MTWY: "MOTORWAY",
  MTN: "MOUNTAIN MNTAIN MNTN MOUNTIN MTIN",
  ORCH: "ORCHARD ORCHRD",
  OVAL: "OVL",
  PARK: "PRK PARKS",
  PKWY: "PARKWAY PARKWY PKWAY PKY PARKWAYS PKWYS",
  PSGE: "PASSAGE",
  PATH: "PATHS",
  PIKE: "PIKES",
  PNES: "PINES",
  PL: "PLACE",
  PLN: "PLAIN",
  PLNS: "PLAINS",
  PLZ: "PLAZA PLZA",
  PT: "POINT",
  PTS: "POINTS",
  PRT: "PORT",
  PR: "PRAIRIE PRR",
  RADL: "RADIAL RAD RADIEL",
  RNCH: "RANCH RANCHES RNCHS",
  RPDS: "RAPIDS",
  RDG: "RIDGE RDGE",
  RDGS: "RIDGES",
  RIV: "RIVER RVR RIVR",
  RD: "ROAD",
  RDS: "ROADS",
  RTE: "ROUTE RT",
  ROW: "",
  RUN: "",
  SHR: "SHORE SHOAR",
  SHRS: "SHORES",
  SKWY: "SKYWAY",
  SPG: "SPRING SPNG SPRNG",
  SPGS: "SPRINGS",
  SPUR: "SPURS",
  SQ: "SQUARE SQR SQRE SQU",
  STA: "STATION STATN STN",
  ST: "STREET STRT STR",
  SMT: "SUMMIT SUMIT SUMITT",
  TER: "TERRACE TERR",
  TRCE: "TRACE TRACES",
  TRAK: "TRACK TRACKS TRK TRKS",
  TRL: "TRAIL TRAILS TRLS",
  TUNL: "TUNNEL TUNEL TUNLS TUNNELS TUNNL",
  TPKE: "TURNPIKE TRNPK TURNPK",
  VLY: "VALLEY VALLY VLLY",
  VIA: "VIADUCT VDCT VIADCT",
  VW: "VIEW",
  VWS: "VIEWS",
  VLG: "VILLAGE VILL VILLAG VILLG VILLIAGE",
  VIS: "VISTA VIST VST VSTA",
  WALK: "WALKS",
  WAY: "WY",
};

const SUFFIXES = new Map<string, string>();
for (const [abbreviation, spellings] of Object.entries(SUFFIX_SPELLINGS)) {
  SUFFIXES.set(abbreviation, abbreviation);
  for (const s of spellings.split(" ").filter(Boolean))
    SUFFIXES.set(s, abbreviation);
}

/** Words inside a name spelled more than one way. */
const NAME_WORDS: Record<string, string> = {
  SAINT: "ST",
  MOUNT: "MT",
  FORT: "FT",
  ...Object.fromEntries(
    [
      "FIRST",
      "SECOND",
      "THIRD",
      "FOURTH",
      "FIFTH",
      "SIXTH",
      "SEVENTH",
      "EIGHTH",
      "NINTH",
      "TENTH",
      "ELEVENTH",
      "TWELFTH",
      "THIRTEENTH",
      "FOURTEENTH",
      "FIFTEENTH",
      "SIXTEENTH",
      "SEVENTEENTH",
      "EIGHTEENTH",
      "NINETEENTH",
      "TWENTIETH",
    ].map((word, i) => [word, String(i + 1)]),
  ),
};

// A word designator needs a space after it, so "Fls" (Falls) stays a type.
const UNIT =
  /\s(?:(?:APT|APARTMENT|STE|SUITE|UNIT|BLDG|BUILDING|FL|FLOOR|RM|ROOM|LOT|SPC|SPACE|TRLR|DEPT|OFC|OFFICE|PH)(?:\s+|\s*#\s*)|#\s*)([A-Z0-9-]+)$/;

const DESIGNATORS = "APT|APARTMENT|STE|SUITE|UNIT|BLDG|BUILDING|FL|FLOOR|RM|ROOM|LOT|SPC|SPACE|TRLR|DEPT|OFC|OFFICE|PH";
/** A comma-separated piece that is only a unit ("Apt 4B", "Suite #200"). */
const UNIT_PIECE = new RegExp(`^(?:(?:${DESIGNATORS})\\.?\\s*#?\\s*|#\\s*)([A-Z0-9-]+)$`, "i");
/** A unit followed by more words, read once a trailing state and ZIP show
 *  the line runs on into its city ("Apt 3C Brooklyn"). */
const UNIT_THEN_CITY = new RegExp(`\\s(?:(?:${DESIGNATORS})(?:\\s+|\\s*#\\s*)|#\\s*)([A-Z0-9-]+)(?:\\s.*)?$`);
const STATE_ZIP_TAIL = /\s[A-Z]{2}\s\d{5}(?:-?\d{4})?$/;
const NUMBER_WORDS: Record<string, string> = Object.fromEntries(
  "ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE THIRTEEN FOURTEEN FIFTEEN SIXTEEN SEVENTEEN EIGHTEEN NINETEEN TWENTY"
    .split(" ")
    .map((word, i) => [word, String(i + 1)]),
);
const HOUSE = /^(?:\d+(?:[A-Z]|-?\d+\/\d+)?|[NSEW]\d+[NSEW]?\d*)$/i;

/** Reads a typed street line, or null when it has no house number. A line
 *  may carry more than the street: a unit or care-of name before it, a unit
 *  or the city, state and ZIP after it, as commas or a trailing ZIP show. */
export function parseStreet(line: string): StreetParts | null {
  const piece = streetPiece(line);
  let text = ` ${clean(piece.street)}`;
  let unit: string | null = piece.unit;
  // "Apt4B" is "Apt 4B"; only as the line's last word, where a unit stands.
  text = text.replace(new RegExp(`\\s(${DESIGNATORS})(\\d[A-Z0-9-]*)$`), " $1 $2");
  const tail = STATE_ZIP_TAIL.exec(text);
  if (tail) text = text.slice(0, tail.index);
  const unitMatch = (tail ? UNIT_THEN_CITY : UNIT).exec(text);
  if (unitMatch) {
    unit = unitMatch[1];
    text = text.slice(0, unitMatch.index);
  } else if (tail) text = withoutCity(text);
  text = text.trim();
  const words = text.split(" ");
  if (NUMBER_WORDS[words[0]]) text = [NUMBER_WORDS[words[0]], ...words.slice(1)].join(" ");

  const box = /^(?:P ?O|POST OFFICE) ?BOX (\d+)$/.exec(text);
  if (box)
    return {
      house: Number(box[1]),
      houseText: box[1],
      preDirectional: "",
      streetKey: "POBOX",
      suffix: "",
      postDirectional: "",
      unit,
    };

  // A grid number typed with a space ("N78 W7008 Oak St") is one number.
  text = text.replace(/^([NSEW]\d+) ([NSEW]\d+) /, "$1$2 ");
  const [first, ...rest] = text.split(" ");
  // "123", "123A", "123-1/2"; or a lettered grid number ("W258S7120").
  const numbered = /^(\d+)(?:[A-Z]|-?\d+\/\d+)?$/.exec(first ?? "");
  const lettered = /^[NSEW]\d+[NSEW]?\d*$/.test(first ?? "");
  if ((!numbered && !lettered) || rest.length === 0) return null;
  if (rest[0] && /^\d+\/\d+$/.test(rest[0])) rest.shift();
  mendType(rest);
  const street = splitStreet(rest);
  if (!street.streetKey) return null;
  return {
    house: numbered ? Number(numbered[1]) : null,
    houseText: first,
    ...street,
    unit,
    alternates: alternateSpellings(rest, street),
  };
}

/** The comma-separated piece that is the street (the first to start with a
 *  house number), and a unit standing on its own just before or after it. */
function streetPiece(line: string): { street: string; unit: string | null } {
  const pieces = line.split(",").map((p) => p.trim()).filter(Boolean);
  if (pieces.length < 2) return { street: line, unit: null };
  const at = pieces.findIndex((p) => {
    const [first, second] = p.toUpperCase().split(/\s+/);
    return Boolean(second) && (HOUSE.test(first) || Boolean(NUMBER_WORDS[first]));
  });
  if (at < 0) return { street: line, unit: null };
  const unitPiece = [pieces[at - 1], pieces[at + 1]].find((p) => p && UNIT_PIECE.test(p));
  return { street: pieces[at], unit: unitPiece ? UNIT_PIECE.exec(unitPiece)![1].toUpperCase() : null };
}

/** A line whose state and ZIP were cut off still ends in its city: keep the
 *  words up to the last street type (and a direction after it). */
function withoutCity(text: string) {
  const words = text.trim().split(" ");
  let end = -1;
  for (let i = 2; i < words.length; i++) if (SUFFIXES.has(words[i])) end = i;
  if (end < 0) return text;
  if (DIRECTIONS[words[end + 1]]) end++;
  return words.slice(0, end + 1).join(" ");
}

/** A misspelled street type after the name ("Steet", "Bvld", "Boulevrd") is
 *  read as the type it is one slip from: a letter missing, extra, wrong, or
 *  two letters swapped. Only spelled-out types of five letters or more and
 *  four-letter abbreviations count, so a short name ("Broad") is never
 *  taken for one ("Road"). */
function mendType(words: string[]) {
  let at = words.length - 1;
  if (at > 1 && DIRECTIONS[words[at]]) at--;
  const word = words[at];
  if (at < 1 || !word || word.length < 4 || SUFFIXES.has(word) || DIRECTIONS[word] || /\d/.test(word)) return;
  const near = TYPE_SPELLINGS.filter(([spelling]) => oneSlip(word, spelling));
  const types = new Set(near.map(([, type]) => type));
  if (types.size === 1) words[at] = [...types][0];
}

const TYPE_SPELLINGS = [...SUFFIXES].filter(
  ([spelling, type]) => spelling.length >= 5 || (spelling === type && spelling.length === 4),
);

/** Whether a and b differ by one edit or one swap of neighbouring letters. */
function oneSlip(a: string, b: string) {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const diff = [...a].flatMap((c, i) => (c === b[i] ? [] : [i]));
    return diff.length === 1 || (diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]);
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++) if (long.slice(0, i) + long.slice(i + 1) === short) return true;
  return false;
}

function alternateSpellings(
  input: string[],
  street: { streetKey: string; suffix: string },
) {
  const tokens = input.filter(Boolean);
  if (tokens.length > 1 && DIRECTIONS[tokens.at(-1)!]) tokens.pop();
  const typeWord =
    tokens.length > 1 && SUFFIXES.has(tokens.at(-1)!) ? tokens.pop()! : null;
  if (tokens.length > 1 && DIRECTIONS[tokens[0]]) tokens.shift();
  const raw = (words: string[]) =>
    words.map((t) => /^(\d+)(?:ST|ND|RD|TH)$/.exec(t)?.[1] ?? t).join("");
  const found = [
    { streetKey: raw(tokens), suffix: street.suffix },
    ...(typeWord && tokens.length
      ? [
          { streetKey: nameKey([...tokens, typeWord]), suffix: "" },
          { streetKey: raw([...tokens, typeWord]), suffix: "" },
        ]
      : []),
  ];
  return found.filter(
    (a, i) =>
      a.streetKey &&
      !/^\d+$/.test(a.streetKey) &&
      !(a.streetKey === street.streetKey && a.suffix === street.suffix) &&
      found.findIndex((b) => b.streetKey === a.streetKey && b.suffix === a.suffix) === i,
  );
}

/** A lettered house number ("W5300", "N78W7008", "W258S7120") split into
 *  the grid line it lies on and its number along the street, so a file's
 *  range "W5300"-"W5399" can hold "W5350". Leading zeros are dropped
 *  ("E0250" is "E250"). Null for anything else. */
export function letteredHouse(text: string): { line: string; number: number } | null {
  const m = /^([NSEW])(?:(\d+)([NSEW]))?(\d+)$/.exec(text.toUpperCase());
  if (!m) return null;
  const line = m[2] === undefined ? m[1] : `${m[1]}${Number(m[2])}${m[3]}`;
  return { line: `${line}#`, number: Number(m[4]) };
}

/** A boundary file's street, read the same way a typed one is. */
export function readFileStreet(
  pre: string,
  name: string,
  suffix: string,
  post: string,
) {
  // Some files repeat the type or direction in the name ("N" "N Edmonds
  // Ave" "Ave", "Spruce St" "St").
  const words = clean(name).split(" ");
  const type = SUFFIXES.get(clean(suffix));
  if (type && words.length > 1 && SUFFIXES.get(words.at(-1)!) === type)
    words.pop();
  const direction = DIRECTIONS[clean(pre)];
  if (direction && words.length > 1 && DIRECTIONS[words[0]] === direction)
    words.shift();
  return splitStreet(
    clean(`${pre} ${words.join(" ")} ${suffix} ${post}`).split(" "),
  );
}

/** The keys a typed street might be filed under: its own, and for a name led
 *  by a street type ("Avenue B"), the name without it, as some files write
 *  "B" "Ave". */
export function streetKeysOf(parts: StreetParts): string[] {
  const keys = [parts.streetKey];
  const lead = /^([A-Z]+?)(\d+|[A-Z])$/.exec(parts.streetKey);
  // Not a numbered road ("Hwy 9" is no "9th St").
  if (lead && SUFFIXES.get(lead[1]) === lead[1] && !/^\d+$/.test(lead[2])) keys.push(lead[2]);
  // A lettered route typed with the type after it ("K-18 Hwy") is filed as
  // "Highway K18".
  if (parts.suffix === "HWY" && /^[A-Z]{1,2}\d+$/.test(parts.streetKey)) keys.push(`HWY${parts.streetKey}`);
  // A county's numbered road, typed "Columbia Road 161", filed "Columbia 161".
  const road = /^([A-Z]{3,}?)(?:RD|CR)(\d+[A-Z]?)$/.exec(parts.streetKey);
  if (road) keys.push(road[1] + road[2]);
  return keys;
}

/** The street as typed, then each other way a file may have filed it: the
 *  other keys, the other spellings, and a one-letter grid number ("E10546
 *  Old 56 Rd") as a direction and a plain number. */
export function streetVariantsOf(parts: StreetParts): StreetParts[] {
  const variants = streetKeysOf(parts).map((streetKey) => ({ ...parts, streetKey }));
  for (const alt of parts.alternates ?? [])
    if (!variants.some((v) => v.streetKey === alt.streetKey && v.suffix === alt.suffix))
      variants.push({ ...parts, ...alt });
  const grid = /^([NSEW])(\d+)$/.exec(parts.houseText);
  if (grid && !parts.preDirectional)
    variants.push({ ...parts, house: Number(grid[2]), houseText: String(Number(grid[2])), preDirectional: grid[1] });
  return variants;
}

function clean(text: string) {
  return text
    .toUpperCase()
    .replace(/﻿/g, "")
    .replace(/[.,'`]/g, "")
    .replace(/#/g, " # ")
    .replace(/[^A-Z0-9#/ -]/g, " ")
    .replace(/(\D)-|-(\D)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function splitStreet(input: string[]) {
  const tokens = input.filter(Boolean);
  let preDirectional = "";
  let suffix = "";
  let postDirectional = "";
  if (tokens.length > 1 && DIRECTIONS[tokens.at(-1)!]) {
    postDirectional = DIRECTIONS[tokens.pop()!];
  }
  if (tokens.length > 1 && SUFFIXES.has(tokens.at(-1)!)) {
    suffix = SUFFIXES.get(tokens.pop()!)!;
  }
  if (tokens.length > 1 && DIRECTIONS[tokens[0]]) {
    preDirectional = DIRECTIONS[tokens.shift()!];
  }
  // A street named only for a direction ("North St", "W Ave") keeps it.
  if (tokens.length === 0 && postDirectional) tokens.push(postDirectional);
  return {
    preDirectional,
    streetKey: nameKey(tokens),
    suffix,
    postDirectional,
  };
}

/** State names as nameKey's words spell them (directions already
 *  abbreviated: "NORTH CAROLINA" is "N CAROLINA"), and postal codes. */
const STATE_NAMES = [
  "ALABAMA", "ALASKA", "ARIZONA", "ARKANSAS", "CALIFORNIA", "COLORADO",
  "CONNECTICUT", "DELAWARE", "FLORIDA", "GEORGIA", "HAWAII", "IDAHO",
  "ILLINOIS", "INDIANA", "IOWA", "KANSAS", "KENTUCKY", "LOUISIANA", "MAINE",
  "MARYLAND", "MASSACHUSETTS", "MICHIGAN", "MINNESOTA", "MISSISSIPPI",
  "MISSOURI", "MONTANA", "NEBRASKA", "NEVADA", "NEW HAMPSHIRE", "NEW JERSEY",
  "NEW MEXICO", "NEW YORK", "N CAROLINA", "N DAKOTA", "OHIO", "OKLAHOMA",
  "OREGON", "PENNSYLVANIA", "RHODE IS", "S CAROLINA", "S DAKOTA", "TENNESSEE",
  // "North Carolina Hwy 54" reaches here as "Carolina Hwy 54", its "North"
  // read as the street's direction.
  "CAROLINA", "DAKOTA", "TEXAS", "UTAH", "VERMONT", "VIRGINIA",
  "WASHINGTON", "W VIRGINIA", "WISCONSIN", "WYOMING",
];
// Not "CO": "Co Hwy 5" is a county road.
const STATE_CODES =
  "AL AK AZ AR CA CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY";
/** A state's name before a number, with or without a road word ("Ohio Hwy
 *  29", "Vermont Route 100", "Georgia 400"), or its postal code before a road
 *  word ("VT Route 100", "SD Highway 27"). A bare code before a number is
 *  left alone, as "NC 8068" is a Newton County road in Arkansas's file;
 *  Arkansas's own "AR 33" is the one exception. "Georgia Ave" and "Ohio St"
 *  are left alone too. */
const STATE_ROAD = new RegExp(
  ` (?:(?:${STATE_NAMES.join("|")}) (?=(?:(?:HWY|RTE) )?\\d)|(?:${STATE_CODES.split(" ").join("|")}) (?=(?:HWY|RTE) \\d)|AR (?=\\d))`,
  "g",
);

/** Highways go by many names ("State Route 9", "SR 9", "Hwy 9", "US-9");
 *  one road in one ZIP rarely carries two of them, so they share a key and
 *  any real collision is caught by the areas disagreeing. County roads stay
 *  apart. */
function nameKey(tokens: string[]) {
  const words = tokens.map((t) => {
    const ordinal = /^(\d+)(?:ST|ND|RD|TH)$/.exec(t);
    if (ordinal) return ordinal[1];
    return NAME_WORDS[t] ?? DIRECTIONS[t] ?? SUFFIXES.get(t) ?? t;
  });
  const joined = ` ${words.join(" ")} `
    // A state's own road named for the state ("Ohio Highway 29", "Vermont
    // Route 100", "W Virginia Rte 2") is its state route.
    .replace(STATE_ROAD, " STATE ")
    // Wisconsin's trunk highways: "CTH M" is County Highway M, "STH 19"
    // and "USH 10" are State and US Highways.
    .replace(/ (?:CTH|(?:COUNTY|CNTY|CO|CTY) TRUNK(?: HWY)?) /g, " CR ")
    .replace(/ (?:STH|USH|STHWY|(?:STATE|ST) TRUNK(?: HWY)?) (?=\d)/g, " HWY ")
    .replace(/ (?:COUNTY|CNTY|CO) (?:RD|HWY|RTE) /g, " CR ")
    .replace(/ (?:US|U S|STATE|ST|SR|SH|SRTE|STHY) (?:HWY|RTE|RD)? ?(?=\d)/g, " HWY ")
    .replace(/ (?:HWY|RTE|SR|SH|US) (?=\d)/g, " HWY ")
    .replace(/ (?:INTERSTATE|I) (?=\d)/g, " I ");
  return joined.replace(/\s+/g, "");
}
