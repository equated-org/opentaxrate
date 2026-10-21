/**
 * Loads one state's Streamlined Sales Tax rate and boundary files into
 * the service's tables, replacing that state's rows in one transaction so a lookup
 * never sees half a release.
 *
 * 1. Delete the state's areas, ranges and rates.
 * 2. Copy in the rates.
 * 3. Stream the boundary file, giving each new area an id, and copy the street
 *    ranges in as they are read, then the ZIP ranges.
 * 4. Insert the areas and record both files as the state's current releases.
 *
 * TIGER outlines load separately, replacing the outlines of one kind for the
 * states in a file, and so do map-read states' rate tables and district
 * outlines.
 */
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { client, db } from "../db.js";
import {
  salesTaxDataReleases,
  salesTaxJurisdictionRates,
  salesTaxShapes,
} from "../schema.js";
import type { GeoStateData } from "./geo-states/index.js";
import { and, eq, inArray, like, notLike, sql } from "drizzle-orm";
import { geometryOf } from "./shapes.js";
import { readTigerZip, STATE_FIPS, type Shape } from "./tiger.js";
import {
  RANGE_FIPS,
  parseBoundaryLine,
  parseRateLine,
  type Area,
  type BoundaryRow,
} from "./sst-files.js";

export interface StateFiles {
  state: string;
  /** Reads a boundary line, for a state whose files differ from the
   *  Streamlined layout (Missouri's). */
  parseBoundary?: (line: string) => BoundaryRow[];
  rates: { name: string; lines: AsyncIterable<string> | Iterable<string> };
  boundaries: { name: string; lines: AsyncIterable<string> | Iterable<string> };
}

/** Stores a map-read state's rates and own outlines in place of its last
 *  ones (see geo-states). Census outlines, loaded apart, are kept. */
export async function loadGeoState(state: string, data: GeoStateData) {
  // A jurisdiction in several pieces may come as several features; it is one
  // outline.
  const merged = new Map<string, GeoStateData["shapes"][number]>();
  for (const s of data.shapes) {
    const key = `${s.kind}:${s.fips}`;
    const known = merged.get(key);
    if (!known) merged.set(key, { ...s, rings: [...s.rings] });
    else {
      known.rings.push(...s.rings);
      known.bbox = [
        Math.min(known.bbox[0], s.bbox[0]),
        Math.min(known.bbox[1], s.bbox[1]),
        Math.max(known.bbox[2], s.bbox[2]),
        Math.max(known.bbox[3], s.bbox[3]),
      ];
    }
  }
  const shapes = [...merged.values()];
  await db.transaction(async (tx) => {
    await tx
      .delete(salesTaxJurisdictionRates)
      .where(eq(salesTaxJurisdictionRates.state, state));
    for (let i = 0; i < data.rates.length; i += 500)
      await tx.insert(salesTaxJurisdictionRates).values(
        data.rates.slice(i, i + 500).map((r) => ({
          state,
          type: r.type,
          code: r.code,
          rate: String(r.rate),
          startsOn: r.startsOn,
          endsOn: r.endsOn,
        })),
      );
    await tx
      .delete(salesTaxShapes)
      .where(and(eq(salesTaxShapes.state, state), notLike(salesTaxShapes.file, "tl\\_%")));
    for (let i = 0; i < shapes.length; i += 20)
      await tx.insert(salesTaxShapes).values(
        shapes.slice(i, i + 20).map((d) => ({
          state,
          kind: d.kind,
          fips: d.fips,
          name: d.name,
          geom: geometryOf(d.rings),
          file: data.files.boundaries ?? data.files.rates,
        })),
      );
    await tx
      .delete(salesTaxDataReleases)
      .where(eq(salesTaxDataReleases.state, state));
    await tx.insert(salesTaxDataReleases).values([
      { state, kind: "rates" as const, file: data.files.rates, rows: data.rates.length },
      ...(data.files.boundaries
        ? [{ state, kind: "boundaries" as const, file: data.files.boundaries, rows: shapes.length }]
        : []),
    ]);
  });
  return { rates: data.rates.length, shapes: shapes.length };
}

/** Loads one TIGER county, place or county subdivision zip's outlines for
 *  the given states. Every county loads; a city or town loads only where a
 *  rate row or an address-range area names it, which leaves out most of the
 *  Census's places. */
export async function loadTigerShapes(
  file: { kind: Shape["kind"]; name: string; bytes: Uint8Array },
  states: string[],
) {
  const fipsToState = new Map(states.map((s) => [STATE_FIPS[s], s]));
  const named = file.kind === "county" ? null : await namedPlaces(states);
  const shapes = readTigerZip(file.bytes, file.kind, new Set(fipsToState.keys())).filter(
    (s) => !named || named.has(`${fipsToState.get(s.stateFips)}:${s.fips}`),
  );
  await db.transaction(async (tx) => {
    await tx
      .delete(salesTaxShapes)
      .where(
        and(
          eq(salesTaxShapes.kind, file.kind),
          like(salesTaxShapes.file, "tl\\_%"),
          inArray(salesTaxShapes.state, [...new Set(shapes.map((s) => fipsToState.get(s.stateFips)!))]),
        ),
      );
    for (let i = 0; i < shapes.length; i += 20)
      await tx.insert(salesTaxShapes).values(
        shapes.slice(i, i + 20).map((s) => ({
          state: fipsToState.get(s.stateFips)!,
          kind: s.kind,
          fips: s.fips,
          name: s.name,
          geom: geometryOf(s.rings),
          file: file.name,
        })),
      );
  });
  return shapes.length;
}

/** "ST:fips" for every city or town a state's rates or areas name. */
async function namedPlaces(states: string[]) {
  const rows = await db.execute<{ state: string; code: string }>(sql`
    select state, split_part(split_part(code, '@', 1), '>', 1) as code
      from sales_tax_jurisdiction_rates where state in ${states}
    union
    select state, place from sales_tax_areas where place is not null and state in ${states}`);
  return new Set(rows.map((r) => `${r.state}:${r.code}`));
}

export async function loadSstState(files: StateFiles) {
  const fips = RANGE_FIPS[files.state];
  if (!fips) throw new Error(`${files.state} has no address-range files`);
  const counts = { rates: 0, streets: 0, zips: 0, areas: 0 };

  await client.begin(async (sql) => {
    for (const table of [
      "sales_tax_street_ranges",
      "sales_tax_zip_ranges",
      "sales_tax_jurisdiction_rates",
      "sales_tax_areas",
    ])
      await sql`DELETE FROM ${sql(table)} WHERE state = ${files.state}`;

    const rateRows = async function* () {
      for await (const line of files.rates.lines) {
        const row = parseRateLine(line);
        if (!row) continue;
        counts.rates++;
        yield copyLine([
          files.state,
          row.type,
          row.code,
          row.rate,
          row.startsOn,
          row.endsOn,
        ]);
      }
    };
    await copy(
      await sql`COPY sales_tax_jurisdiction_rates (state, type, code, rate, starts_on, ends_on) FROM STDIN`.writable(),
      rateRows(),
    );

    const areaIds = new Map<string, number>();
    const areaOf = (area: Area) => {
      const key = `${area.county ?? ""}|${area.place ?? ""}|${area.districts}`;
      let id = areaIds.get(key);
      if (id === undefined) {
        id = Number(fips) * 1_000_000 + areaIds.size + 1;
        areaIds.set(key, id);
      }
      return id;
    };

    // One connection runs one COPY at a time, so the ZIP rows wait in memory
    // (under a million even for the largest state) while streets stream.
    // Streaming through pipeline means a failure mid-file ends the COPY and
    // rolls the state back, rather than leaving the COPY open.
    const zips: string[] = [];
    const streetRows = async function* () {
      let batch = "";
      for await (const line of files.boundaries.lines) {
        for (const row of (files.parseBoundary ?? parseBoundaryLine)(line)) {
          const areaId = areaOf(row.area);
          if (row.kind === "street") {
            counts.streets++;
            batch += streetLine(files.state, row, areaId);
          } else {
            counts.zips++;
            zips.push(
              copyLine([
                files.state,
                row.zip5,
                row.plus4Low,
                row.plus4High,
                row.kind,
                row.startsOn,
                row.endsOn,
                areaId,
              ]),
            );
          }
        }
        if (batch.length > 1_000_000) {
          yield batch;
          batch = "";
        }
      }
      if (batch) yield batch;
    };
    await copy(
      await sql`COPY sales_tax_street_ranges (state, street_key, street, pre_directional, suffix, post_directional, house_low, house_high, house_text, parity, unit_low, unit_high, city, zip5, plus4, starts_on, ends_on, area_id) FROM STDIN`.writable(),
      streetRows(),
    );
    await copy(
      await sql`COPY sales_tax_zip_ranges (state, zip5, plus4_low, plus4_high, kind, starts_on, ends_on, area_id) FROM STDIN`.writable(),
      zips,
    );

    const areas = [...areaIds].map(([key, id]) => {
      const [county, place, districts] = key.split("|");
      return copyLine([
        id,
        files.state,
        county || null,
        place || null,
        districts,
      ]);
    });
    counts.areas = areas.length;
    await copy(
      await sql`COPY sales_tax_areas (id, state, county, place, districts) FROM STDIN`.writable(),
      areas,
    );

    for (const [kind, name, rows] of [
      ["rates", files.rates.name, counts.rates],
      ["boundaries", files.boundaries.name, counts.streets + counts.zips],
    ] as const)
      await sql`
        INSERT INTO sales_tax_data_releases (state, kind, file, rows)
        VALUES (${files.state}, ${kind}, ${name}, ${rows})
        ON CONFLICT (state, kind) DO UPDATE
        SET file = EXCLUDED.file, rows = EXCLUDED.rows, loaded_at = now()`;
  });
  return counts;
}

function streetLine(
  state: string,
  row: Extract<BoundaryRow, { kind: "street" }>,
  areaId: number,
) {
  return copyLine([
    state,
    row.streetKey,
    row.street,
    row.preDirectional,
    row.suffix,
    row.postDirectional,
    row.houseLow,
    row.houseHigh,
    row.houseText,
    row.parity,
    row.unitLow,
    row.unitHigh,
    row.city,
    row.zip5,
    row.plus4,
    row.startsOn,
    row.endsOn,
    areaId,
  ]);
}

/** One row in COPY's text format. */
function copyLine(values: Array<string | number | null>) {
  return (
    values
      .map((v) =>
        v === null
          ? "\\N"
          : String(v).replace(/[\\\t\n\r]/g, (ch) =>
              ch === "\\" ? "\\\\" : ch === "\t" ? "\\t" : ch === "\n" ? "\\n" : "\\r",
            ),
      )
      .join("\t") + "\n"
  );
}

async function copy(
  stream: NodeJS.WritableStream,
  lines: AsyncIterable<string> | Iterable<string>,
) {
  await pipeline(Readable.from(lines), stream);
}

