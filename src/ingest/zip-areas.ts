/**
 * The Census Bureau's ZIP areas, loaded for the ZIPs that reach into a
 * map-read state. Only areas whose bounding box meets one of those states'
 * county outlines are built at all; of those, the ones touching a county
 * outline are kept. So every one of those states' county outlines must be
 * loaded first (refresh.ts checks). A ZIP area crossing a state line is kept
 * once, whole.
 */
import { sql } from "drizzle-orm";
import { unzipSync } from "fflate";
import { db } from "../db/client.js";
import { zipAreas } from "../db/schema.js";
import { geometryOf } from "./geometry.js";
import { readDbf, readPolygons } from "./tiger.js";

export async function loadZipAreas(file: { name: string; bytes: Uint8Array }, states: string[]) {
  const files = unzipSync(file.bytes, { filter: (f) => /\.(shp|dbf)$/i.test(f.name) });
  const shp = Object.entries(files).find(([n]) => /\.shp$/i.test(n))?.[1];
  const dbf = Object.entries(files).find(([n]) => /\.dbf$/i.test(n))?.[1];
  if (!shp || !dbf) throw new Error(`${file.name} has no shapefile`);
  const boxes = await db.execute<{ x0: number; y0: number; x1: number; y1: number }>(sql`
    select st_xmin(b) as x0, st_ymin(b) as y0, st_xmax(b) as x1, st_ymax(b) as y1
    from (select st_extent(geom)::geometry as b from sales_tax_shapes
          where kind = 'county' and state in ${states} group by state) e`);
  const near = (rings: Array<Array<[number, number]>>) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of rings)
      for (const [x, y] of ring) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    return boxes.some((b) => x0 <= b.x1 && x1 >= b.x0 && y0 <= b.y1 && y1 >= b.y0);
  };
  const records = readDbf(dbf);
  const polygons = readPolygons(shp);
  const areas = records.flatMap((r, i) => {
    const rings = polygons[i];
    const zip5 = r.ZCTA5CE20;
    return rings?.length && /^\d{5}$/.test(zip5) && near(rings) ? [{ zip5, rings }] : [];
  });
  return db.transaction(async (tx) => {
    await tx.delete(zipAreas);
    for (let i = 0; i < areas.length; i += 50)
      await tx.insert(zipAreas).values(
        areas.slice(i, i + 50).map((a) => ({ zip5: a.zip5, geom: geometryOf(a.rings), file: file.name })),
      );
    await tx.execute(sql`
      delete from zip_areas z where not exists (
        select 1 from sales_tax_shapes s
        where s.kind = 'county' and s.state in ${states} and st_intersects(s.geom, z.geom))`);
    const [{ kept }] = await tx.execute<{ kept: number }>(sql`select count(*)::int as kept from zip_areas`);
    return kept;
  });
}

/** The states among `states` with no ZIP area touching their counties: a
 *  state added to the map-read ones since the areas were loaded. */
export async function statesWithoutZipAreas(states: string[]) {
  const without: string[] = [];
  for (const state of states) {
    const [row] = await db.execute<{ covered: boolean }>(sql`
      select exists (select 1 from sales_tax_shapes s join zip_areas z on st_intersects(s.geom, z.geom)
        where s.state = ${state} and s.kind = 'county') as covered`);
    if (!row?.covered) without.push(state);
  }
  return without;
}
