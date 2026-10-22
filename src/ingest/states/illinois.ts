/**
 * Illinois, from the Department of Revenue: every location (a city's part
 * in one county, or a county's unincorporated area) has one combined
 * general merchandise rate, state's 6.25% included, so each location is an
 * exclusive area. IDOR's own location polygons place an address in one.
 *
 * Business districts add to a location's rate at listed street addresses
 * only, and IDOR publishes them as address lists rather than outlines; an
 * address on a list gets its district's rate (an "addr" row), any other its
 * location's default.
 *
 * Each file gives a period and the one before it, and IDOR keeps the
 * current file and two earlier editions; together they reach back a few
 * years, and coverage starts on the latest day every location has a rate
 * for. The higher of a
 * location's two rates is the one a retailer liable for every local tax
 * charges, which is the general rate here.
 *
 * Each location keeps its name and, as ids, its location code with the check
 * digit the ST-1 shows (048-0002-8) and its county; a business district's
 * address also keeps the district's suffix (R01). The files have no header,
 * so the keys are the fields' names in IDOR's file layout.
 */
import { parseStreet } from "../../address.js";
import type { GeoRateRow, GeoState, GeoStateData, JurisdictionRow } from "./index.js";
import { bboxOf, fetchLayer, fetchText, isoDay, shiftDay } from "./sources.js";

const FILES = "https://tax.illinois.gov/content/dam/soi/en/web/tax/research/taxrates/documents/salestaxrates";
const POLYGONS = "https://aglomaps.revenue.illinois.gov/arcgis/rest/services/CityCountyTwpDD/MapServer/1";
const STATE = 0.0625;

export const illinois: GeoState = {
  state: "IL",
  async fetch(dir) {
    const editions = ["current", "prior", "prior-010126"];
    const rates: GeoRateRow[] = [];
    // Editions are read newest first, so the first one seen is kept.
    const jurisdictions = new Map<string, JurisdictionRow>();
    /** A location line's name and ids; `at` is where its city name starts
     *  (an address line has the district's suffix first). */
    const describe = (type: string, code: string, line: string, at: number) => {
      if (jurisdictions.has(`${type}:${code}`)) return;
      const ids: Record<string, string> = { "Location Code": line.slice(0, 10).trim() };
      if (at > 10) ids["Business District"] = line.slice(10, at).trim();
      ids["County Name"] = line.slice(at + 25, at + 50).trim();
      jurisdictions.set(`${type}:${code}`, { type, code, name: line.slice(at, at + 25).trim() || null, ids });
    };
    const seen = new Set<string>();
    const earliest = new Map<string, string>();
    // Current: date, then the general merchandise rate; prior: from, to,
    // rate, `priorAt` characters on (the location file has more rate columns
    // than the address file).
    const periodsOf = (fields: string, at: number, priorAt: number) => {
      const current = { from: isoDay(fields.slice(at, at + 8)), rate: percent(fields.slice(at + 8, at + 13)) };
      const p = at + priorAt;
      const prior = {
        from: isoDay(fields.slice(p, p + 8)),
        to: isoDay(fields.slice(p + 8, p + 16)),
        rate: percent(fields.slice(p + 16, p + 21)),
      };
      return { current, prior };
    };
    const row = (type: string, code: string, rate: number, startsOn: string, endsOn: string) => {
      const key = `${type}|${code}|${startsOn}`;
      if (seen.has(key)) return;
      seen.add(key);
      rates.push({ type, code, rate: local(rate), startsOn, endsOn });
      if (type === "x" && startsOn < (earliest.get(code) ?? "9999")) earliest.set(code, startsOn);
    };
    // An edition's current period ends where the next edition's begins.
    const push = (type: string, code: string, { current, prior }: ReturnType<typeof periodsOf>, until: string) => {
      if (!current.from || current.rate === null) return;
      row(type, code, current.rate, current.from, until);
      if (prior.from && prior.to && prior.rate !== null && prior.to >= prior.from)
        row(type, code, prior.rate, prior.from, prior.to);
    };

    let until = "9999-12-31";
    for (const edition of editions) {
      let locations: string;
      let addresses: string;
      try {
        locations = await fetchText(`${FILES}/ordmache-${edition}.txt`, dir);
        addresses = await fetchText(`${FILES}/ordmacha-${edition}.txt`, dir);
      } catch (error) {
        // An earlier edition IDOR has since replaced; the current one must load.
        if (edition !== "current" && /answered 404/.test((error as Error).message)) continue;
        throw error;
      }
      const listed = new Set<string>();
      let editionStart = "9999-12-31";
      for (const line of locations.split(/\r?\n/)) {
        if (line.length < 150) continue;
        const code = locationCode(line.slice(0, 10));
        if (!code) continue;
        if (line[60] === "Y") listed.add(code);
        else {
          const periods = periodsOf(line, 61, 71);
          push("x", code, periods, until);
          describe("x", code, line, 10);
          if (periods.current.from && periods.current.from < editionStart) editionStart = periods.current.from;
        }
      }
      for (const line of addresses.split(/\r?\n/)) {
        const code = locationCode(line.slice(0, 10));
        if (!code || !listed.has(code)) continue;
        const address = line.slice(63, 98).trim();
        const periods = periodsOf(line, 98, 50);
        if (!address) {
          push("x", code, periods, until);
          describe("x", code, line, 13);
          continue;
        }
        const street = parseStreet(address);
        if (street) {
          const at = `${code}|${street.house ?? street.houseText}|${street.streetKey}`;
          push("addr", at, periods, until);
          describe("addr", at, line, 13);
        }
      }
      until = shiftDay(latestStart(locations) ?? editionStart, -1);
    }
    const coverFrom = [...earliest.values()].sort().at(-1) ?? "9999-12-31";

    const shapes: GeoStateData["shapes"] = (await fetchLayer(POLYGONS)).flatMap((f) => {
      const code = String(f.attributes.CC_CODE ?? "").trim();
      if (!/^\d{7}$/.test(code)) return [];
      return [{ kind: "district" as const, fips: code, name: `${String(f.attributes.CITY_NAME ?? "").trim() || "Unincorporated"} (${f.attributes.COUNTY_NAM})`, rings: f.rings, bbox: bboxOf(f.rings) }];
    });
    const rated = new Set(rates.map((r) => `${r.type}:${r.code}`));
    rates.unshift(
      { type: "45", code: "17", rate: STATE, startsOn: coverFrom, endsOn: "9999-12-31" },
      { type: "need", code: "x", rate: 0, startsOn: coverFrom, endsOn: "9999-12-31" },
    );
    return {
      rates,
      // Only for codes a rate row has: a line with no current rate pushes none.
      jurisdictions: [...jurisdictions.values()].filter((j) => rated.has(`${j.type}:${j.code}`)),
      shapes,
      files: { rates: "IL IDOR ordmache + ordmacha (current and two prior editions)", boundaries: "IL IDOR CityCountyTwpDD" },
    };
  },
};

/** The newest period start in a location file, which is when it took effect. */
function latestStart(text: string) {
  let latest: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const day = line.length > 70 ? isoDay(line.slice(61, 69)) : null;
    if (day && (!latest || day > latest)) latest = day;
  }
  return latest;
}


/** "016-0001-1" as the polygons' "0160001". */
function locationCode(id: string) {
  const m = /^(\d{3})-(\d{4})-\d$/.exec(id.trim());
  return m ? `${m[1]}${m[2]}` : null;
}

/** IDOR writes 10.5% as "10500". */
function percent(field: string) {
  return /^\d{5}$/.test(field) ? Number(field) / 100_000 : null;
}

const local = (rate: number) => Math.round((rate - STATE) * 1e6) / 1e6;
