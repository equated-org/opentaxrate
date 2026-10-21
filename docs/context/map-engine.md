# Map engine

Sources: `src/engine/geo-lookup.ts`, `src/engine/shapes.ts`, `src/engine/types.ts`, `src/engine/geo-states/index.ts`, `src/engine/geo-states/tables.ts`, `src/engine/geo-states/sources.ts`, `src/engine/geo-states/*.ts` (one adapter per state)

For states whose local taxes follow county, city and district lines (TX, FL, NY, VA, AZ, NM, IL, SC, CO, AL, LA, AK, PA, HI, MS, ID, the order of `GEO_STATES`). The address is placed on the map (see [geocoding.md](geocoding.md)), PostGIS finds the outlines around it, and each outline's dated rate row is stacked by its type.

## `geoRateAt(state, point, date, street?)`

1. 502 if `sales_tax_data_releases` has nothing for the state; 422 if `point` is null.
2. `shapesAround(state, point, pad)`: pad 0.003 degrees (about 300 m), or 0.06 when the state has any `pj` rows (`hasRows`).
3. Load every rate row live on `date`; key them `type:code`, later `starts_on` winning.
4. Refuse when: no county outline holds the point; the county has a `no` row; outside a rated city but within `PJ_METRES` (4,828 m) of a city with a `pj` row; inside a shape with a `maybe` row.
5. `rateOf(...)` stacks the parts (below). No `45` row on the date is a 422.
6. Edge check (below), then return `{ rate, parts, locationCode, files }`.

## Levy types

Rows are `(type, code)` in `sales_tax_jurisdiction_rates`. `leviesOf(shape, rates)` picks which types a shape can carry: counties `00`, `rc`; places and county subdivisions `01`, `01x`, `x`, `0c`; districts any other type with their code.

| Type | Meaning |
|---|---|
| `45` | state rate |
| `00` | county, county-wide, unless a `01x` city replaces it |
| `01` | city or town, added |
| `01x` | city in place of its county (NY own-rate cities); `city@county` for a county-specific rate (LA towns in two parishes) |
| `0c` | county's rate difference inside one city (AL), may be negative |
| `rc` | county rate only outside every rated city (LA parishes; the code comment also cites NM, whose adapter uses `x` areas instead) |
| `x` | exclusive area (TX city or combined area, IL and NM locations): replaces every other local rate |
| `kx` | code `area>kept`: a jurisdiction an `x` area keeps, at this rate (TX) |
| `addr` | code `area\|house\|streetKey`: one address's rate inside an `x` area (IL business districts) |
| `no` | county refused (AL split counties) |
| `pj` | police jurisdiction reaching 3 miles past a city, no outline (AL) |
| `maybe` | unmapped district inside a city or parish, refused with both rates (LA; also emitted by `alabama.ts` and `ttr.ts`) |
| `need` | `need:x` marker: every address must be in an `x` area, else refused (IL, NM) |
| other | special district, inside its own outline |

Stacking in `rateOf`: if any `x` area holds the point, the smallest by `area` wins; add it (or its `addr` row for this street), then each `kx` row it keeps, and stop. Otherwise add every levy, skipping `00` when a `01x` city holds the point and `rc` when any rated city does; a city's `@county` row wins for that county. A city matched as both place and county subdivision counts once.

`locationCode` is the state code, then each part's code (without `@county`), joined by dashes.

## Edges and margins (`types.ts`, end of `geoRateAt`)

`EDGE_METRES` by geocode accuracy: rooftop 15, parcel 25, point 40, interpolated 75. `marginOf(p)` is `p.metres` when set (geocoders disagreed, see [geocoding.md](geocoding.md)) else `EDGE_METRES[p.accuracy]`.

For every levied shape whose `edgeMetres < margin`: `pointsAcross(point, foot, edgeMetres, 2)` gives a point 2 m past the nearest edge point (four points, one each way, when the address is on the edge); `shapesHolding` finds what holds it; `rateOf` is run for that side. If the rate differs, or the other side has no rate at all, the address is refused naming both rates. Same rate across the line means no refusal.

## Outlines (`shapes.ts`)

| Function | Does |
|---|---|
| `shapesAround(state, p, padDegrees)` | `st_dwithin` on the GiST index; per shape: `inside` (`st_covers`), `edgeMetres` (distance to `st_boundary` on the spheroid), `foot` (`st_closestpoint`), `area` |
| `shapesHolding(state, p)` | `kind:fips` of every shape covering a point |
| `pointsAcross(...)` | flat-earth step past an edge (pure function) |
| `geometryOf(rings)` | SQL that turns rings into one valid multipolygon: polygonize the noded lines, keep faces inside an odd number of rings, dissolve seams, simplify to about 1 m (`SIMPLIFY_DEGREES`) |

Invariant: each outline is stored as one dissolved multipolygon per `(state, kind, fips)`, so seams between pieces are never edges.

## State adapters (`geo-states/`)

Each adapter is a `GeoState { state, fetch(dir?) }` returning `GeoStateData { rates: GeoRateRow[], shapes, files: { rates, boundaries? } }`. Shapes are the state's own outlines (kind `county`, `place` or `district`), keyed by the code their rate rows use. Census counties, places and county subdivisions load separately for every state.

Two ways to write one:

- **`stateTable(state, load)`** (`tables.ts`): `load` returns `{ stateRates, locals, source, skipUnmatchedCities? }`. Each local names its county or city as the state writes it (or by FIPS); `censusCodes` matches names to TIGER FIPS, exact then loose. A name that matches zero or several stops the load (or, with `skipUnmatchedCities`, skips a city with a warning). Used by VA, PA, FL, NY, HI, MS, ID and AL; SC wraps one and adds a Myrtle Beach district outline.
- **A custom `GeoState`** that reads rates and outlines itself, as `texas.ts` (Comptroller rate files and ArcGIS boundary layers), `illinois.ts`, `arizona.ts`, `new-mexico.ts`, `louisiana.ts`, and `ttr.ts` (`colorado`, `alaska` from their lookup service).

Helpers in `sources.ts`: `fetchFile` / `fetchText` (local copy in `dir` first, sends `OPENTAXRATE_USER_AGENT`, 120 s timeout), `readXlsx`, `fetchLayer` (ArcGIS pages to rings), `ringsOf`, `bboxOf`, `isoDay`, `shiftDay`, `excelDay`.

### Adding a state

1. Write `src/engine/geo-states/<state>.ts` exporting a `GeoState`, with `stateTable` if its rates follow Census names or FIPS.
2. Give every row a type from the table above; dates as ISO, open end `9999-12-31`.
3. Add it to `GEO_STATES` in `geo-states/index.ts`. That alone makes `addressRates` route it to the map, lists it in `/v1/coverage`, and makes `refreshAddressRates` load its data and its TIGER outlines.
4. Run `refresh <ST>` and check known addresses with `check --cases`.
5. Update this note and [../state-coverage.html](../state-coverage.html).
