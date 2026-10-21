/**
 * Brings OpenTaxRate's data up to date, state by state:
 *   1. each Streamlined member's newest rate and boundary files;
 *   2. Missouri's rate and address-range files, in the same layout;
 *   3. each map-read state's rate table and its own outlines;
 *   4. the Census Bureau's newest county, city and town outlines for all of
 *      them.
 * A file already loaded is skipped unless `force`; a map-read state is
 * fetched again every run, since its sources don't name versions alike.
 */
import { db } from "../db.js";
import { salesTaxDataReleases, salesTaxShapes } from "../schema.js";
import { latestSstFiles, latestTigerFiles, sstFileLines } from "./downloads.js";
import { GEO_STATES } from "./geo-states/index.js";
import { loadGeoState, loadSstState, loadTigerShapes } from "./load.js";
import { missouriFiles } from "./missouri.js";
import { RANGE_FIPS } from "./sst-files.js";
import { STATE_FIPS } from "./tiger.js";

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
  const ranges = (counts: { rates: number; areas: number; streets: number; zips: number }) =>
    `${counts.rates} rates, ${counts.areas} areas, ${counts.streets} street ranges, ${counts.zips} ZIP ranges`;

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
    log(`${geo.state}: ${from} → ${counts.rates} rates, ${counts.shapes} outlines in ${seconds(started)}`);
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
