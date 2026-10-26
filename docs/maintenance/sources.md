# Tax data sources

[← Maintenance](cron.md)

OpenTaxRate combines published tax rates with address ranges and geographic boundaries to determine where they apply.

## Source overview

| Role | Published by / used for | Limits to check |
|---|---|---|
| Rates | State tax agencies, Streamlined Sales Tax, and designated services; general rates and effective dates | Edition, tax type, effective period, and local exceptions |
| Tax boundaries and address ranges | State/local tax agencies and designated publishers; matching an address or point to tax areas | Missing streets, districts, conflicting placements, and dated boundary coverage |
| Reference geography | [Census TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html); county, place, town, ZIP-area outlines and street names | Administrative boundaries are not necessarily tax boundaries; ZIP areas do not establish a single tax rate |
| Address placement | Configured geocoders; coordinates and address matching | Precision, conflicting placements, provider availability and [terms](../configuration.md#geocoding) |
| Validation labels | Official state services or published tables; expected benchmark answers | Query date, supported sale dates, and shared sources with ingestion |

A response's `source` names the data used; `match` describes the lookup method. See [state coverage](../state-coverage.html) for publisher links and gaps, and `GET /v1/coverage` for a running instance's loaded sources.[^evidence]

[^evidence]: `include=trace` adds lookup details. A settled total can have an uncertain jurisdiction breakdown; inspect `jurisdictions` and `alternatives`. Source archives retain fetch dates, URLs and SHA-256 hashes separately from database snapshots; see [data maintenance](../data.md#raw-sources-and-backups). Past rates do not imply past boundaries; see [history sources](#history-sources).

## Where sources are declared

| Kind | Declared in | Loaded by |
|---|---|---|
| Streamlined members' rate and boundary files | `latestSstFiles` in `src/ingest/downloads.ts` (streamlinedsalestax.org listing) | `loadSstState` |
| Missouri's quarterly rate and boundary files, with the archive | `src/ingest/missouri.ts` | `loadSstState` |
| Map states' rates and outlines | one adapter each in `src/ingest/states/` (`GEO_STATES`) | `loadGeoState` |
| Hand-kept rate tables (FL, HI, ID, MS, NY, PA, MT, SC, VA) | the adapter's table and `publications` in `src/ingest/states/` | `loadGeoState` |
| Canada's provinces and territories: GST/HST, PST, QST, RST from April 1, 2013 | `FEDERAL` and `PROVINCIAL` in `src/rates/canada.ts`, sources in its header | none: read at request time, no ingestion |
| Census county, place and town outlines; ZIP areas; street names | `latestTigerFiles` and friends in `src/ingest/downloads.ts` | `loadTigerShapes`, `zip-areas.ts`, `street-names.ts` |
| Tax-area polygons checked against the rates (CA, MN, WA, NE, SD, VT, IA…) | `SUPPLEMENTAL_POLYGONS` in `src/ingest/supplemental-sources.ts`, plus `washingtonSources` and `minnesotaSources` | `refreshSupplemental`, `indexVerifiedPolygons` |
| Range states' own tax polygons (UT, MO) | `src/range-polygon-sources.ts` | `loadRangePolygons` |
| Sources found but not loaded, and why | `SOURCE_ACQUISITION_GAPS` in `src/ingest/supplemental-sources.ts` | none |
| Official answers used to check the data | the labellers in `artifacts/bench/oracles` and `artifacts/bench/reference` (see [bench-refresh.md](bench-refresh.md)) | the bench |

Every input a refresh reads is archived under `artifacts/sources/`
(see [data maintenance](../data.md#raw-sources-and-backups)).

## Watch list

What to check for a new edition, and when it usually appears.

| Source | New edition | Where to look |
|---|---|---|
| Streamlined rate and boundary files (24 states) | quarterly, about two months before the quarter | the listing at streamlinedsalestax.org/ratesandboundry; `latestSstFiles` picks the newest per state |
| Missouri DOR rates and boundaries | quarterly, before the quarter | dor.mo.gov sales/use documents; old quarters move to `archived-reports` |
| Texas Comptroller EDI rates, city rate sheet, SPD list, boundaries | quarterly | comptroller.texas.gov rate files; the `Sales_Tax_Boundaries` service names its quarter |
| Colorado and Alaska rate services | as jurisdictions change; dated | salestaxlookup.colorado.gov, alaska.atr.avalara.com (read whole each refresh) |
| Minnesota tax areas | quarterly layer `locgnrl_sales_usetax_areas_<YYYYQn>` | the services9.arcgis.com listing (`MN_SERVICES`) |
| Washington location codes | quarterly ZIPs | dor.wa.gov sales tax jurisdiction boundaries page |
| California tax areas | quarterly | CDTFA's `CA_SalesandUsetaxRates_2017toPresent` service (`DateStamp`) |
| Arizona, New Mexico, Illinois, Louisiana (East Baton Rouge) | monthly to semiannual | the adapter's URLs |
| Florida DR-15DSS, New York Pub 718, Virginia's rates by locality | yearly or on change | the adapter's `publications` |
| Hawaii, Idaho, Mississippi, Pennsylvania, Montana, South Carolina ST-500 | on change | the adapter's source page |
| Census TIGER | yearly (outlines as of January 1) | www2.census.gov/geo/tiger/TIGER<year> |
| Canada's GST/HST and provincial PST, QST and RST rates | on change, announced in federal and provincial budgets | the CRA's GST/HST rate page and each province's tax site, cited in `src/rates/canada.ts` |

A change announced for a future date belongs in the data as soon as it is
published: rows carry their own dates.

## History sources

Past editions can provide the lines and rates in force on a requested date, where loaded. Some states have past rates but only current outlines (see the [map engine](../context/map-engine.html#history)).

| State | Past outlines | Past rates |
|---|---|---|
| CO, AK | the rate service, by date (bisected to the day) | the rate service, from 2024 |
| MN | quarterly layers from 2018Q3 (some quarters missing) | Streamlined files |
| WA | quarterly ZIPs from 2018 | Streamlined files |
| MO | none (the boundary file keeps only current rows) | archived quarterly files from 2023Q3 |
| TX | none (only the current quarter is published) | EDI files from 2022Q3; districts outside cities only from the current quarter |
| CA | quarterly geometries from 2017 in CDTFA's history service (only the newest is loaded) | the same |
| Census | TIGER years (only the newest is loaded) | — |

Candidates not loaded yet: California's older quarters; past TIGER years;
the Census Boundary and Annexation Survey's change files (effective dates
of annexations, without shapes).

## Official answers for checking

The benchmark's labels come from each state's own service, asked by the
refresh's labellers ([bench-refresh.md](bench-refresh.md)); at a point: Texas's Comptroller GIS API (by quarter; needs `TX_CPA_CLIENT_ID` and
`TX_CPA_CLIENT_SECRET`), Colorado's and Alaska's services (by date),
Missouri's DOR lookup (by date), Nebraska's and South Dakota's rate layers
(by their records' dates), Wisconsin's lookup (by address and date),
Arizona's, Virginia's and South Carolina's (today only). Washington's
address API ignores dates.

Ingestion and validation can share an official source. See [benchmark methodology](../benchmarks.md#scoring-and-limits) for dependencies and scoring exceptions.

## Adding a source

1. It must be official: the state's, or its designated agent's, published
   file, layer or service. Note its license or terms.
2. Decide its role: rates, outlines that carry rates, outlines checked
   against rates (a supplemental tax area), or validation only.
3. Load it the way its kind is loaded (table above), with its edition's
   dates; a source that dates its outlines gives its history
   (`GeoStateData.shapes[].startsOn`). Archive what it reads.
4. Add tests with a fixture, update the subsystem note and
   [state coverage](../state-coverage.html), and benchmark before and after.
5. A source found but not loadable goes in `SOURCE_ACQUISITION_GAPS` with
   the reason.
