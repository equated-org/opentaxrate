# API, CLI and errors

Sources: `src/server.ts`, `src/cli.ts`, `src/lookup.ts`, `src/errors.ts`, `src/limits.ts`, `src/cache.ts` (and `src/db/client.ts` for the pool)

The outside of the service. The HTTP API and the CLI both turn a request into one call to `lookUpRate` (`src/lookup.ts`), which calls `addressRates.at` in the engine. Neither writes rate data; loading is the CLI's `refresh` command (see [refresh.md](refresh.md)).

## Endpoints (`src/server.ts`)

The app is a Hono instance exported as `app`.

| Route | Does | Status codes |
|---|---|---|
| `GET /health` | runs `select 1`, returns `{ "ok": true }` | 200, or 500 if the database fails |
| `GET /v1/rate` | validates the query, returns an `AddressRate` (see [engine.md](engine.md)), plus `trace` when asked | 200, 400, 422, 429, 502, 504, 500 |
| `GET /v1/coverage` | for each of `ADDRESS_RATE_STATES`: `state`, `method` from `addressRates.method`, and its `files` from `sales_tax_data_releases` (`kind`, `file`, `rows`, `loadedAt`) | 200 |

`/v1/rate` query, checked with zod:

| Param | Rule |
|---|---|
| `state` | trimmed, exactly 2 characters (upper-cased later in `lookUpRate`) |
| `street` | up to 200 characters, default `""` |
| `city` | up to 100 characters, default `""` |
| `zip` | optional, `^\d{5}(?:-?\d{4})?$` |
| `date` | optional, `YYYY-MM-DD`; today (UTC) when absent |
| `include` | optional, comma-separated; only `trace` is read, anything else is ignored |

## `include=trace`

Without it the response is exactly what it was before traces existed. With it, the route makes an empty `Trace` (`emptyTrace()`, `src/rates/types.ts`), passes it to `lookUpRate`, and answers `{ ...AddressRate, trace }`; a 422 becomes `{ error, code, trace }` (502 and 504 never carry one). The engines fill it as they go; the shape:

| Field | Filled by | Holds |
|---|---|---|
| `geocoders` | `locateAddress` | each source's point: `source` (`census`, `nominatim`, `mapbox`), `lon`, `lat`, `accuracy` |
| `point` | `locateAddress` | the point used: `lon`, `lat`, `accuracy`, `source`, `marginMetres` (`marginOf`), `spreadMetres` |
| `outlines` | `geoRateAt`, `mapAreas` | each outline `shapesAround` found: `kind`, `fips`, `name`, `inside`, `edgeMetres`, `foot`, `levies` (added a rate part), `geometry` |
| `range` | `sstRateAt` | on a street match, the narrowest deciding row: `street`, `low`, `high`, `side` (`odd`, `even`, `both`), `zip`, `file` (the boundary file) |

Coordinates are rounded to 5 decimals, metres to 0.1. `outlines` is empty when no point was used (a street or ZIP match never geocodes for display). After the engine returns or throws, `lookUpRate` adds `geometry` with `outlineGeometry` (`src/rates/shapes.ts`): each outline clipped to a square 3 km (`TRACE_CLIP_METRES`) around `point` and simplified to about 5 m, as GeoJSON; an outline with nothing in the square gets none. A geometry query that fails is logged and only leaves the shapes out.

## Public deployment

Each is off when its variable is unset, so a self-hosted API behaves as before.

- **CORS.** `hono/cors` on every route for the origins in `OPENTAXRATE_CORS_ORIGINS`, methods `GET`, `HEAD`, `OPTIONS`, exposing `Retry-After`. Registered first, so a 429 carries the headers and a preflight is never counted.
- **Per-IP limit** (`src/limits.ts`). `limitFromEnv()` reads `OPENTAXRATE_PUBLIC_LIMIT` (`parseLimits`: `count/unit` pairs, units `s`, `min`, `hour`, `day`, optionally `10/5min`; an unreadable value throws at start). Only `/v1/rate` is limited. The key is `CF-Connecting-IP` when `OPENTAXRATE_TRUST_CF=1`, else the socket address from `@hono/node-server`'s `getConnInfo` (`"unknown"` when there is no socket, as in `app.request` tests). `PerIpLimiter` keeps fixed windows in memory per process; a refused call isn't counted; windows that have all ended are swept at most once per shortest window, and past `MAX_KEYS` (100,000) the least recently seen address is dropped. Over any window: 429 `{ error: "Too many lookups from this address. Try again in N s.", code: "RATE_LIMITED" }` with `Retry-After: N`.
- **Answer cache** (`src/cache.ts`). `cacheFromEnv()` reads `OPENTAXRATE_CACHE_HOURS`. An `AnswerCache` (LRU by last use, `MAX_ANSWERS` 5,000) holds successful answers, with their trace when asked, under `answerKey`: state, street, city upper-cased with dots, commas and extra spaces removed, the ZIP without its dash, the resolved date, and the includes. Refusals and errors are never cached. The limiter runs before the cache, so a cached answer still counts.

## Error responses

Every error body is `{ "error": <message for a person>, "code": <stable code> }`.

| Code | Status | Where it comes from |
|---|---|---|
| `BAD_REQUEST` | 400 | query failed validation (`server.ts`) |
| `ADDRESS_NEEDS_CONFIRMATION` | 422 | default for any `RateError` with status 422 |
| `UNSUPPORTED_STATE` | 422 | `addressRates.at` for a state with no engine |
| `UPSTREAM_UNAVAILABLE` | 502 | default for status 502: state not loaded, missing state rate row, CDTFA down |
| `UPSTREAM_TIMEOUT` | 504 | default for status 504: CDTFA timed out |
| `RATE_LIMITED` | 429 | the per-IP limit (`limits.ts`), with `Retry-After` |
| `INTERNAL` | 500 | any non-`RateError` throw, logged by `app.onError` |

`RATE_ERROR_CODES` lists the four `RateError` codes and `RATE_LIMITED`, which `limits.ts` writes directly rather than throwing; `BAD_REQUEST` and `INTERNAL` are written by `server.ts` directly.

## `RateError` (`src/errors.ts`)

`new RateError(message, status, resultCode?, code?)`

- `status` is `422 | 502 | 504`, used as the HTTP status.
- `code` defaults from the status: 422 to `ADDRESS_NEEDS_CONFIRMATION`, 504 to `UPSTREAM_TIMEOUT`, else `UPSTREAM_UNAVAILABLE`.
- `resultCode` is optional and not sent to clients.

Invariants:

- A refusal is always a `RateError`, never a guessed rate. A 422 message names the candidate rates when the engine knows them.
- Missing data is a 502, not a zero rate.
- The route catches only `RateError`; anything else becomes a 500.

## The shared lookup (`src/lookup.ts`)

`lookUpRate(q: RateQuery, options?: { trace?: Trace }): Promise<AddressRate>`

- Upper-cases `state`, defaults `date` to today's UTC date.
- Builds `primary = mapboxGeocoder()` (undefined without `MAPBOX_ACCESS_TOKEN`).
- Passes a `locate` closure that calls `locateAddress({ street, city, state, zip }, primary, trace)`. The engine decides whether to call it, so the address is geocoded only when needed (see [geocoding.md](geocoding.md)).
- Passes `trace` in the query; with one, adds outline geometry once the engine is done (`drawOutlines`). Without one, nothing extra runs.

## CLI (`src/cli.ts`)

Run as `opentaxrate <command>` (built to `dist/cli.js`). With no or an unknown command it prints its own header comment as help.

| Command | Does |
|---|---|
| `serve` | imports `server.ts`, listens on `PORT` (default 8080), keeps the process alive |
| `migrate` | runs Drizzle migrations from `migrations/` |
| `refresh [STATE...] [--dir D] [--force]` | `refreshAddressRates({ states, dir, force })` |
| `rate STATE "street" "city" [zip] [date]` | prints `lookUpRate` as JSON |
| `check --cases file.csv` | runs each CSV row (`state,street,city,zip,date,expected`) through `lookUpRate`; prints counts of agree, differ and refused, then each difference |

`check` compares within `1e-6` and counts any throw as refused. The CSV is split on commas with no quoting.

After any command but `serve`, the Postgres `client` is closed; a thrown error sets exit code 1.

## Environment

| Variable | Default | Read in |
|---|---|---|
| `PORT` | `8080` | `cli.ts` |
| `DATABASE_URL` | `postgres://opentaxrate:opentaxrate@localhost:5432/opentaxrate` | `db.ts` |
| `DATABASE_POOL` | `10` | `db.ts` (pool size) |
| `MAPBOX_ACCESS_TOKEN` | unset | `geocoding/mapbox.ts`, via `lookUpRate` |
| `OPENTAXRATE_CORS_ORIGINS` | unset (no CORS) | `server.ts` |
| `OPENTAXRATE_PUBLIC_LIMIT` | unset (no limit) | `limits.ts`, via `server.ts` |
| `OPENTAXRATE_TRUST_CF` | unset (socket address) | `limits.ts` |
| `OPENTAXRATE_CACHE_HOURS` | unset (no cache) | `cache.ts`, via `server.ts` |
