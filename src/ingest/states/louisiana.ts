/**
 * Louisiana: 5% state plus one combined local rate (parish, school board,
 * city, districts) for each "domicile", from the Remote Sellers Commission's
 * rate lookup, parish by parish for this filing period. A parish's own
 * domicile covers it outside its cities; a city's stands in for its parish's.
 *
 * Domiciles are classified by name, with OVERRIDES where a name doesn't say
 * what it is. What the lookup alone can't place is refused, never guessed:
 *   - a district (economic development, fire, hospital, school, ward) without
 *     an outline, where its rate differs: in the city its name gives; outside
 *     every city when its name says unincorporated; otherwise anywhere in its
 *     parish;
 *   - a city's part in a parish other than the one most of it lies in: the
 *     lookup lists that part with only the share that parish's collector
 *     takes (Duson in Acadia is 3%, the whole local rate there is 6.25%), so
 *     the part, cut from the Census outlines, is refused;
 *   - a city listed twice in one parish at two rates, and a parish with no
 *     domicile of its own whose unincorporated domiciles differ.
 * East Baton Rouge Parish publishes its sales tax domiciles as outlines,
 * which are loaded as exclusive areas at the lookup's rates (EBR_LETTERS);
 * the French Quarter EDD, whose rate the lookup gives without the district's
 * own tax, is refused in an area drawn around it (FRENCH_QUARTER_ZONE).
 * Coverage starts this period.
 *
 * A parish's, city's or EBR area's rate keeps its domiciles' names, and as
 * ids their Domicile Code and parish, as the lookup labels them; a refusal
 * ("maybe") has none.
 */
import https from "node:https";
import tls from "node:tls";
import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { latestTigerFiles } from "../downloads.js";
import { readTigerZip, type Shape } from "../tiger.js";
import type { GeoRateRow, GeoState, GeoStateData, JurisdictionRow } from "./index.js";
import { bboxOf, ringsOf } from "./sources.js";

const LOOKUP = "https://remotesellersfiling.louisiana.gov/lookup/lookup.aspx";
/** The site serves its certificate without GoDaddy's intermediate, so the
 *  intermediate is fetched from GoDaddy and trusted beside the usual roots;
 *  verification stays on. */
const INTERMEDIATE = "https://certs.godaddy.com/repository/gdig2.crt.pem";
const STATE = 0.05;
const FIPS = "22";
const PARISHES = 64;
/** East Baton Rouge City-Parish's sales tax domicile outlines. */
const EBR_DOMICILES = "https://maps.brla.gov/gis/rest/services/Governmental_Units/Sales_Tax_Domicile/MapServer/0";
/** Where the French Quarter EDD may be: 250 m around every point of a
 *  250 m grid that the Uniform Local Sales Tax Board's lookup placed in its
 *  domicile (3601) on 2026-10-21, a wider area than the district (New
 *  Orleans publishes its outline without geometry). */
const FRENCH_QUARTER_ZONE: Array<[number, number]> = [
  [-90.0736, 29.9549], [-90.0736, 29.9601], [-90.0711, 29.9601], [-90.0711, 29.9651], [-90.0661, 29.9651],
  [-90.0661, 29.9676], [-90.0609, 29.9676], [-90.0609, 29.9651], [-90.0559, 29.9651], [-90.0559, 29.9626],
  [-90.0534, 29.9626], [-90.0534, 29.9574], [-90.0584, 29.9574], [-90.0584, 29.9549], [-90.0609, 29.9549],
  [-90.0609, 29.9474], [-90.0661, 29.9474], [-90.0661, 29.9499], [-90.0686, 29.9499], [-90.0686, 29.9524],
  [-90.0736, 29.9524], [-90.0736, 29.9549],
];
/** The French Quarter EDD's own tax, which the lookup's 3601 rate leaves out
 *  (renewed by its voters for 2026-07-01 to 2031-06-30). */
const FRENCH_QUARTER_TAX = 0.002495;
/** EBR's domicile letters as the lookup's codes. */
const EBR_LETTERS: Record<string, string> = {
  A: "1701", B: "1700", C: "1706", D: "1702", E: "1707", F: "1705", G: "1703", H: "1708",
  K: "1709", L: "1710", M: "1711", N: "1712", O: "1713", P: "1714", Q: "1715", R: "1716",
  S: "1717", T: "1718",
};
/** EBR outlines the Uniform Local Sales Tax Board's own lookup places in
 *  another domicile (its map has Southern University's EDD stop at Baton
 *  Rouge's and Baker's limits), by letter and city: refused. */
const EBR_DISPUTED = new Set(["O|BATON ROUGE", "P|BAKER"]);

/** A district that is a parish's own or a city's (by name), or lies outside
 *  every city ("unincorporated"), or anywhere in its parish ("parish"). */
type Kind =
  | { kind: "parish" }
  | { kind: "city"; city: string; qualified?: string }
  | { kind: "district"; within: "unincorporated" | "parish" | string[] }
  | { kind: "skip"; why: string };

/** Domiciles whose names don't say what they are, by code. */
const OVERRIDES: Record<string, Kind> = {
  // Parishes with no domicile of their own name: their unincorporated areas.
  "0303": { kind: "parish" }, "0304": { kind: "parish" },
  "1008": { kind: "parish" }, "1007": { kind: "district", within: "unincorporated" },
  "1201": { kind: "parish" },
  "2007": { kind: "parish" },
  "2911": { kind: "parish" }, "2912": { kind: "district", within: "unincorporated" },
  "5007": { kind: "parish" }, "5006": { kind: "district", within: "unincorporated" },
  "5102": { kind: "parish" }, "5103": { kind: "parish" }, "5104": { kind: "parish" }, "5109": { kind: "parish" },
  // Ascension's cities, annexed areas and districts.
  "0301": { kind: "city", city: "Donaldsonville" },
  "0302": { kind: "city", city: "Gonzales" },
  "0305": { kind: "city", city: "Sorrento" },
  "0307": { kind: "district", within: ["Donaldsonville"] },
  "0308": { kind: "district", within: ["Gonzales"] },
  "0311": { kind: "district", within: ["Gonzales"] },
  "0312": { kind: "district", within: ["Gonzales"] },
  "0313": { kind: "district", within: ["Gonzales"] },
  // St. Martin's.
  "5008": { kind: "city", city: "Broussard", qualified: "St. Martin Parish" },
  "5009": { kind: "district", within: ["Breaux Bridge"] },
  "5010": { kind: "district", within: ["Breaux Bridge"] },
  "5011": { kind: "district", within: ["St. Martinville"] },
  "5013": { kind: "district", within: ["St. Martinville"] },
  "5012": { kind: "district", within: ["Henderson"] },
  // Names with more than the town's.
  "0707": { kind: "city", city: "Saline" },
  "2805": { kind: "city", city: "Scott" },
  "3106": { kind: "city", city: "Simsboro" },
  "3406": { kind: "city", city: "Bastrop" },
  "1701": { kind: "city", city: "Baton Rouge" },
  "1702": { kind: "city", city: "Baker" },
  "1707": { kind: "city", city: "Baker" },
  "1703": { kind: "city", city: "Central" },
  "1705": { kind: "city", city: "Zachary" },
  "1712": { kind: "city", city: "St. George" },
  "6201": { kind: "city", city: "Oak Grove" },
  "6202": { kind: "city", city: "Epps" },
  "6401": { kind: "city", city: "Winnfield" },
  "6301": { kind: "city", city: "St. Francisville" },
  "5904": { kind: "district", within: "unincorporated" },
  "6009": { kind: "district", within: "unincorporated" },
  "3705": { kind: "district", within: "unincorporated" },
  "5209": { kind: "district", within: ["Slidell"] },
  "1503": { kind: "district", within: ["Vidalia"] },
  "4915": { kind: "district", within: ["Opelousas"] },
  "5701": { kind: "city", city: "Abbeville" },
  "5702": { kind: "city", city: "Delcambre", qualified: "Vermilion Parish" },
  "5703": { kind: "city", city: "Erath" },
  "5704": { kind: "city", city: "Kaplan" },
  "5705": { kind: "city", city: "Maurice" },
  "4306": { kind: "district", within: "unincorporated" },
  // Caddo's school board and law enforcement share of Bossier City's rate,
  // which is Bossier Parish's to list.
  "0913": { kind: "skip", why: "a Caddo collector's share inside Bossier City" },
};
/** Where the Uniform Local Sales Tax Board's own lookup placed districts
 *  whose names don't say, on 2026-10-21: a domicile is one combination of
 *  taxes, so one seen well inside a city (150 m from its line) lies wholly
 *  inside it, and one seen outside every city lies wholly outside them. */
const PLACED: Record<string, "unincorporated" | string[]> = {
  "0306": ["Gonzales"],
  "0909": "unincorporated", "0910": "unincorporated", "0912": "unincorporated", "0914": "unincorporated",
  "0911": ["Shreveport"],
  "1012": ["Lake Charles"],
  // Not seen, but created by the City of Lake Charles in 2018 with a 1% tax.
  "1013": ["Lake Charles"],
  "2307": "unincorporated",
  "2706": ["Jennings"],
  "2812": ["Lafayette"], "2815": ["Lafayette"], "2816": ["Lafayette"], "2817": ["Lafayette"],
  "2818": ["Lafayette"], "2820": ["Lafayette"], "2821": ["Lafayette"],
  // Not seen, but one of the five the City of Lafayette created in 2020
  // (with Downtown, Holy Rosary, Northway and University Gateway).
  "2819": ["Lafayette"],
  "3208": "unincorporated", "3209": "unincorporated",
  "4010": "unincorporated",
  "5309": "unincorporated",
  // Not seen, but one of the City of Slidell's own three (with Fremaux Town
  // Center and North Shore Square).
  "5212": ["Slidell"],
  "3211": "unincorporated", "3213": "unincorporated", "3215": "unincorporated",
  "3517": "unincorporated", "3518": "unincorporated", "3519": "unincorporated",
  "4011": "unincorporated", "4013": "unincorporated",
};
/** The lookup's spellings that differ from the Census's. */
const SPELLINGS: Record<string, string> = {
  "Lake Authur": "Lake Arthur",
  Cowley: "Crowley",
  Keatchie: "Keachi",
  Camptie: "Campti",
  Goldanna: "Goldonna",
  "St. John Parish": "St. John the Baptist Parish",
  "La Salle Parish": "LaSalle Parish",
};
/** A domicile that is a district rather than a parish or a town. */
const DISTRICT = /\bEDDs?\b|\bDist\b|District|Development|School|\bSch\b|Jury|Fire|\bFD\b|FD#|Hosp|Annex|Law Enf|\bWards?\b|\bRD\b|Common Area|\bDD\b|Opportunity|Corridor|Econ\b/i;
const UNINCORPORATED = /Unincorp|\bOutside\b|Balance of Parish|\bRural\b|^Wards?\b|^Ward\b|^Parish of /i;

export const louisiana: GeoState = {
  state: "LA",
  async fetch(dir) {
    const today = new Date();
    const period = `${String(today.getUTCMonth() + 1).padStart(2, "0")}-01-${today.getUTCFullYear()}`;
    const from = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const { parishes, domiciles } = await readLookup(period);
    const census = await censusShapes(dir);
    const rates: GeoRateRow[] = [{ type: "45", code: FIPS, rate: STATE, startsOn: from, endsOn: "9999-12-31" }];
    const row = (type: string, code: string, rate: number) =>
      rates.push({ type, code, rate: Math.round(rate * 1e6) / 1e6, startsOn: from, endsOn: "9999-12-31" });
    const shapes: GeoStateData["shapes"] = [];
    const warn = (m: string) => console.warn(`LA: ${m}`);
    const jurisdictions = new Map<string, JurisdictionRow>();
    /** A rate's source: the domiciles it was read from, each value listed. */
    const describe = (type: string, code: string, from: Array<{ code: string; name: string }>) => {
      const list = (values: string[]) => [...new Set(values)].join(", ");
      const parish = (d: { code: string }) => parishes.get(d.code.slice(0, 2));
      jurisdictions.set(`${type}:${code}`, {
        type,
        code,
        name: list(from.map((d) => d.name)) || null,
        ids: {
          "Domicile Code": list(from.map((d) => d.code)),
          Parish: list(from.map((d) => parish(d)?.name ?? "")),
          "Parish Code": list(from.map((d) => parish(d)?.value ?? "")),
        },
      });
    };

    // Every domicile, classified, by parish.
    const byParish = new Map<string, Array<{ code: string; name: string; rate: number; kind: Kind }>>();
    for (const [code, d] of domiciles) {
      const parish = parishes.get(code.slice(0, 2));
      if (!parish) {
        warn(`domicile ${code} ${d.name} is under no parish`);
        continue;
      }
      const kind = OVERRIDES[code] ?? classify(d.name, parish.name);
      byParish.set(parish.key, [...(byParish.get(parish.key) ?? []), { code, ...d, kind }]);
    }

    const ebr = await ebrDomiciles(domiciles);
    const ebrHandled = new Set(Object.values(EBR_LETTERS));
    const quarter = [FRENCH_QUARTER_ZONE];
    const cityParishes = await cityParts(census);

    for (const [key, list] of byParish) {
      const parish = [...parishes.values()].find((p) => p.key === key)!;
      const county = census.county(parish.name);
      if (!county) throw new Error(`LA: no Census parish for ${parish.name}`);
      const own = list.filter((d) => d.kind.kind === "parish");
      const ownRates = [...new Set(own.map((d) => d.rate))];
      const baseRate = ownRates.length ? Math.min(...ownRates) : null;
      if (baseRate !== null) {
        row("rc", county, baseRate);
        describe("rc", county, own.filter((d) => d.rate === baseRate));
      }
      // Unincorporated areas at two rates, with no outline between them.
      for (const r of ownRates) if (r !== baseRate) row("maybe", county, r);
      if (baseRate === null) {
        warn(`${parish.name} has no domicile of its own; its unincorporated areas are refused`);
        row("maybe", county, 0);
      }

      // Cities, by Census place, at the rate of their domicile here.
      const cityRates = new Map<string, { name: string; rates: number[]; domiciles: Array<{ code: string; name: string; rate: number }> }>();
      for (const d of list) {
        if (d.kind.kind !== "city") continue;
        const place = census.place(d.kind.city);
        if (!place) {
          // A town the Census doesn't know by this name could be anywhere in
          // the parish.
          warn(`${d.code} ${d.name}: no Census place "${d.kind.city}"; refusing ${parish.name} unincorporated`);
          row("maybe", county, d.rate);
          continue;
        }
        if (d.kind.qualified && census.county(d.kind.qualified) !== county) {
          warn(`${d.code} ${d.name} is listed under ${parish.name}; left out`);
          continue;
        }
        const known = cityRates.get(place) ?? { name: d.kind.city, rates: [], domiciles: [] };
        known.rates.push(d.rate);
        known.domiciles.push(d);
        cityRates.set(place, known);
      }
      for (const [place, { name, rates: rs, domiciles: ds }] of cityRates) {
        const parts = cityParishes.get(place);
        const primary: string = parts?.primary ?? county;
        if (primary !== county) {
          // The lookup's rate for a city's lesser part is one collector's
          // share; that part is refused (below, with the city's outlines).
          if (!parts) warn(`${name} has no Census outline`);
          continue;
        }
        const distinct = [...new Set(rs)];
        row("01x", place, Math.min(...distinct));
        describe("01x", place, ds.filter((d) => d.rate === Math.min(...distinct)));
        for (const r of distinct) if (r !== Math.min(...distinct)) row("maybe", place, r);
      }

      // Districts without outlines.
      for (const d of list) {
        if (d.kind.kind !== "district" || (key === "17" && ebrHandled.has(d.code)) || d.code === "3601") continue;
        const placed = PLACED[d.code];
        let within = (placed ?? d.kind.within) as "unincorporated" | "parish" | string[];
        // A district named for one of the parish's cities is in it (the
        // longest name, so "West Monroe EDD" isn't Monroe's).
        if (within === "parish") {
          const named = [...cityRates.values()]
            .map((c) => c.name)
            .filter((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(d.name));
          const longest = named.filter((c) => !named.some((o) => o !== c && o.toLowerCase().includes(c.toLowerCase())));
          if (longest.length) within = longest;
        }
        const citiesHere = [...cityRates.entries()].filter(([place]) => (cityParishes.get(place)?.primary ?? county) === county);
        const refuseCity = (place: string, rate: number) => {
          const city = citiesHere.find(([p]) => p === place);
          if (!city || city[1].rates.includes(rate)) return;
          row("maybe", place, rate);
        };
        if (within === "unincorporated" || within === "parish") {
          if (baseRate === null || rate6(d.rate) !== rate6(baseRate)) row("maybe", county, d.rate);
          if (within === "parish") for (const [place] of citiesHere) refuseCity(place, d.rate);
        } else
          for (const city of within) {
            const place = census.place(city);
            if (!place) {
              warn(`${d.code} ${d.name}: no Census place "${city}"; refusing all of ${parish.name}`);
              row("maybe", county, d.rate);
              for (const [p] of citiesHere) refuseCity(p, d.rate);
              continue;
            }
            refuseCity(place, d.rate);
            // A district named for the parish's namesake city may be in
            // either.
            if (!placed && loose(city) === loose(parish.name)) row("maybe", county, d.rate);
          }
      }
    }

    // A city's parts outside the parish most of it is in.
    for (const [place, parts] of cityParishes)
      for (const part of parts.lesser) {
        if (!rates.some((r) => r.code === place && r.type === "01x")) continue;
        const code = `${place}@${part.county}`;
        shapes.push({ kind: "district", fips: code, name: `${part.name}'s part in ${part.parish}`, rings: part.rings, bbox: bboxOf(part.rings) });
        row("x", code, rates.find((r) => r.code === place && r.type === "01x")!.rate);
        row("maybe", code, 0);
      }

    // East Baton Rouge's domicile outlines, as exclusive areas.
    for (const s of ebr) {
      shapes.push({ kind: "district", fips: s.code, name: s.name, rings: s.rings, bbox: bboxOf(s.rings) });
      row("x", s.code, s.rate);
      describe("x", s.code, [{ code: s.domicile, name: domiciles.get(s.domicile)!.name }]);
      if (s.disputedRate !== undefined) row("maybe", s.code, s.disputedRate - s.rate);
    }
    // EBR's districts all have outlines; its parish and cities need no
    // refusal for them.
    const ebrCounty = census.county("East Baton Rouge Parish");
    if (ebr.length)
      for (let i = rates.length - 1; i >= 0; i--) {
        const r = rates[i];
        if (r.type !== "maybe") continue;
        const inEbr = r.code === ebrCounty || cityParishes.get(r.code)?.primary === ebrCounty;
        if (inEbr) rates.splice(i, 1);
      }

    // The French Quarter EDD: refused, at the lookup's rate and with the
    // district's own tax.
    {
      const orleans = domiciles.get("3601");
      shapes.push({ kind: "district", fips: "3601", name: "The French Quarter EDD's area", rings: quarter, bbox: bboxOf(quarter) });
      row("x", "3601", orleans?.rate ?? 0.05);
      if (orleans) describe("x", "3601", [{ code: "3601", name: orleans.name }]);
      row("maybe", "3601", FRENCH_QUARTER_TAX);
    }

    const kept = dedupe(rates);
    const rated = new Set(kept.map((r) => `${r.type}:${r.code}`));
    return {
      rates: kept,
      jurisdictions: [...jurisdictions.values()].filter((j) => rated.has(`${j.type}:${j.code}`)),
      shapes,
      files: {
        rates: `LA Remote Sellers Commission rates for ${period}`,
        boundaries: "EBR City-Parish Sales_Tax_Domicile; Census places by parish",
      },
    };
  },
};

const rate6 = (r: number) => Math.round(r * 1e6);

/** What a domicile's name says it is. */
function classify(raw: string, parishName: string): Kind {
  const name = raw.replace(/\s+/g, " ").trim();
  const spelled = SPELLINGS[name] ?? name;
  if (loose(spelled) === loose(parishName) && /Parish$/i.test(spelled)) return { kind: "parish" };
  if (DISTRICT.test(name)) {
    if (UNINCORPORATED.test(name)) return { kind: "district", within: "unincorporated" };
    return { kind: "district", within: "parish" };
  }
  if (UNINCORPORATED.test(name)) return { kind: "district", within: "unincorporated" };
  // "City of Eunice & Parish", "Within the TOWN OF FRANKLINTON",
  // "Basile City limits in Acadia Parish", "Shreveport ONLY".
  let city = name
    .replace(/^Within (?:the )?/i, "")
    .replace(/^(?:City|Town|Village) of /i, "")
    .replace(/ city limits\b/i, "")
    .replace(/ (?:Sales|ONLY|Corporate Limits Only|Incorporated Area Only|Inside Town Limits|& Parish)$/i, "");
  let qualified: string | undefined;
  const m = /^(.+?)(?: - | (?:in|within) | )((?:[A-Z][A-Za-z.]*\s)*?[A-Z][A-Za-z.]* Parish)$/.exec(city);
  if (m) {
    city = m[1];
    qualified = SPELLINGS[m[2]] ?? m[2];
  }
  city = SPELLINGS[city] ?? city;
  return { kind: "city", city: titleCase(city), qualified };
}

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s);

const loose = (name: string) =>
  name
    .toUpperCase()
    .replace(/[.'’]/g, "")
    .replace(/\b(PARISH|CITY|TOWN|VILLAGE)\b/g, "")
    .replace(/\bSAINT\b/g, "ST")
    .replace(/[^A-Z0-9]+/g, "");

/** Census parishes and incorporated places, by loose name. */
async function censusShapes(dir?: string) {
  const counties = new Map<string, Shape[]>();
  const places = new Map<string, Shape[]>();
  for (const file of await latestTigerFiles([FIPS], dir)) {
    if (file.kind === "cousub") continue;
    for (const s of readTigerZip(await file.bytes(), file.kind, new Set([FIPS]))) {
      const into = file.kind === "county" ? counties : places;
      into.set(loose(s.name), [...(into.get(loose(s.name)) ?? []), s]);
    }
  }
  const one = (map: Map<string, Shape[]>, name: string) => {
    const found = map.get(loose(name));
    return found?.length === 1 ? found[0] : null;
  };
  return {
    county: (name: string) => one(counties, name)?.fips ?? null,
    place: (name: string) => one(places, name)?.fips ?? null,
    counties: [...counties.values()].flat(),
    places: [...places.values()].flat(),
  };
}

interface Part {
  county: string;
  parish: string;
  name: string;
  rings: Shape["rings"];
}

/** Each place in more than one parish: the parish most of it is in, and
 *  its parts in the others, cut on the map. */
async function cityParts(census: Awaited<ReturnType<typeof censusShapes>>) {
  const out = new Map<string, { primary: string; lesser: Part[] }>();
  const overlaps = (a: Shape["bbox"], b: Shape["bbox"]) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  const geo = (rings: Shape["rings"]) => JSON.stringify({ type: "MultiLineString", coordinates: rings });
  for (const place of census.places) {
    const near = census.counties.filter((c) => overlaps(c.bbox, place.bbox));
    const pieces: Array<{ county: Shape; area: number; geojson: string | null }> = [];
    for (const county of near) {
      // Rings as areas by the odd-count rule, then cut by the parish.
      const [r] = await db.execute<{ area: number; g: string | null }>(sql`
        with a as (select st_buildarea(st_unaryunion(st_setsrid(st_geomfromgeojson(${geo(place.rings)}), 4326))) as g),
             b as (select st_buildarea(st_unaryunion(st_setsrid(st_geomfromgeojson(${geo(county.rings)}), 4326))) as g),
             i as (select st_collectionextract(st_intersection(st_makevalid(a.g), st_makevalid(b.g)), 3) as g from a, b)
        select st_area(g::geography) as area, case when st_area(g) > 0 then st_asgeojson(g, 6) end as g from i`);
      if (r && Number(r.area) > 0) pieces.push({ county, area: Number(r.area), geojson: r.g });
    }
    if (!pieces.length) continue;
    pieces.sort((a, b) => b.area - a.area);
    out.set(place.fips, {
      primary: pieces[0].county.fips,
      lesser: pieces.slice(1).map((p) => ({
        county: p.county.fips,
        parish: p.county.name,
        name: place.name,
        rings: ringsOf(JSON.parse(p.geojson!)),
      })),
    });
  }
  return out;
}

/** EBR's outlines with the lookup's rate for each, and the other rate where
 *  the board's own lookup disagrees. */
async function ebrDomiciles(domiciles: Map<string, { name: string; rate: number }>) {
  const out: Array<{ code: string; domicile: string; name: string; rate: number; rings: Shape["rings"]; disputedRate?: number }> = [];
  const features = await layer(EBR_DOMICILES);
  for (const f of features) {
    const letter = String(f.attributes.SalesTaxDo ?? "").trim();
    const city = String(f.attributes.JURISDICTI ?? "").trim();
    const domicile = domiciles.get(EBR_LETTERS[letter] ?? "");
    if (!domicile) throw new Error(`LA: EBR domicile ${letter} matches no lookup code`);
    const disputed = EBR_DISPUTED.has(`${letter}|${city}`);
    out.push({
      code: `EBR-${letter}-${city || "UNINC"}`,
      domicile: EBR_LETTERS[letter],
      name: `EBR ${domicile.name}${city ? ` (${city})` : ""}`,
      rate: domicile.rate,
      rings: f.rings,
      // The board's lookup has the city's own domicile there.
      disputedRate: disputed ? domiciles.get(city === "BAKER" ? "1702" : "1701")!.rate : undefined,
    });
  }
  return out;
}

/** A small layer's features in one request (these servers don't page). */
async function layer(url: string, where = "1=1") {
  const query = new URL(`${url}/query`);
  query.search = new URLSearchParams({ where, outFields: "*", outSR: "4326", f: "geojson", geometryPrecision: "6" }).toString();
  const response = await fetch(query, { headers: { "User-Agent": "Mozilla/5.0 (compatible; opentaxrate data loader)" }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const body = (await response.json()) as {
    features?: Array<{ properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }>;
    error?: { message: string };
  };
  if (body.error || !body.features) throw new Error(`${url}: ${body.error?.message ?? "no features"}`);
  if (body.features.length >= 1000) throw new Error(`${url} has more features than one request returns`);
  return body.features.map((f) => ({ attributes: f.properties, rings: ringsOf(f.geometry) })).filter((f) => f.rings.length);
}

/** One row per type and code, the first kept but a "maybe" at its highest
 *  rate. */
function dedupe(rates: GeoRateRow[]) {
  const by = new Map<string, GeoRateRow>();
  for (const r of rates) {
    const key = `${r.type}|${r.code}`;
    const known = by.get(key);
    if (!known || (r.type === "maybe" && Math.abs(r.rate) > Math.abs(known.rate))) by.set(key, r);
  }
  return [...by.values()];
}

interface Form {
  html: string;
  cookie: string;
}

/** Every parish's domiciles for the period: the parishes as the lookup's
 *  menu lists them (Washington is 5906, not 5900), keyed by the code's first
 *  two digits. */
async function readLookup(period: string) {
  let form = await page();
  const parishes = new Map<string, { key: string; value: string; name: string }>();
  for (const [, value, label] of form.html.matchAll(/<option[^>]*value="(\d{4})"[^>]*>\s*([^<(]+? Parish)\s*\(\d{4}\)/g)) {
    const name = SPELLINGS[label.trim()] ?? label.trim();
    parishes.set(value.slice(0, 2), { key: value.slice(0, 2), value, name });
  }
  if (parishes.size !== PARISHES) throw new Error(`Louisiana lookup lists ${parishes.size} parishes`);
  const domiciles = new Map<string, { name: string; rate: number }>();
  for (const parish of parishes.values()) {
    form = await page(form, { ddlJurisdiction: parish.value, ddlFilingPeriod: period, __EVENTTARGET: "ddlJurisdiction" });
    let found = 0;
    for (const [, name, code, rate] of form.html.matchAll(
      /<td[^>]*>\s*([^<]+?)\s*\((\d{4})\)\s*<\/td>\s*<td[^>]*>\s*([\d.]+)%/g,
    )) {
      domiciles.set(code, { name: decode(name).replace(/\s+/g, " ").trim(), rate: Number(rate) / 100 });
      found++;
    }
    if (!found) throw new Error(`Louisiana lookup gave no domiciles for ${parish.name}`);
  }
  return { parishes, domiciles };
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

/** The lookup page, after posting `fields` back with its form state. */
async function page(previous?: Form, fields: Record<string, string> = {}): Promise<Form> {
  const hidden = (name: string) =>
    decode(new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(previous?.html ?? "")?.[1] ?? "");
  const body = previous
    ? new URLSearchParams({
        __VIEWSTATE: hidden("__VIEWSTATE"),
        __VIEWSTATEGENERATOR: hidden("__VIEWSTATEGENERATOR"),
        __EVENTVALIDATION: hidden("__EVENTVALIDATION"),
        __EVENTARGUMENT: "",
        ddlStateSelect: "LA",
        ddlAuthority: "1000",
        ddlReturn: "1000",
        ...fields,
      }).toString()
    : undefined;
  const ca = [...tls.rootCertificates, await intermediate()];
  return new Promise((resolve, reject) => {
    const request = https.request(
      LOOKUP,
      {
        method: previous ? "POST" : "GET",
        ca,
        timeout: 60_000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; opentaxrate data loader)",
          ...(previous
            ? { "Content-Type": "application/x-www-form-urlencoded", Cookie: previous.cookie, "Content-Length": Buffer.byteLength(body!) }
            : {}),
        },
      },
      (response) => {
        let html = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (html += chunk));
        response.on("end", () => {
          if ((response.statusCode ?? 500) >= 400)
            return reject(new Error(`Louisiana lookup answered ${response.statusCode}`));
          const cookie = (response.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]).join("; ");
          resolve({ html, cookie: cookie || previous?.cookie || "" });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("Louisiana lookup timed out")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

let intermediatePem: Promise<string> | null = null;
function intermediate() {
  intermediatePem ??= fetch(INTERMEDIATE).then((r) => {
    if (!r.ok) throw new Error(`${INTERMEDIATE} answered ${r.status}`);
    return r.text();
  });
  return intermediatePem;
}
