# Geocoding

Sources: `src/geocoding/index.ts`, `src/geocoding/mapbox.ts`, `src/geocoding/index.ts` (`LocatedPoint`, `EDGE_METRES`, `marginOf`), `src/lookup.ts` (wiring)

Turns a street address into one `LocatedPoint { lon, lat, accuracy, metres? }`, or null. Used by the map engine for every lookup, and by the range engine only when a ZIP is split (see [engine.md](engine.md)). This note describes the code as it is today.

## Wiring

`lookUpRate` (`src/lookup.ts`) builds `primary = mapboxGeocoder()` once per request and hands the engine a `locate` closure calling `locateAddress(address, primary)`. Without `MAPBOX_ACCESS_TOKEN`, `primary` is undefined and only the two free sources run.

## `locateAddress(address, primary?)`

1. Sources: `[primary, censusPoint, nominatimPoint]`, minus any undefined.
2. All are called at once with `Promise.allSettled`. A source that throws, times out or returns null simply adds no point.
3. No points: return null.
4. Sort by `ACCURACY_ORDER`: `rooftop`, `parcel`, `point`, `interpolated`. The first is `best`.
5. `spread` is the largest distance from `best` to any other point (`metresBetween`, a flat-earth approximation).
6. `spread > MAX_SPREAD_METRES` (250): return null; the address is not placed.
7. `spread > EDGE_METRES[best.accuracy]`: return `best` with `metres: Math.ceil(spread)`. Otherwise return `best` unchanged.

So agreement within the best point's own margin keeps it as is; a wider disagreement becomes the margin a line must be beyond. One source alone is accepted at its own accuracy.

## Margins (`types.ts`)

| Accuracy | `EDGE_METRES` | Who returns it |
|---|---:|---|
| `rooftop` | 15 | Mapbox |
| `parcel` | 25 | Mapbox |
| `point` | 40 | Mapbox, Nominatim |
| `interpolated` | 75 | Mapbox, Census |

`marginOf(p) = p.metres ?? EDGE_METRES[p.accuracy]`. Both engines refuse a point whose deciding line is closer than this (map engine only if the rate across differs).

## Sources

### Census (`censusPoint`, `geocoding/index.ts`)

- `geocoding.geo.census.gov/geocoder/locations/onelineaddress`, benchmark `Public_AR_Current`, 6 s timeout (`TIMEOUT_MS`).
- Keeps matches whose state is absent or equals the asked state.
- **Exactly one match** or nothing. Accuracy is always `interpolated` (it places the number along the street's address range).

### Nominatim (`nominatimPoint`, `geocoding/index.ts`)

- `nominatim.openstreetmap.org/search` with structured `street`, `city`, `state`, `postalcode` (five digits), `countrycodes=us`, `limit=2`, 6 s timeout.
- Sends `User-Agent` from `OPENTAXRATE_USER_AGENT` (default `opentaxrate (+https://github.com/opentaxrate/opentaxrate)`).
- Keeps results with a `house_number` and `ISO3166-2-lvl4` equal to `US-<state>`; nothing coarser than a house.
- Two results more than 50 m apart: null. Within 50 m (a node and a building for one house): the first. Accuracy `point`.
- **Spacing**: a module variable `nominatimFree` holds the next free time; each call reserves one second past it and sleeps until its slot. This is one request per second **per process**, not across processes or replicas.

### Mapbox (`mapboxGeocoder`, `src/geocoding/mapbox.ts`)

- Only when `MAPBOX_ACCESS_TOKEN` is set. Geocoding v6 forward, `types=address`, `country=us`, `autocomplete=false`, `limit=5`, 5 s timeout.
- A feature is kept only if all hold:
  - `coordinates.accuracy` is one of `rooftop`, `parcel`, `point`, `interpolated`;
  - `match_code.confidence` is `exact` or `high`;
  - `match_code.address_number` and `match_code.street` are both `matched`;
  - `context.region.region_code` equals the asked state.
- **Exactly one** kept feature or null. Its accuracy is Mapbox's own.

## Invariants

- No point is better than a wrong point: every source returns null rather than a coarse or ambiguous answer, and disagreement past 250 m returns null.
- A source failing never fails the lookup; it only removes a vote.
- Nothing is cached; each lookup that needs a point calls every configured source.
- The margin only ever widens from disagreement, never narrows.

## Planned

See [../plans/multi-geocoder.html](../plans/multi-geocoder.html). The plan enables each provider only when its API key is set, asks two sources by default instead of all at once, and escalates to more providers only when an edge actually decides the rate. Results a provider's terms allow storing, and each provider's daily quota use, go in a Postgres cache, and a circuit breaker per provider stops calling one that keeps failing. None of this exists in the code yet.
