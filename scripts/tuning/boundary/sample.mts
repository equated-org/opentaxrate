// Points near the lines a map state's rate changes at, for the boundary
// benchmark: a seeded, reproducible sample that leans on where answers are
// hardest, plus a share of points anywhere in the state as a control.
//
//   npx tsx scripts/tuning/boundary/sample.mts STATE N [DATES]
//
// Picks outlines that carry a rate (a city, district or county the state's
// rate table names), and draws points uniformly within BAND metres of their
// lines, so distances to the line are spread evenly from 0 to BAND; a fifth
// of the points are drawn anywhere in the state. Each point is kept only
// inside one of the state's counties. DATES (comma-separated, default
// 2026-10-21) are the sale dates every point is asked on: a past date tests
// the boundaries and rates in force then.
//
// Writes $BOUNDARY_DIR/<STATE>/points.csv (default artifacts/bench/boundary):
// id,state,lon,lat,date,stratum,near_kind,near_fips,near_name,edge_m
// where edge_m is the distance from the point to the nearest line of a
// rated outline as loaded today. The id is the first 16 hex of
// sha256("STATE|lon|lat|date"), coordinates at 6 decimals.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { client, db } from "../../../src/db/client.ts";

const [state, nArg, datesArg] = process.argv.slice(2);
if (!state || !nArg) {
  console.error("usage: sample.mts STATE N [DATES]");
  process.exit(1);
}
const N = Number(nArg);
const dates = (datesArg || "2026-10-21").split(",");
const BAND = Number(process.env.BAND_METRES || 250);
const ROOT = process.env.BOUNDARY_DIR || new URL("../../../artifacts/bench/boundary/", import.meta.url).pathname;
const SEED = `otr-boundary-2026-10-22|${state}`;
const seed = parseInt(createHash("sha256").update(SEED).digest("hex").slice(0, 6), 16);

// Outlines with a rate: any whose kind:fips a rate row's code names, on the
// first date. A district carries its own type; a county 00/rc; a city 01,
// 01x, x or 0c. Held coverage markers have no rate and are left out.
const rated = sql`
  select s.kind, s.fips, s.name, s.geom from sales_tax_shapes s
  where s.state = ${state} and s.fips not like 'held:%'
    and exists (select 1 from sales_tax_jurisdiction_rates r
      where r.state = s.state and ${dates[0]}::date between r.starts_on and r.ends_on
        and (r.code = s.fips or r.code like s.fips || '@%' or r.code like '%>' || s.fips)
        and case s.kind when 'county' then r.type in ('00', 'rc')
                        when 'district' then r.type not in ('45', '00', 'rc', '01', '01x', '0c', 'x')
                        else r.type in ('01', '01x', 'x', '0c', 'kx') end)`;

const edgeN = Math.round(N * 0.8);
// Outlines are drawn at random, two points each, so a state's many small
// districts aren't drowned by its long county lines.
const picked = await db.execute<{ lon: number; lat: number; kind: string; fips: string; name: string }>(sql`
  with o as (select * from (${rated}) r order by md5(r.kind || r.fips || ${SEED}) limit ${Math.ceil(edgeN / 2)}),
  band as (select kind, fips, name,
      st_buffer(st_boundary(geom)::geography, ${BAND})::geometry as g from o)
  select st_x(p.geom) as lon, st_y(p.geom) as lat, kind, fips, name
  from band cross join lateral st_dump(st_generatepoints(band.g, 2, ${seed})) p`);
const [whole] = await db.execute<{ g: string }>(sql`
  select st_astext(st_union(geom)) as g from sales_tax_shapes where state = ${state} and kind = 'county'`);
const control = await db.execute<{ lon: number; lat: number }>(sql`
  select st_x(p.geom) as lon, st_y(p.geom) as lat
  from st_dump(st_generatepoints(st_geomfromtext(${whole.g}, 4326), ${N - edgeN}, ${seed + 1})) p`);

type Row = { lon: number; lat: number; stratum: string; kind: string; fips: string; name: string };
const rows: Row[] = [
  ...picked.map((p) => ({ ...p, stratum: "edge" })),
  ...control.map((p) => ({ ...p, kind: "", fips: "", name: "", stratum: "control" })),
];

// Keep points in one of the state's counties; measure each one's distance
// to the nearest rated line.
const out: string[] = ["id,state,lon,lat,date,stratum,near_kind,near_fips,near_name,edge_m"];
for (const r of rows) {
  const lon = Number(r.lon.toFixed(6)), lat = Number(r.lat.toFixed(6));
  const [m] = await db.execute<{ inside: boolean; kind: string; fips: string; name: string; edge_m: number }>(sql`
    with p as (select st_setsrid(st_point(${lon}, ${lat}), 4326) as g)
    select (select bool_or(st_covers(geom, p.g)) from sales_tax_shapes where state = ${state} and kind = 'county') as inside,
           o.kind, o.fips, o.name, st_distance(st_boundary(o.geom)::geography, p.g::geography) as edge_m
    from p left join lateral (select * from (${rated}) r where st_dwithin(r.geom, p.g, 0.05)
      order by st_distance(st_boundary(r.geom), p.g) limit 1) o on true`);
  if (!m?.inside) continue;
  m.kind ??= ""; m.fips ??= ""; m.name ??= "";
  for (const date of dates) {
    const id = createHash("sha256").update(`${state}|${lon.toFixed(6)}|${lat.toFixed(6)}|${date}`).digest("hex").slice(0, 16);
    const q = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    out.push([id, state, lon.toFixed(6), lat.toFixed(6), date, r.stratum, m.kind, q(m.fips), q(m.name.trim()), Number(m.edge_m).toFixed(1)].join(","));
  }
}
fs.mkdirSync(path.join(ROOT, state), { recursive: true });
fs.writeFileSync(path.join(ROOT, state, "points.csv"), out.join("\n") + "\n");
console.log(`${state}: ${out.length - 1} rows (${(out.length - 1) / dates.length} points × ${dates.length} dates) → ${path.join(ROOT, state, "points.csv")}`);
await client.end();
