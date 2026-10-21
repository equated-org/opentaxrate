/**
 * Reads the Streamlined Sales Tax rate and boundary files, the free files
 * the 24 member states publish each quarter in one shared layout.
 *
 *   - A rate row is one jurisdiction's rate over a span of dates.
 *   - A boundary row ties a street's house-number range, a ZIP+4 range or a
 *     whole ZIP to its county, city and special districts, over a span of
 *     dates.
 *
 * Rows that ended before HISTORY_FROM are dropped, which halves the tables;
 * set OPENTAXRATE_HISTORY_FROM to keep more.
 */
import { letteredHouse, readFileStreet } from "./address.js";

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

export interface RateRow {
  type: string;
  code: string;
  rate: number;
  startsOn: string;
  endsOn: string;
}

/** The jurisdictions one boundary row places an address in. */
export interface Area {
  county: string | null;
  place: string | null;
  /** Sorted "type:code" pairs joined by spaces. */
  districts: string;
}

export type BoundaryRow = { startsOn: string; endsOn: string; area: Area } & (
  | {
      kind: "street";
      streetKey: string;
      street: string;
      preDirectional: string;
      suffix: string;
      postDirectional: string;
      houseLow: number | null;
      houseHigh: number | null;
      houseText: string | null;
      parity: string;
      unitLow: string | null;
      unitHigh: string | null;
      city: string;
      zip5: string;
      plus4: string | null;
    }
  | {
      kind: "zip4" | "zip5";
      zip5: string;
      plus4Low: number;
      plus4High: number;
    }
);

/** A jurisdiction type as both files write it, which some pad and some
 *  don't ("0", "00"). */
export const jurisdictionType = (raw: string) =>
  String(Number(raw)).padStart(2, "0");

export function parseRateLine(line: string): RateRow | null {
  const c = fields(line);
  if (c.length < 9 || !/^\d+$/.test(c[0])) return null;
  const rate = Number(c[3]);
  const startsOn = isoDate(c[7]);
  const endsOn = isoDate(c[8]);
  if (!Number.isFinite(rate) || !startsOn || !endsOn) return null;
  if (endsOn < HISTORY_FROM) return null;
  return { type: jurisdictionType(c[1]), code: c[2], rate, startsOn, endsOn };
}

/** The rows one boundary line stands for: none for a line that ended before
 *  HISTORY_FROM, several for a ZIP range that spans ZIPs. */
export function parseBoundaryLine(line: string): BoundaryRow[] {
  const c = fields(line);
  const kind = c[0]?.toUpperCase();
  const startsOn = isoDate(c[1] ?? "");
  const endsOn = isoDate(c[2] ?? "");
  if (!startsOn || !endsOn || endsOn < HISTORY_FROM) return [];
  const districts: string[] = [];
  for (let i = 29; i + 2 < c.length; i += 3)
    if (c[i + 1]) districts.push(`${jurisdictionType(c[i + 2])}:${c[i + 1]}`);
  const area: Area = {
    county: c[24] || null,
    place: c[25] || null,
    districts: [...new Set(districts)].sort().join(" "),
  };

  if (kind === "A") {
    const street = readFileStreet(c[6], c[7], c[8], c[9]);
    if (!street.streetKey) return [];
    const numeric = /^\d+$/.test(c[3]) && /^\d+$/.test(c[4]);
    // A lettered range on one grid line ("W5300"-"W5399", "N77W7201"-
    // "N77W7299") keeps its numbers, under the line's key ("W#", "N77W#").
    const low = numeric ? null : letteredHouse(c[3]);
    const high = numeric ? null : letteredHouse(c[4] || c[3]);
    const lettered =
      low && high && low.line === high.line
        ? { line: low.line, low: Math.min(low.number, high.number), high: Math.max(low.number, high.number) }
        : null;
    return [
      {
        kind: "street",
        startsOn,
        endsOn,
        area,
        ...street,
        street: [c[6], c[7], c[8], c[9]]
          .filter(Boolean)
          .join(" ")
          .replace(/\s+/g, " ")
          .toUpperCase(),
        houseLow: numeric ? Number(c[3]) : (lettered?.low ?? null),
        houseHigh: numeric ? Number(c[4]) : (lettered?.high ?? null),
        houseText: numeric ? null : (lettered?.line ?? c[3].toUpperCase()),
        parity: (c[5] || "B").toUpperCase(),
        unitLow: c[11] || null,
        unitHigh: c[12] || null,
        city: c[14].toUpperCase(),
        zip5: c[15],
        plus4: c[16] || null,
      },
    ];
  }
  if (kind !== "4" && kind !== "Z") return [];
  const low = Number(c[17]);
  const high = Number(c[19]);
  if (!Number.isInteger(low) || !Number.isInteger(high) || high < low)
    return [];
  const lowPlus4 = kind === "4" ? Number(c[18] || 0) : 0;
  const highPlus4 = kind === "4" ? Number(c[20] || 9999) : 9999;
  const rows: BoundaryRow[] = [];
  for (let zip = low; zip <= high; zip++)
    rows.push({
      kind: kind === "4" ? "zip4" : "zip5",
      startsOn,
      endsOn,
      area,
      zip5: String(zip).padStart(5, "0"),
      plus4Low: zip === low ? lowPlus4 : 0,
      plus4High: zip === high ? highPlus4 : 9999,
    });
  return rows;
}

function fields(line: string) {
  return line
    .replace(/^﻿/, "")
    .replace(/\r$/, "")
    .split(",")
    .map((f) => f.trim());
}

/** "20261001" as "2026-10-01"; the files' open end dates (2999, 9999) all
 *  become 9999-12-31. */
function isoDate(raw: string): string | null {
  if (!/^\d{8}$/.test(raw)) return null;
  if (raw >= "29990101") return "9999-12-31";
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}
