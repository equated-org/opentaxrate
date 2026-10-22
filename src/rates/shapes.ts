/**
 * Every question the engines ask of outlines, answered by PostGIS:
 *   - which outlines lie near a point, whether each holds it, and how far it
 *     is from each one's edge (shapesAround);
 *   - which outlines hold a point just across an edge (shapesHolding);
 *   - what an outline looks like near a point, for drawing (outlineGeometry).
 * Outlines are found through the GiST index on geometry; distances are
 * measured on the spheroid in metres.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";
import type { OutlineGeometry } from "./types.js";

type Point = { lon: number; lat: number };

/** A supplemental tax-area feature that ingestion found but couldn't verify
 *  is kept as a coverage marker: "held:<source>:<feature>:<from>", with no
 *  area. It says only that a tax here needs verification; it never carries
 *  a rate, and it outranks verified outlines it overlaps. */
export const HELD_PREFIX = "held:";
export const heldFips = (source: string, feature: string, from: string) => `${HELD_PREFIX}${source}:${feature}:${from}`;
export const isHeld = (fips: string) => fips.startsWith(HELD_PREFIX);

export interface PlacedShape {
  kind: "county" | "place" | "cousub" | "district";
  fips: string;
  name: string;
  /** Square degrees, only for ordering a nested outline before its outer one. */
  area: number;
  inside: boolean;
  /** Metres from the point to the outline's nearest edge. */
  edgeMetres: number;
  /** The nearest point on that edge. */
  foot: Point;
}

/** The outlines whose geometry comes within `padDegrees` of the point. */
export async function shapesAround(state: string, p: Point, padDegrees: number): Promise<PlacedShape[]> {
  const rows = await db.execute<{
    kind: PlacedShape["kind"];
    fips: string;
    name: string;
    area: number;
    inside: boolean;
    edge_m: number;
    foot_lon: number;
    foot_lat: number;
  }>(sql`
    with p as (select st_setsrid(st_point(${p.lon}, ${p.lat}), 4326) as g)
    select s.kind, s.fips, s.name, st_area(s.geom) as area,
           st_covers(s.geom, p.g) as inside,
           st_distance(b.edge::geography, p.g::geography) as edge_m,
           st_x(b.foot) as foot_lon, st_y(b.foot) as foot_lat
    from sales_tax_shapes s
    cross join p
    cross join lateral (
      select st_boundary(s.geom) as edge,
             st_closestpoint(st_boundary(s.geom), p.g) as foot
    ) b
    where s.state = ${state} and s.fips not like ${`${HELD_PREFIX}%`} and st_dwithin(s.geom, p.g, ${padDegrees})`);
  return rows.map((r) => ({
    kind: r.kind,
    fips: r.fips,
    name: r.name,
    area: Number(r.area),
    inside: r.inside,
    edgeMetres: Number(r.edge_m),
    foot: { lon: Number(r.foot_lon), lat: Number(r.foot_lat) },
  }));
}

/** The outlines holding a point, as "kind:fips". */
export async function shapesHolding(state: string, p: Point): Promise<Set<string>> {
  const rows = await db.execute<{ kind: string; fips: string }>(sql`
    select kind, fips from sales_tax_shapes
    where state = ${state} and fips not like ${`${HELD_PREFIX}%`}
      and st_covers(geom, st_setsrid(st_point(${p.lon}, ${p.lat}), 4326))`);
  return new Set(rows.map((r) => `${r.kind}:${r.fips}`));
}

/** Display tolerance in degrees, about 5 m for a 3 km square, coarser in
 *  step with a wider one so the response stays small. */
const DISPLAY_SIMPLIFY_DEGREES = 0.00005;

/** Each outline's part within a square `metres` from the point on every
 *  side, simplified to about 5 m, as GeoJSON with 5 decimals; keyed
 *  "kind:fips". An outline with nothing in the square is left out. For
 *  display only: no engine reads it. */
export async function outlineGeometry(
  state: string,
  outlines: Array<{ kind: string; fips: string }>,
  p: Point,
  metres: number,
): Promise<Map<string, OutlineGeometry>> {
  if (!outlines.length) return new Map();
  const keys = outlines.map((o) => `${o.kind}:${o.fips}`);
  const rows = await db.execute<{ kind: string; fips: string; geojson: string }>(sql`
    with box as (
      select st_envelope(st_buffer(st_setsrid(st_point(${p.lon}, ${p.lat}), 4326)::geography, ${metres})::geometry) as g)
    select s.kind, s.fips, st_asgeojson(c.g, 5) as geojson
    from sales_tax_shapes s
    cross join box
    cross join lateral (
      select st_collectionextract(st_makevalid(st_simplifypreservetopology(
        st_intersection(s.geom, box.g), ${DISPLAY_SIMPLIFY_DEGREES * Math.max(1, metres / 3_000)})), 3) as g) c
    where s.state = ${state}
      and s.kind || ':' || s.fips in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
      and s.geom && box.g
      and not st_isempty(c.g)`);
  return new Map(rows.map((r) => [`${r.kind}:${r.fips}`, JSON.parse(r.geojson) as OutlineGeometry]));
}

/** Points `metres` past an edge from `p`, on its other side. On the edge
 *  itself, which way is across isn't known, so all four directions. */
export function pointsAcross(p: Point, foot: Point, edgeMetres: number, metres: number): Point[] {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110_540;
  const dx = (foot.lon - p.lon) * kx;
  const dy = (foot.lat - p.lat) * ky;
  const length = Math.hypot(dx, dy);
  const step = (ux: number, uy: number, from: Point) => ({
    lon: from.lon + (ux * metres) / kx,
    lat: from.lat + (uy * metres) / ky,
  });
  if (edgeMetres > 0.01 && length > 0) return [step(dx / length, dy / length, foot)];
  return [step(1, 0, p), step(-1, 0, p), step(0, 1, p), step(0, -1, p)];
}
