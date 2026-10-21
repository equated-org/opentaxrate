/**
 * How a loader's outline rings become the PostGIS geometry the lookups
 * query (rates/shapes.ts).
 */
import { sql, type SQL } from "drizzle-orm";

/** Simplification tolerance in degrees, about a metre. */
const SIMPLIFY_DEGREES = 0.00001;

/** Rings (outer and holes, in any order) as stored geometry: the area inside
 *  an odd number of rings, with seams between pieces dissolved, simplified.
 *  Odd-count is the rule the rings were always read by, and the only one
 *  that holds for how states publish them: rings that cross or touch
 *  themselves (Texas), and pieces whose edges overlap or repeat (Illinois).
 *  Building areas straight from the rings fails or drops most of a Texas
 *  outline; building them from the noded lines merges repeated edges and
 *  turns holes into land. So the noded lines are cut into faces, and a face
 *  is kept when a point inside it is inside an odd number of rings. */
export function geometryOf(rings: Array<Array<[number, number]>>): SQL {
  const closed = rings.map((r) =>
    r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1] ? r : [...r, r[0]],
  );
  const lines = JSON.stringify({ type: "MultiLineString", coordinates: closed });
  return sql`(
    with l as (select st_setsrid(st_geomfromgeojson(${lines}), 4326) as g),
    ring as (
      select st_makevalid(st_makepolygon(d.geom)) as p
      from l, st_dump(l.g) d where st_npoints(d.geom) >= 4),
    face as (select (st_dump(st_polygonize(st_unaryunion(g)))).geom as f from l)
    select st_multi(st_collectionextract(st_makevalid(st_simplifypreservetopology(
      st_unaryunion(st_collect(f)), ${SIMPLIFY_DEGREES})), 3))
    from face
    where (select count(*) from ring where st_covers(p, st_pointonsurface(f))) % 2 = 1)`;
}
