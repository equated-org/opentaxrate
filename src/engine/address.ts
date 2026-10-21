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

/** Reads a typed street line, or null when it has no house number. */
export function parseStreet(line: string): StreetParts | null {
  let text = ` ${clean(line)}`;
  let unit: string | null = null;
  const unitMatch = UNIT.exec(text);
  if (unitMatch) {
    unit = unitMatch[1];
    text = text.slice(0, unitMatch.index);
  }
  text = text.trim();

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

  const [first, ...rest] = text.split(" ");
  // "123", "123A", "123-1/2"; or a lettered grid number ("W258S7120").
  const numbered = /^(\d+)(?:[A-Z]|-?\d+\/\d+)?$/.exec(first ?? "");
  const lettered = /^[NSEW]\d+[NSEW]?\d*$/.test(first ?? "");
  if ((!numbered && !lettered) || rest.length === 0) return null;
  if (rest[0] && /^\d+\/\d+$/.test(rest[0])) rest.shift();
  const street = splitStreet(rest);
  if (!street.streetKey) return null;
  return {
    house: numbered ? Number(numbered[1]) : null,
    houseText: first,
    ...street,
    unit,
  };
}

/** A boundary file's street, read the same way a typed one is. */
export function readFileStreet(
  pre: string,
  name: string,
  suffix: string,
  post: string,
) {
  return splitStreet(clean(`${pre} ${name} ${suffix} ${post}`).split(" "));
}

/** The keys a typed street might be filed under: its own, and for a name led
 *  by a street type ("Avenue B"), the name without it, as some files write
 *  "B" "Ave". */
export function streetKeysOf(parts: StreetParts): string[] {
  const keys = [parts.streetKey];
  const lead = /^([A-Z]+?)(\d+|[A-Z])$/.exec(parts.streetKey);
  // Not a numbered road ("Hwy 9" is no "9th St").
  if (lead && SUFFIXES.get(lead[1]) === lead[1] && !/^\d+$/.test(lead[2])) keys.push(lead[2]);
  return keys;
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
    .replace(/ (?:COUNTY|CNTY|CO) (?:RD|HWY|RTE) /g, " CR ")
    .replace(/ (?:US|U S|STATE|ST|SR|SH|SRTE|STHY) (?:HWY|RTE|RD)? ?(?=\d)/g, " HWY ")
    .replace(/ (?:HWY|RTE|SR|SH|US) (?=\d)/g, " HWY ")
    .replace(/ (?:INTERSTATE|I) (?=\d)/g, " I ");
  return joined.replace(/\s+/g, "");
}
