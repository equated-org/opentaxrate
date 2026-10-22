/**
 * States whose local rates follow Census counties and cities, kept as dated
 * tables from each state's published list. A table names its counties and
 * cities as the state writes them; they are matched to Census FIPS codes
 * when the state is loaded, and a name that matches nothing stops the load
 * rather than leaving that place untaxed.
 */
import { latestTigerFiles } from "../downloads.js";
import { readTigerZip } from "../tiger.js";
import { STATE_FIPS } from "../../coverage.js";
import { fetchFile } from "./sources.js";
import type { GeoRateRow, GeoState, JurisdictionRow } from "./index.js";

export interface DatedRate {
  rate: number;
  from: string;
  /** Last day it applies; open-ended when absent. */
  to?: string;
}

export interface LocalRate extends DatedRate {
  /** The county's or city's name as the state writes it, or its FIPS code. */
  name: string;
  /** For a city's rate in only one of the counties it spans. */
  inCounty?: string;
  /** 00 county, 01 city added on top, 01x city in place of its county, rc
   *  county outside its rated cities, no county refused, pj a city's police
   *  jurisdiction, maybe a city's unmapped district, 0c a county's rate
   *  inside one city (see rates/map.ts). */
  type: "00" | "01" | "01x" | "0c" | "rc" | "no" | "pj" | "maybe";
  /** The jurisdiction's name as the source titles it, where that differs
   *  from `name` ("MONTGOMERY COUNTY"); `name` stands in when absent. */
  title?: string;
  /** Its ids in the source, by the source's column name (see
   *  JurisdictionRow). */
  ids?: Record<string, string>;
}

export interface Table {
  stateRates: DatedRate[];
  locals: LocalRate[];
  /** Where the table was taken from, for the rate's source. */
  source: string;
  /** Leave out, with a warning, a city no Census place or town matches,
   *  rather than stop the load. */
  skipUnmatchedCities?: boolean;
  /** The publications a hand-written table was copied from, downloaded on
   *  each load only to be kept in artifacts/ beside the other raw files. */
  publications?: Array<{ url: string; name: string }>;
}

/** A state read from its table: its rates, keyed to Census FIPS codes. */
export function stateTable(
  state: string,
  load: (dir?: string) => Promise<Table> | Table,
): GeoState {
  return {
    state,
    async fetch(dir) {
      const table = await load(dir);
      for (const p of table.publications ?? [])
        await fetchFile(p.url, dir, p.name).catch((error: Error) =>
          console.warn(`${state}: couldn't keep ${p.url}: ${error.message}`),
        );
      const codes = await censusCodes(state, dir);
      // One row per type:code, from its newest rate.
      const jurisdictions = new Map<string, JurisdictionRow & { from: string }>();
      const rates: GeoRateRow[] = table.stateRates.map((r) => ({
        type: "45",
        code: STATE_FIPS[state],
        rate: r.rate,
        startsOn: r.from,
        endsOn: r.to ?? "9999-12-31",
      }));
      for (const local of table.locals) {
        // A district a county's own (a Louisiana parish's) is keyed by it.
        const county =
          local.type === "00" ||
          local.type === "rc" ||
          local.type === "no" ||
          (local.type === "maybe" && /\b(?:Parish|County)$/i.test(local.name));
        let code: string;
        try {
          code = /^\d+$/.test(local.name)
            ? local.name.slice(county ? -3 : -5)
            : county
              ? local.type === "maybe"
                ? tryEach(() => codes.county(local.name), () => codes.city(local.name))
                : codes.county(local.name)
              : codes.city(local.name);
        } catch (error) {
          if ((county && local.type !== "maybe") || !table.skipUnmatchedCities) throw error;
          console.warn(`${state}: leaving out ${local.name}: ${(error as Error).message}`);
          continue;
        }
        const keyed = local.inCounty ? `${code}@${codes.county(local.inCounty)}` : code;
        rates.push({
          type: local.type,
          code: keyed,
          rate: local.rate,
          startsOn: local.from,
          endsOn: local.to ?? "9999-12-31",
        });
        const name = local.title ?? (/^\d+$/.test(local.name) ? null : local.name);
        const known = jurisdictions.get(`${local.type}:${keyed}`);
        if ((name || local.ids) && (!known || known.from <= local.from))
          jurisdictions.set(`${local.type}:${keyed}`, { type: local.type, code: keyed, name, ids: local.ids ?? {}, from: local.from });
      }
      return {
        rates,
        jurisdictions: [...jurisdictions.values()].map(({ from: _, ...j }) => j),
        shapes: [],
        files: { rates: table.source },
      };
    },
  };
}

function tryEach(...attempts: Array<() => string>) {
  for (const [i, attempt] of attempts.entries()) {
    try {
      return attempt();
    } catch (error) {
      if (i === attempts.length - 1) throw error;
    }
  }
  throw new Error("nothing to try");
}

/** The state's county and city FIPS codes by name, from its TIGER files. */
async function censusCodes(state: string, dir?: string) {
  const fips = STATE_FIPS[state];
  const files = await latestTigerFiles([fips], dir);
  // Names are matched exactly first, then loosely (without "city", "town"
  // or spaces), so "Hobson City" doesn't collide with a "Hobson".
  const names = {
    county: new Map<string, string[]>(),
    place: new Map<string, string[]>(),
    cousub: new Map<string, string[]>(),
  };
  for (const file of files) {
    const shapes = readTigerZip(await file.bytes(), file.kind, new Set([fips]));
    const into = names[file.kind];
    for (const s of shapes)
      for (const key of new Set([exact(s.name), loose(s.name)]))
        into.set(key, [...new Set([...(into.get(key) ?? []), s.fips])]);
  }
  // A city is a Census place; a town that isn't one is a county subdivision.
  const find = (kind: "county" | "city", name: string) => {
    const lookup = (key: string) =>
      kind === "county" ? names.county.get(key) : (names.place.get(key) ?? names.cousub.get(key));
    const found = [exact(name), loose(name)].map(lookup).find((f) => f?.length === 1) ?? lookup(loose(name));
    if (!found || found.length !== 1)
      throw new Error(
        `${state}: the ${kind} "${name}" matches ${found?.length ?? 0} Census ${kind === "county" ? "counties" : "places or towns"}`,
      );
    return found[0];
  };
  return {
    county: (name: string) => find("county", name),
    city: (name: string) => find("city", name),
  };
}

const exact = (name: string) => `=${name.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()}`;

const loose = (name: string) =>
  name
    .toUpperCase()
    .replace(/[.'’]/g, "")
    .replace(/\b(COUNTY|PARISH|BOROUGH|CITY AND BOROUGH|CITY|TOWN|VILLAGE|\(CITY\))\b/g, "")
    .replace(/\bSAINT\b/g, "ST")
    .replace(/\bRD\b/g, "ROADS")
    .replace(/[^A-Z0-9]+/g, "");
