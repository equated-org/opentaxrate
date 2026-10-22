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
import { client, db } from "../db/client.js";
import {
  salesTaxDataReleases,
  salesTaxJurisdictionRates,
  salesTaxJurisdictions,
} from "../db/schema.js";
import type { GeoStateData, JurisdictionRow } from "./states/index.js";
import { eq, sql } from "drizzle-orm";
import { geometryOf } from "./geometry.js";
import { RANGE_FIPS, STATE_FIPS } from "../coverage.js";
import { readTigerZip, type Shape } from "./tiger.js";
import {
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
  /** `firstListed`: where the file lists only the ranges in force on its
   *  edition and after (Missouri's, which drops every row that ended), that
   *  edition's first day; before it, a ZIP's or street's rows are missing
   *  the ones that ended. Unset where the file keeps its history. */
  boundaries: { name: string; lines: AsyncIterable<string> | Iterable<string>; firstListed?: string };
  /** Names and ids for the rates' codes, where the state's files give them
   *  (Missouri's rate workbook); the Streamlined files give none. Read
   *  after the rate lines, so a source may gather them while they stream. */
  jurisdictions?: () => JurisdictionRow[];
}

/** Stores a map-read state's rates and own outlines in place of its last
 *  ones (see ingest/states). Census outlines, loaded apart, are kept. */
export async function loadGeoState(state: string, data: GeoStateData) {
  // A jurisdiction in several pieces may come as several features; it is one
  // outline.
  const merged = new Map<string, GeoStateData["shapes"][number]>();
  for (const s of data.shapes) {
    const key = `${s.kind}:${s.fips}:${s.startsOn ?? ""}`;
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
    await tx.delete(salesTaxJurisdictions).where(eq(salesTaxJurisdictions.state, state));
    for (let i = 0; i < data.jurisdictions.length; i += 500)
      await tx.insert(salesTaxJurisdictions).values(
        data.jurisdictions.slice(i, i + 500).map((j) => ({ state, ...j, file: data.files.rates })),
      );
    const file = data.files.boundaries ?? data.files.rates;
    if (shapes.some((d) => d.startsOn || d.endsOn)) {
      // The source's own dated history replaces what was loaded.
      await tx.execute(sql`delete from sales_tax_shapes s where s.state = ${state} and s.file not like 'tl\\_%'`);
      for (let i = 0; i < shapes.length; i += 20)
        await tx.execute(sql`insert into sales_tax_shapes (state, kind, fips, name, geom, file, starts_on, ends_on) values ${sql.join(
          shapes.slice(i, i + 20).map((d) => sql`(${state}, ${d.kind}, ${d.fips}, ${d.name}, ${geometryOf(d.rings)}, ${file},
            ${d.startsOn ?? "0001-01-01"}, ${d.endsOn ?? "9999-12-31"})`),
          sql`, `,
        )}`);
    } else
      await writeEdition(
        tx,
        sql`s.state = ${state} and s.file not like 'tl\\_%'`,
        shapes.map((d) => ({ state, kind: d.kind, fips: d.fips, name: d.name, rings: d.rings, file })),
        data.boundariesFrom ?? today(),
      );
    await tx
      .delete(salesTaxDataReleases)
      .where(eq(salesTaxDataReleases.state, state));
    await tx.insert(salesTaxDataReleases).values([
      { state, kind: "rates" as const, file: data.files.rates, rows: data.rates.length, firstListed: data.ratesFirstListed ?? null },
      ...(data.files.boundaries
        ? [{ state, kind: "boundaries" as const, file: data.files.boundaries, rows: shapes.length }]
        : []),
    ]);
  });
  return { rates: data.rates.length, jurisdictions: data.jurisdictions.length, shapes: shapes.length };
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
  // A TIGER year's outlines are the legal boundaries on January 1 of it.
  const year = /^tl_(\d{4})_/.exec(file.name)?.[1];
  // A file with none of the states' outlines (no rated places) touches none.
  if (!shapes.length) return 0;
  await db.transaction(async (tx) => {
    await writeEdition(
      tx,
      sql`s.kind = ${file.kind} and s.file like 'tl\\_%' and s.state in ${[...new Set(shapes.map((s) => fipsToState.get(s.stateFips)!))]}`,
      shapes.map((s) => ({ state: fipsToState.get(s.stateFips)!, kind: s.kind, fips: s.fips, name: s.name, rings: s.rings, file: file.name })),
      year ? `${year}-01-01` : today(),
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
  const counts = { rates: 0, jurisdictions: 0, streets: 0, zips: 0, areas: 0 };

  await client.begin(async (sql) => {
    for (const table of [
      "sales_tax_street_ranges",
      "sales_tax_zip_ranges",
      "sales_tax_jurisdiction_rates",
      "sales_tax_jurisdictions",
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
          row.rateInterstate,
          row.foodDrugRate,
          row.foodDrugRateInterstate,
          row.startsOn,
          row.endsOn,
        ]);
      }
    };
    await copy(
      await sql`COPY sales_tax_jurisdiction_rates (state, type, code, rate, rate_interstate, food_drug_rate, food_drug_rate_interstate, starts_on, ends_on) FROM STDIN`.writable(),
      rateRows(),
    );
    const jurisdictions = files.jurisdictions?.() ?? [];
    counts.jurisdictions = jurisdictions.length;
    for (let i = 0; i < jurisdictions.length; i += 500)
      await sql`
        INSERT INTO sales_tax_jurisdictions (state, type, code, name, ids, file)
        SELECT ${files.state}, j.type, j.code, j.name, j.ids, ${files.rates.name}
          FROM jsonb_to_recordset(${JSON.stringify(jurisdictions.slice(i, i + 500))}::jsonb)
            AS j(type text, code text, name text, ids jsonb)`;

    const areaIds = new Map<string, number>();
    const areaOf = (area: Area) => {
      const key = `${area.county ?? ""}|${area.place ?? ""}|${area.districts}|${JSON.stringify(area.ids)}`;
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
      // The ids' JSON comes last, so a "|" inside it stays in it.
      const [county, place, districts, ...ids] = key.split("|");
      return copyLine([id, files.state, county || null, place || null, districts, ids.join("|")]);
    });
    counts.areas = areas.length;
    await copy(
      await sql`COPY sales_tax_areas (id, state, county, place, districts, ids) FROM STDIN`.writable(),
      areas,
    );

    for (const [kind, name, rows, firstListed] of [
      ["rates", files.rates.name, counts.rates, null],
      ["boundaries", files.boundaries.name, counts.streets + counts.zips, files.boundaries.firstListed ?? null],
    ] as const)
      await sql`
        INSERT INTO sales_tax_data_releases (state, kind, file, rows, first_listed)
        VALUES (${files.state}, ${kind}, ${name}, ${rows}, ${firstListed})
        ON CONFLICT (state, kind) DO UPDATE
        SET file = EXCLUDED.file, rows = EXCLUDED.rows, first_listed = EXCLUDED.first_listed, loaded_at = now()`;
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


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Writes one edition of a set of outlines, keeping the ones it replaces as
 * history: `scope` selects (as `s`) the rows an edition of this source
 * replaces, and `from` is the first date the edition's lines are in force.
 *   - An outline with the same geometry as its open row keeps that row.
 *   - An open row the edition changes or leaves out ends the day before
 *     `from`, or is deleted when it starts on or after `from` (the same
 *     edition loaded again).
 *   - A changed or new outline starts on `from`; on the scope's first
 *     edition, every outline stands for every earlier date as well, which
 *     the lookups refuse where the rates say otherwise (rates/map.ts).
 * Lookups read the row in force on their date (rates/shapes.ts).
 */
async function writeEdition(
  tx: Tx,
  scope: ReturnType<typeof sql>,
  shapes: Array<{ state: string; kind: string; fips: string; name: string; rings: Shape["rings"]; file: string }>,
  from: string,
) {
  const [{ first }] = await tx.execute<{ first: boolean }>(sql`select not exists (select 1 from sales_tax_shapes s where ${scope}) as first`);
  await tx.execute(sql`create temp table edition (state text, kind text, fips text, name text,
    geom geometry(MultiPolygon, 4326), file text, same boolean not null default false) on commit drop`);
  for (let i = 0; i < shapes.length; i += 20)
    await tx.execute(sql`insert into edition (state, kind, fips, name, geom, file) values ${sql.join(
      shapes.slice(i, i + 20).map((d) => sql`(${d.state}, ${d.kind}, ${d.fips}, ${d.name}, ${geometryOf(d.rings)}, ${d.file})`),
      sql`, `,
    )}`);
  const open = sql`s.ends_on = '9999-12-31' and s.state = e.state and s.kind = e.kind and s.fips = e.fips`;
  await tx.execute(sql`update edition e set same = true from sales_tax_shapes s
    where ${scope} and ${open} and st_orderingequals(s.geom, e.geom)`);
  await tx.execute(sql`update sales_tax_shapes s set name = e.name, file = e.file from edition e
    where ${scope} and ${open} and e.same`);
  const replaced = sql`${scope} and s.ends_on = '9999-12-31'
    and not exists (select 1 from edition e where ${open} and e.same)`;
  await tx.execute(sql`delete from sales_tax_shapes s where ${replaced} and s.starts_on >= ${from}`);
  await tx.execute(sql`update sales_tax_shapes s set ends_on = ${from}::date - 1 where ${replaced}`);
  await tx.execute(sql`insert into sales_tax_shapes (state, kind, fips, name, geom, file, starts_on)
    select state, kind, fips, name, geom, file, ${first ? "0001-01-01" : from}::date from edition where not same`);
  await tx.execute(sql`drop table edition`);
}
