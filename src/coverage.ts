/**
 * What both sides of OpenTaxRate agree on about the states: their FIPS
 * codes, which way each one's addresses are read (Streamlined and Missouri
 * address ranges, or the map), how far back loaded rows go, and the code
 * type Missouri's whole-location rates are filed under. The refresh job
 * writes by these and the lookups read by them, so neither imports the
 * other.
 */

/** Every state with a sales tax question to answer, and DC, by FIPS code. */
export const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09",
  DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17",
  IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24",
  MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31",
  NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38",
  OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46",
  TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54",
  WI: "55", WY: "56",
};

/** Rows that ended before this are dropped when loading. */
export const HISTORY_FROM = process.env.OPENTAXRATE_HISTORY_FROM || "2020-01-01";

/** The member states, by the FIPS code their files use. */
export const SST_STATES: Record<string, string> = {
  "05": "AR",
  "13": "GA",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "26": "MI",
  "27": "MN",
  "31": "NE",
  "32": "NV",
  "34": "NJ",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "44": "RI",
  "46": "SD",
  "47": "TN",
  "49": "UT",
  "50": "VT",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
};

export const SST_FIPS = Object.fromEntries(
  Object.entries(SST_STATES).map(([fips, state]) => [state, fips]),
);

/** States read from address-range files: the Streamlined members, and
 *  Missouri, whose Department of Revenue publishes the same layout. */
export const RANGE_FIPS: Record<string, string> = { ...SST_FIPS, MO: "29" };

/** States read from the map: their adapters (ingest/states) load each one's
 *  rate table and outlines, and rates/map.ts reads them. */
export const MAP_STATES = ["TX", "FL", "NY", "VA", "AZ", "NM", "IL", "SC", "CO", "AL", "LA", "AK", "PA", "HI", "MS", "ID"];

/** The type a state that publishes only whole-location rates (Missouri)
 *  files them under. */
export const WHOLE_CODE_TYPE = "99";
