# Refresh, loading and tables

Sources: `src/engine/refresh.ts`, `src/engine/load.ts`, `src/engine/downloads.ts`, `src/engine/tiger.ts`, `src/schema.ts` (and `migrations/`)

The refresh job downloads each publisher's newest files and replaces a state's rows. It is the only writer; the API only reads. Run with `opentaxrate refresh [STATE...] [--dir D] [--force]`, which calls `refreshAddressRates({ states, dir, force })`.

## Order (`refreshAddressRates` in `refresh.ts`)

| Step | What | Skipped when |
|---|---|---|
| 1 | Each SST state: `latestSstFiles(dir)`, then `loadSstState` | both file names already in `sales_tax_data_releases` (unless `--force`); or one of the two files is missing (logged) |
| 2 | Missouri: `missouriFiles(dir)`, then `loadSstState` | never; reloaded every run when wanted |
| 3 | Each of `GEO_STATES`: `geo.fetch(dir)`, then `loadGeoState` | never; their sources don't version alike |
| 4 | TIGER outlines for every range and map state: `latestTigerFiles`, then `loadTigerShapes` | every target state already has rows from that file name (unless `--force`) |

An empty state list means every state. `--dir` points at a folder of already-downloaded files, read before the web.

## Downloads (`downloads.ts`)

- `latestSstFiles(dir?)`: lists `streamlinedsalestax.org/ratesandboundry/Rates/` and `/Boundary/` (or `dir`, recursively), parses names like `OHB2026Q4SEP17.zip` with `FILE_NAME`, keeps the newest per state and kind by year, quarter, month and day.
- `sstFileLines(file)`: async lines from a URL or path, unzipping `.zip` while streaming (fflate `Unzip`), so a 400 MB boundary file is never held whole.
- `latestTigerFiles(stateFips, dir?)`: `tl_<year>_us_county` plus `tl_<year>_<fips>_place` and `_cousub` per state, from `www2.census.gov/geo/tiger/TIGER<year>/`. The year is the newest local county zip, else the newest year whose county file answers a `HEAD`.

## Loading (`load.ts`)

### `loadSstState(files: StateFiles)`

One `client.begin` transaction per state:

1. `DELETE` the state's rows from `sales_tax_street_ranges`, `sales_tax_zip_ranges`, `sales_tax_jurisdiction_rates`, `sales_tax_areas`.
2. `COPY sales_tax_jurisdiction_rates` from `parseRateLine`.
3. Stream boundaries through `files.parseBoundary ?? parseBoundaryLine`. Each distinct `county|place|districts` gets an area id `Number(fips) * 1_000_000 + counter`. Street rows `COPY` into `sales_tax_street_ranges` in ~1 MB batches; ZIP rows wait in memory (one connection runs one COPY at a time).
4. `COPY` ZIP ranges, then areas.
5. Upsert both files into `sales_tax_data_releases` on `(state, kind)`.

COPY runs through `pipeline`, so a failure mid-file ends the COPY and rolls the whole state back. `copyLine` escapes backslash, tab, newline and carriage return and writes null as `\N`.

### `loadGeoState(state, data)`

One Drizzle transaction: merge shapes sharing `kind:fips`; delete and re-insert the state's rates (batches of 500); delete the state's non-TIGER shapes (file not like `tl_%`) and insert its own (batches of 20, `geometryOf`); replace its `sales_tax_data_releases` rows. Census outlines are kept.

### `loadTigerShapes(file, states)`

One transaction per TIGER file: delete that `kind`'s TIGER rows (file like `tl_%`) for the states in it, insert the new ones. Every county loads; a place or county subdivision loads only if `namedPlaces` finds it in a rate code or an area's `place`, which leaves out most Census places. So TIGER must load after rates and ranges, as step 4 does.

## TIGER (`tiger.ts`)

`readTigerZip(zip, kind, stateFips)` reads the `.shp` and `.dbf` in a TIGER zip into `Shape { kind, stateFips, fips, name, rings, bbox }`, merging a town split across counties into one shape. `STATE_FIPS` maps every state and DC to its FIPS. `contains(shape, p)` tests a point against in-memory rings (odd ring count), used before shapes are in PostGIS (adapters such as Texas).

## Tables (`schema.ts`)

| Table | Key columns | Filled by |
|---|---|---|
| `sales_tax_data_releases` | `state`, `kind` (`rates` or `boundaries`), `file`, `rows`, `loaded_at`; unique `(state, kind)` | every loader |
| `sales_tax_areas` | `id` (loader-given), `state`, `county`, `place`, `districts` (sorted `type:code` pairs) | `loadSstState` |
| `sales_tax_street_ranges` | `state`, `street_key`, `house_low/high`, `house_text`, `parity`, `unit_low/high`, `city`, `zip5`, `starts_on`, `ends_on`, `area_id`; indexes on `(state, street_key)`, `(state, zip5)` | `loadSstState` |
| `sales_tax_zip_ranges` | `state`, `zip5`, `plus4_low/high`, `kind` (`zip4` or `zip5`), dates, `area_id` | `loadSstState` |
| `sales_tax_jurisdiction_rates` | `state`, `type`, `code`, `rate numeric(8,6)`, `rate_interstate`, `food_drug_rate`, `food_drug_rate_interstate` (Streamlined only, else null), dates | `loadSstState`, `loadGeoState` |
| `sales_tax_shapes` | `state`, `kind` (`county`, `place`, `cousub`, `district`), `fips`, `name`, `geom geometry(MultiPolygon, 4326)` with GiST index, `file`; unique `(state, kind, fips)` | `loadGeoState`, `loadTigerShapes` |

The `file` column on shapes tells the two loaders apart: TIGER files start with `tl_`.

## Invariants

- A lookup never sees half a state: each SST state and each map state is replaced inside one transaction.
- Open-ended rows end on `9999-12-31`; queries test `starts_on <= date <= ends_on`.
- `OPENTAXRATE_HISTORY_FROM` (default `2020-01-01`) drops SST and Missouri rows that ended before it at parse time (`sst-files.ts`). It does not filter map states' rows.
- Changing how street keys are built (`address.ts`) requires `refresh --force` for range states.
- Schema changes go through `pnpm db:generate` into `migrations/`, applied by `opentaxrate migrate`.
