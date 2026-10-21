/**
 * Every question the engines ask of outlines, answered by PostGIS:
 *   - which outlines lie near a point, whether each holds it, and how far it
 *     is from each one's edge (shapesAround);
 *   - which outlines hold a point just across an edge (shapesHolding).
 * Outlines are found through the GiST index on geometry; distances are
 * measured on the spheroid in metres.
 */
import { sql } from "drizzle-orm";
import { db } from "../db/client.js";

type Point = { lon: number; lat: number };

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
    where s.state = ${state} and st_dwithin(s.geom, p.g, ${padDegrees})`);
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
    where state = ${state} and st_covers(geom, st_setsrid(st_point(${p.lon}, ${p.lat}), 4326))`);
  return new Set(rows.map((r) => `${r.kind}:${r.fips}`));
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
