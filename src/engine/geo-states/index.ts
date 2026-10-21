/**
 * The states read from the map (see geo-lookup.ts): each one's adapter
 * fetches its official rate table, and any outlines its state publishes
 * itself (special districts the Census doesn't draw, or the state's own
 * city limits where they track annexations better), in the shape the loader
 * stores. Counties, cities and towns also come from the Census for every
 * state.
 */
import type { Shape } from "../tiger.js";

export interface GeoRateRow {
  /** 45 state, 00 county, 01 city, 01x city replacing its county, rc county
   *  outside its cities, anything else a district (see geo-lookup.ts). */
  type: string;
  code: string;
  rate: number;
  startsOn: string;
  endsOn: string;
}

export interface GeoStateData {
  rates: GeoRateRow[];
  /** The state's own outlines, keyed by the code their rate rows use. */
  shapes: Array<{
    kind: "county" | "place" | "district";
    fips: string;
    name: string;
    rings: Shape["rings"];
    bbox: Shape["bbox"];
  }>;
  /** What each part came from, as releases record it. */
  files: { rates: string; boundaries?: string };
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
import { newMexico } from "./new-mexico.js";
import { newYork } from "./new-york.js";
import { pennsylvania } from "./pennsylvania.js";
import { southCarolina } from "./south-carolina.js";
import { texas } from "./texas.js";
import { virginia } from "./virginia.js";

export const GEO_STATES: GeoState[] = [
  texas,
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

export const geoStateOf = (state: string) =>
  GEO_STATES.find((g) => g.state === state) ?? null;
