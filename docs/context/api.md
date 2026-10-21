# API, CLI and errors

Sources: `src/server.ts`, `src/cli.ts`, `src/lookup.ts`, `src/errors.ts` (and `src/db/client.ts` for the pool)

The outside of the service. The HTTP API and the CLI both turn a request into one call to `lookUpRate` (`src/lookup.ts`), which calls `addressRates.at` in the engine. Neither writes rate data; loading is the CLI's `refresh` command (see [refresh.md](refresh.md)).

## Endpoints (`src/server.ts`)

The app is a Hono instance exported as `app`.

| Route | Does | Status codes |
|---|---|---|
| `GET /health` | runs `select 1`, returns `{ "ok": true }` | 200, or 500 if the database fails |
| `GET /v1/rate` | validates the query, returns an `AddressRate` (see [engine.md](engine.md)) | 200, 400, 422, 502, 504, 500 |
| `GET /v1/coverage` | for each of `ADDRESS_RATE_STATES`: `state`, `method` from `addressRates.method`, and its `files` from `sales_tax_data_releases` (`kind`, `file`, `rows`, `loadedAt`) | 200 |

`/v1/rate` query, checked with zod:

| Param | Rule |
|---|---|
| `state` | trimmed, exactly 2 characters (upper-cased later in `lookUpRate`) |
| `street` | up to 200 characters, default `""` |
| `city` | up to 100 characters, default `""` |
| `zip` | optional, `^\d{5}(?:-?\d{4})?$` |
| `date` | optional, `YYYY-MM-DD`; today (UTC) when absent |

## Error responses

Every error body is `{ "error": <message for a person>, "code": <stable code> }`.

| Code | Status | Where it comes from |
|---|---|---|
| `BAD_REQUEST` | 400 | query failed validation (`server.ts`) |
| `ADDRESS_NEEDS_CONFIRMATION` | 422 | default for any `RateError` with status 422 |
| `UNSUPPORTED_STATE` | 422 | `addressRates.at` for a state with no engine |
| `UPSTREAM_UNAVAILABLE` | 502 | default for status 502: state not loaded, missing state rate row, CDTFA down |
| `UPSTREAM_TIMEOUT` | 504 | default for status 504: CDTFA timed out |
| `INTERNAL` | 500 | any non-`RateError` throw, logged by `app.onError` |

Only the four codes in `RATE_ERROR_CODES` are `RateError` codes; `BAD_REQUEST` and `INTERNAL` are written by `server.ts` directly.

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

`lookUpRate(q: RateQuery): Promise<AddressRate>`

- Upper-cases `state`, defaults `date` to today's UTC date.
- Builds `primary = mapboxGeocoder()` (undefined without `MAPBOX_ACCESS_TOKEN`).
- Passes a `locate` closure that calls `locateAddress({ street, city, state, zip }, primary)`. The engine decides whether to call it, so the address is geocoded only when needed (see [geocoding.md](geocoding.md)).

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
