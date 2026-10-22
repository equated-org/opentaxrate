/**
 * Brings OpenTaxRate's data up to date, state by state:
 *   1. each Streamlined member's newest rate and boundary files;
 *   2. Missouri's rate and address-range files, in the same layout;
 *   3. each map-read state's rate table and its own outlines;
 *   4. the streets in each ZIP of the map-read states, from TIGER address
 *      features;
 *   5. the Census Bureau's newest county, city and town outlines for all of
 *      them.
 * A file already loaded is skipped unless `force`; a map-read state is
 * fetched again every run, since its sources don't name versions alike.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { salesTaxDataReleases, salesTaxShapes, zipStreetNames } from "../db/schema.js";
import { latestSstFiles, latestTigerAddressFiles, latestTigerFiles, sstFileLines } from "./downloads.js";
import { loadStreetNames } from "./street-names.js";
import { GEO_STATES } from "./states/index.js";
import { loadGeoState, loadSstState, loadTigerShapes } from "./load.js";
import { fetchRangePolygons, loadRangePolygons } from "./range-polygons.js";
import { RANGE_POLYGON_SOURCES, type RangePolygonState } from "../range-polygon-sources.js";
import { missouriFiles } from "./missouri.js";
import { RANGE_FIPS, STATE_FIPS } from "../coverage.js";

export interface RefreshOptions {
  /** Two-letter codes; every state when empty. */
  states?: string[];
  /** A folder of already-downloaded files to read before the web. */
  dir?: string;
  force?: boolean;
  log?: (line: string) => void;
}

export async function refreshAddressRates({ states = [], dir, force = false, log = console.log }: RefreshOptions = {}) {
  const wanted = (state: string) => !states.length || states.includes(state);
  const seconds = (started: number) => `${Math.round((Date.now() - started) / 1000)}s`;
  const ranges = (counts: { rates: number; jurisdictions: number; areas: number; streets: number; zips: number }) =>
    `${counts.rates} rates, ${counts.jurisdictions ? `${counts.jurisdictions} jurisdictions, ` : ""}${counts.areas} areas, ${counts.streets} street ranges, ${counts.zips} ZIP ranges`;

  const files = await latestSstFiles(dir);
  const loaded = new Map(
    (await db.select().from(salesTaxDataReleases)).map((r) => [`${r.state}:${r.kind}`, r.file]),
  );
  for (const state of [...new Set(files.map((f) => f.state))].sort()) {
    if (!wanted(state)) continue;
    const rates = files.find((f) => f.state === state && f.kind === "rates");
    const boundaries = files.find((f) => f.state === state && f.kind === "boundaries");
    if (!rates || !boundaries) {
      log(`${state}: missing its ${rates ? "boundary" : "rate"} file`);
      continue;
    }
    if (!force && loaded.get(`${state}:rates`) === rates.name && loaded.get(`${state}:boundaries`) === boundaries.name) {
      log(`${state}: ${rates.name} + ${boundaries.name} already loaded`);
      continue;
    }
    const started = Date.now();
    const counts = await loadSstState({
      state,
      rates: { name: rates.name, lines: sstFileLines(rates) },
      boundaries: { name: boundaries.name, lines: sstFileLines(boundaries) },
    });
    log(`${state}: ${rates.name} + ${boundaries.name} → ${ranges(counts)} in ${seconds(started)}`);
  }

  if (wanted("MO")) {
    const started = Date.now();
    const mo = await missouriFiles(dir);
    log(`MO: ${mo.rates.name} + ${mo.boundaries.name} → ${ranges(await loadSstState(mo))} in ${seconds(started)}`);
  }

  for (const geo of GEO_STATES) {
    if (!wanted(geo.state)) continue;
    const started = Date.now();
    const data = await geo.fetch(dir);
    const counts = await loadGeoState(geo.state, data);
    const from = [data.files.rates, data.files.boundaries].filter(Boolean).join(" + ");
    log(`${geo.state}: ${from} → ${counts.rates} rates, ${counts.jurisdictions} jurisdictions, ${counts.shapes} outlines in ${seconds(started)}`);
  }

  // Range states keep their dated rates and address ranges. Extra tax
  // polygons can resolve a ZIP split that Census county/city outlines cannot.
  for (const state of Object.keys(RANGE_POLYGON_SOURCES) as RangePolygonState[]) {
    if (!wanted(state)) continue;
    const source = RANGE_POLYGON_SOURCES[state];
    const existing = await db.select({ file: salesTaxShapes.file }).from(salesTaxShapes)
      .where(and(
        eq(salesTaxShapes.state, state),
        eq(salesTaxShapes.file, source.file),
      )).limit(1);
    if (!force && existing.length) {
      log(`${state}: ${source.file} already loaded`);
      continue;
    }
    const started = Date.now();
    const count = await loadRangePolygons(state, await fetchRangePolygons(state, dir));
    log(`${state}: ${source.file} → ${count} tax outlines in ${seconds(started)}`);
    if (state === "MO") log("MO: MSDIS polygon updates discontinued; archived boundaries, current rates from DOR workbooks");
  }

  // The streets in each ZIP of the map-read states, for telling a typo from
  // another street; a TIGER year already loaded is kept.
  const namesLoaded = new Set(
    (await db.selectDistinct({ state: zipStreetNames.state, file: zipStreetNames.file }).from(zipStreetNames)).map(
      (r) => `${r.state}:${r.file}`,
    ),
  );
  for (const geo of GEO_STATES) {
    if (!wanted(geo.state)) continue;
    const year = (await latestTigerAddressFiles(STATE_FIPS[geo.state], dir)).year;
    if (!force && namesLoaded.has(`${geo.state}:tl_${year}_${STATE_FIPS[geo.state]}_addrfeat`)) {
      log(`${geo.state}: TIGER ${year} street names already loaded`);
      continue;
    }
    const started = Date.now();
    await loadStreetNames(geo.state, dir, (line) => log(`${line} in ${seconds(started)}`));
  }

  const shapeStates = [...Object.keys(RANGE_FIPS), ...GEO_STATES.map((g) => g.state)].filter(wanted);
  const loadedShapes = new Set(
    (await db.selectDistinct({ state: salesTaxShapes.state, file: salesTaxShapes.file }).from(salesTaxShapes)).map(
      (r) => `${r.state}:${r.file}`,
    ),
  );
  for (const file of await latestTigerFiles(shapeStates.map((s) => STATE_FIPS[s]), dir)) {
    const forStates =
      file.kind === "county" ? shapeStates : shapeStates.filter((s) => file.name.includes(`_${STATE_FIPS[s]}_`));
    if (!force && forStates.every((s) => loadedShapes.has(`${s}:${file.name}`))) {
      log(`${file.name} already loaded`);
      continue;
    }
    const count = await loadTigerShapes({ kind: file.kind, name: file.name, bytes: await file.bytes() }, forStates);
    log(`${file.name}: ${count} outlines`);
  }

}
