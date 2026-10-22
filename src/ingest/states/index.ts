/**
 * The states read from the map (see rates/map.ts): each one's adapter
 * fetches its official rate table, and any outlines its state publishes
 * itself (special districts the Census doesn't draw, or the state's own
 * city limits where they track annexations better), in the shape the loader
 * stores. Counties, cities and towns also come from the Census for every
 * state.
 */
import type { Shape } from "../tiger.js";

export interface GeoRateRow {
  /** 45 state, 00 county, 01 city, 01x city replacing its county, rc county
   *  outside its cities, anything else a district (see rates/map.ts). */
  type: string;
  code: string;
  rate: number;
  startsOn: string;
  endsOn: string;
}

/** One jurisdiction a rate row names, as its source describes it (see
 *  salesTaxJurisdictions): its name and identifying columns, keyed by the
 *  source's own column name, values verbatim. A rate summed from several
 *  source rows gives each row's value, comma-separated. */
export interface JurisdictionRow {
  /** The rate row's type and code it describes. */
  type: string;
  code: string;
  name: string | null;
  ids: Record<string, string>;
}

export interface GeoStateData {
  rates: GeoRateRow[];
  /** A row for each type:code whose source gives a name or ids. */
  jurisdictions: JurisdictionRow[];
  /** The state's own outlines, keyed by the code their rate rows use. */
  shapes: Array<{
    kind: "county" | "place" | "district";
    fips: string;
    name: string;
    rings: Shape["rings"];
    bbox: Shape["bbox"];
    /** Where the source dates its outlines (Colorado's and Alaska's rate
     *  service): the days this one is in force, undefined for since before
     *  the source's record and until further notice. A source that dates
     *  any outline gives its whole history, which replaces what was loaded;
     *  one that dates none is written as a new edition (boundariesFrom). */
    startsOn?: string;
    endsOn?: string;
  }>;
  /** What each part came from, as releases record it. */
  files: { rates: string; boundaries?: string };
  /** The first date the outlines are in force, where the source says (a
   *  Texas quarter's first day); the day they're loaded otherwise. */
  boundariesFrom?: string;
  /** Where the source lists some rates only in its newest edition, that
   *  edition's first day: a rate starting on it may have applied before. */
  ratesFirstListed?: string;
}

export interface GeoState {
  state: string;
  /** Reads the state's newest published data, or the copies in `dir`. */
  fetch(dir?: string): Promise<GeoStateData>;
}

import { alabama } from "./alabama.js";
import { arizona } from "./arizona.js";
import { alaska, colorado } from "./ttr.js";
import { florida } from "./florida.js";
import { hawaii } from "./hawaii.js";
import { idaho } from "./idaho.js";
import { illinois } from "./illinois.js";
import { louisiana } from "./louisiana.js";
import { mississippi } from "./mississippi.js";
import { montana } from "./montana.js";
import { newMexico } from "./new-mexico.js";
import { newYork } from "./new-york.js";
import { pennsylvania } from "./pennsylvania.js";
import { southCarolina } from "./south-carolina.js";
import { texas } from "./texas.js";
import { virginia } from "./virginia.js";

export const GEO_STATES: GeoState[] = [
  texas,
  montana,
  florida,
  newYork,
  virginia,
  arizona,
  newMexico,
  illinois,
  southCarolina,
  colorado,
  alabama,
  louisiana,
  alaska,
  pennsylvania,
  hawaii,
  mississippi,
  idaho,
];
