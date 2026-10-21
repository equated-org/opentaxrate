# Geocoding

Sources: `src/geocoding/types.ts`, `locator.ts`, `registry.ts`, `agreement.ts`, `cache.ts`, `budget.ts`, `providers/`, `src/lookup.ts`, `src/rates/map.ts`, `src/rates/ranges.ts`.

## Wiring and stages

`lookUpRate()` creates one lazy locator per request. The rate engines use it only when published street/ZIP data or statewide rates cannot settle the lookup. `Locate` returns `{ lon, lat, accuracy, metres?, placedBy? }` or null. `index.ts` re-exports the contracts; it no longer implements an all-provider fanout.

1. Read permitted cached results for every enabled provider. Cache keys include the full address identity (state, city, complete street including house letters/fractions, directions, suffix, unit and ZIP), a normalization version, and a fingerprint of provider credentials/endpoint and storage mode. Conservative spelling aliases share rows; fuzzy street-range keys are never used as address identity.
2. If cached points do not agree, ask a cheap pair, preferring different potential datasets. Census is enabled unless `CENSUS_DISABLED=true`; every other provider requires its key/URL. Photon is the OSM provider. Nominatim is not registered and no public OSM endpoint is used. Further providers are asked in cost order only until agreement is established or the enabled list is exhausted.
3. Collapse repeated dataset results to one representative, widening its margin to their spread. Contradictory results from one dataset remove that dataset. Unknown provenance supplies no independent vote. Enumerate pairwise-compatible groups (not transitive chains): every pair must be within the coarser margin and no more than 250 m apart. Select the unique largest group; tied groups refuse. The most precise representative supplies the point, with its margin widened to accepted spread.
4. One dataset alone is accepted only if its points agree and its placement is inside a loaded outline whose name matches the typed city. No city/outline means refusal. Conflicting independent sources cannot fall back to a single.
5. A deciding boundary lets the engine call `locate({ marginUnder })` once. This distance is advisory: candidates qualify by whether they can improve the current placement, not whether their margin beats the old edge distance. A more precise point must remain within the previous placement's margin and compatible with every accepted representative. Its own margin replaces the coarse margin; provider provenance is retained. All outlines and rates are recomputed at the new point, which can move across the original line. A still-ambiguous point is refused.

Initial and refinement calls are memoized separately. Concurrent matching requests in one process share in-flight provider work; non-storable results are discarded when those requests finish.

## Providers and validation

The registry supports Census, Photon, Pelias, Geocodio, Smarty, Mapbox, HERE, Esri and Google. Disabled providers are never called. Exact/high-confidence address matches only: street/city centroids and ambiguous candidates are refused. Vendor adapters validate returned address components and normalize accuracy labels. Photon accepts house-level points only and requires matching house number, street, directions, suffix, state, city and supplied ZIP. Nearby duplicate OSM features are allowed within 50 m, with their spread preserved; distant ones refuse.

Pelias records use their returned dataset (`osm` or `openaddresses`). Geocodio TIGER/OSM/OpenAddresses/local-government attribution is distinguished when recognized; otherwise provenance is unknown. The registry's vendor identities describe the plan's independence assumptions, not a guarantee that proprietary vendors never share upstream data.

## Storage and quotas

Migration `0004_geocoding.sql` adds runtime tables `geocode_results` and `geocoder_usage`. Refresh never reads or replaces them. Storable points expire after a year; confirmed negative results after 30 days. HTTP errors, timeouts, malformed responses, budget skips and breaker skips are not negative results and are never cached.

Census, Photon, Pelias and Geocodio results can be cached. Mapbox needs `MAPBOX_PERMANENT=true` (request includes `permanent=true`); Esri needs `ARCGIS_FOR_STORAGE=true` (request includes `forStorage=true`). Google, HERE and Smarty are non-storable. Storage permissions also apply to negative results.

Before any provider request, a single Postgres upsert reserves a daily call and its next allowed request time. Caps and request spacing are shared by all containers using that provider credential/endpoint fingerprint. Slots are never refunded after timeouts because a vendor may have billed the call. Missing tables, read-only permissions and database errors skip the provider; quotas are never replaced by an uncapped in-memory fallback. Geocodio standardization reserves from the same budget. Separate applications sharing the credentials are outside this counter.

`<ID>_DAILY_CAP`, `<ID>_RATE_PER_SECOND` and `<ID>_COST_PER_CALL` configure limits/order (`ARCGIS_` for Esri). Defaults are application budgets, not current vendor free-tier claims. Rate spacing has no queue: unavailable providers are skipped. Daily dates use UTC. Keep configuration consistent across replicas. A process-local breaker opens for 60 seconds after five errors or one HTTP 429, then admits one trial request. Success closes it; failure reopens it.

`OPENTAXRATE_GEOCODE_CACHE=off` disables result-cache reads/writes only; quota writes still apply. `OPENTAXRATE_GEOCODE_READ_ONLY=true` disables all external calls and runtime writes, but can use existing permitted cache entries. Runtime writes are limited to the two geocoding tables. Expired rows can be pruned separately.

## Margins and evidence

`marginOf(p)` is at least `EDGE_METRES[p.accuracy]`: rooftop 15 m, parcel 25 m, point 40 m, interpolated 75 m. These are operational margins, not proof of physical accuracy. Agreement only widens a placement's margin. An explicitly validated refinement can replace a coarse placement with a sharper one.

`scripts/bench.ts geocode --provider photon --budget 100` measures p95 distance to benchmark cases with trusted `lon,lat`, grouped by provider and accuracy. It uses the same cache and budgets and prints aggregate measurements without persisting returned coordinates. Representative coordinate fixtures and enabled vendor credentials are required before claiming calibrated margins or improved real-world refusal/error rates.

Provider metadata is included in `/v1/coverage`. Successful map placements name supporting providers/datasets in `source`. Credentials and raw vendor responses are not exposed.

With a trace (`createLocator(address, { trace })`), every provider's point is recorded in `trace.geocoders` and the placement in `trace.point` (`source` lists the agreeing providers, `spreadMetres` their widest spread). A trace only records; the point is the same with or without one.
