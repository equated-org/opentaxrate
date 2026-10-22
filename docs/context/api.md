# API, CLI and errors

Sources: `src/server.ts`, `src/cli.ts`, `src/lookup.ts`, `src/errors.ts`, `src/limits.ts`, `src/cache.ts`, `src/suggest.ts`, `src/access.ts`, `src/auth.ts`, `src/mail.ts`, `src/credits.ts`, `src/requests.ts`, `src/billing.ts` (and `src/db/client.ts` for the pool)

The outside of the service. The HTTP API and the CLI both turn a request into one call to `lookUpRate` (`src/lookup.ts`), which calls `addressRates.at` in the engine. Neither writes rate data; loading is the CLI's `refresh` command (see [refresh.md](refresh.md)).

## Endpoints (`src/server.ts`)

The app is a Hono instance exported as `app`.

| Route | Does | Status codes |
|---|---|---|
| `GET /health` | runs `select 1`, returns `{ "ok": true }` | 200, or 500 if the database fails |
| `GET /v1/rate` | validates the query, returns an `AddressRate` (see [engine.md](engine.md)), plus `trace` when asked | 200, 400, 422, 429, 502, 504, 500 |
| `GET /v1/suggest` | only with `OPENTAXRATE_PHOTON_URL`: `q` (1–200 chars), `limit` (1–10, default 5), `lang`, `bbox`, and repeated `layer` (only Photon's known layers pass) relayed to `<url>/api`; Photon's GeoJSON returned unchanged with `Cache-Control: public, max-age=300` | 200, 400, 429, 502, 504 |
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
| `geocoders` | `createLocator` | each provider's point: `source` (the provider id, e.g. `census`, `nominatim`, `mapbox`), `lon`, `lat`, `accuracy` |
| `point` | `locateAddress` | the point used: `lon`, `lat`, `accuracy`, `source`, `marginMetres` (`marginOf`), `spreadMetres` |
| `outlines` | `geoRateAt`, `mapAreas` | each outline `shapesAround` found: `kind`, `fips`, `name`, `inside`, `edgeMetres`, `foot`, `levies` (added a rate part), `geometry` |
| `range` | `sstRateAt` | on a street match, the narrowest deciding row: `street`, `low`, `high`, `side` (`odd`, `even`, `both`), `zip`, `file` (the boundary file) |

Coordinates are rounded to 5 decimals, metres to 0.1. `outlines` is empty when no point was used (a street or ZIP match never geocodes for display). After the engine returns or throws, `lookUpRate` adds `geometry` with `outlineGeometry` (`src/rates/shapes.ts`): each outline clipped to a square around `point` reaching 3 km, or 1.25 × the nearest levying edge + 500 m when that is further, up to 20 km (`TRACE_CLIP_METRES`), and simplified to about 5 m per 3 km of reach, as GeoJSON; an outline with nothing in the square gets none. A geometry query that fails is logged and only leaves the shapes out.

## Access (`src/access.ts`)

`resolveAccess()` runs on `/v1/rate` and `/v1/coverage`, before the per-IP limit, and sets `c.var.access`:

| Request | Access | Providers (`policyFor`) | Per-IP limit | Answer cache |
|---|---|---|---|---|
| no key | `{ tier: "public" }` | `OPENTAXRATE_PUBLIC_PROVIDERS`, or every one when unset | yes | yes |
| a key in `OPENTAXRATE_MASTER_KEYS` | `{ tier: "keyed", master: name }` | every configured one | no | `api_requests` |
| an account's key (`otr_live_…`, `auth.api.verifyApiKey`) | `{ tier: "keyed", userId, keyId }` | every configured one, paid from the allowance | no; 120 a minute per key (429 `KEY_LIMITED`) | `api_requests` |
| any other key | 401 `{ code: "INVALID_API_KEY" }` | — | — | — |

The key is read from `x-api-key` or `Authorization: Bearer` (`presentedKey`). `OPENTAXRATE_MASTER_KEYS` is `name=key` pairs, comma-separated (a bare key is named `master`); `masterKeys()` throws at start unless each key is `otr_master_` plus at least 32 characters, and holds only their SHA-256 digests. A key never falls back to the public tier. `/v1/rate` answers carry `X-OpenTaxRate-Tier: public|keyed`.

The policy is a set of ids: the registry's geocoders plus `jev`. `lookUpRate(q, { trace, policy })` passes it to `createLocator` (`geocoderProviders(policy)`), to `addressStandardizer(policy)` (only when `geocodio` is allowed), and as `pickStreet: null` when `jev` isn't allowed, so `correctedStreet` reads by spelling only. Without a policy (the CLI), every provider is allowed.

## Accounts, keys and credit (`src/auth.ts`, `credits.ts`, `requests.ts`, `billing.ts`)

On only with `BETTER_AUTH_SECRET`. Better Auth (drizzle adapter, tables in `src/db/auth-schema.ts`) is mounted at `/api/auth/*`: `emailOTP` (6 digits, 5 minutes, 3 tries, stored hashed; `sendMail` in `mail.ts`) signs in and signs up in one step and sets `emailVerified`; `@better-auth/api-key` makes `otr_live_` keys (hashed, `start` keeps 13 characters, 120 a minute). A before-hook refuses `/api-key/create` for an unverified user. `databaseHooks.user.create.after` grants the trial (`grantTrial`).

A keyed `/v1/rate` (`keyedLookup` in `server.ts`):

1. An account's key: `charge(userId)` takes `PRICE_MICROS` (1,950 µ$, $1.95 per 1,000; a new account starts with `TRIAL_LOOKUPS`, 100) and adds 80% of it to `geo_allowance_micros`, in one `UPDATE … WHERE credit_micros >= price`; no row is 402 `NO_CREDITS`. Master keys aren't charged.
2. `cachedAnswer(caller, answerKey)`: the caller's own last 200 for the same key within `CACHE_HOURS` (24) is returned with `X-OpenTaxRate-Cache: hit`, charged, and logged with `cached`. Only the tax answer is stored: a traced lookup's trace (geocoder points, outlines) is dropped before logging, and traced lookups are never answered from history.
3. Otherwise `lookUpRate` with `accountBudget(userId)` (or `meteredBudget()` for a master key): a provider with a list price (`pricePerCall`, fixed in the registry) is reserved from the allowance before the vendor cap, and the Geocodio standardizer (twice Geocodio's price, for the zip4 field) and Jev (`JEV_PRICE`) the same way. A thin allowance means only the free providers are asked.
4. A 422 or 5xx is refunded (`refund`). Every outcome is one `api_requests` row: query, status, response, `providers` paid, `charged_micros`, `geo_cost_micros`, `ms`. Rows older than 90 days are pruned a minute after start and daily.

Session routes (cookie; 401 `SIGNED_OUT` without one): `GET /v1/account/summary` (email, `creditMicros`, `priceMicros`, `lookupsLeft`, this month's totals, lookups by key, `canBuy`, `topUpCents: {min, max}`), `GET /v1/account/requests?before=&key=&result=rate|declined|error&q=` (50 a page, newest first), and with Stripe set `POST /v1/account/checkout {"amount": <cents>}` (whole dollars, $5 to $1,000, `validTopUp`) → `{ url }` of a Stripe Checkout session (mode `payment`, `metadata.opentaxrate_user_id` on the session and its payment intent).

`POST /v1/account/checkout/confirm {"session": "cs_…"}` → `{ paid }`: the dashboard calls it on return (`?paid=<session>`); it retrieves the session from Stripe and credits it when it's paid and its metadata names the signed-in user. Purchases are credited through `creditSession`, keyed by session id, so confirm and the webhook can't both credit one.

`POST /api/billing/webhook` (only with `STRIPE_WEBHOOK_SECRET`) checks `stripe-signature` against `STRIPE_WEBHOOK_SECRET` (400 when wrong). `checkout.session.completed` or `…async_payment_succeeded` with `payment_status: "paid"` calls `addCredit(userId, "purchase", amount_total × 10,000, session.id)`; `credit_grants.stripe_id` is unique, so a resent event is a no-op. `charge.refunded` takes back the newly refunded amount once (`refund:<charge>:<total refunded>`).

## Public deployment

Each is off when its variable is unset, so a self-hosted API behaves as before.

- **CORS.** `hono/cors` on every route for the origins in `OPENTAXRATE_CORS_ORIGINS`, methods `GET`, `HEAD`, `OPTIONS`, exposing `Retry-After`. Registered first, so a 429 carries the headers and a preflight is never counted.
- **Per-IP limit** (`src/limits.ts`). `limitFromEnv()` reads `OPENTAXRATE_PUBLIC_LIMIT` (`parseLimits`: `count/unit` pairs, units `s`, `min`, `hour`, `day`, optionally `10/5min`; an unreadable value throws at start). Only `/v1/rate` is limited. `limitFromEnv(env, name)` reads any such setting; `OPENTAXRATE_SUGGEST_LIMIT` limits `/v1/suggest` the same way. The key is the first address in the header `clientIpHeader()` names (`OPENTAXRATE_CLIENT_IP_HEADER`, else `CF-Connecting-IP` when `OPENTAXRATE_TRUST_CF=1`), else the socket address from `@hono/node-server`'s `getConnInfo` (`"unknown"` when there is no socket, as in `app.request` tests). `PerIpLimiter` keeps fixed windows in memory per process; a refused call isn't counted; windows that have all ended are swept at most once per shortest window, and past `MAX_KEYS` (100,000) the least recently seen address is dropped. Over any window: 429 `{ error: "Too many lookups from this address. Try again in N s.", code: "RATE_LIMITED" }` with `Retry-After: N`.
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
| `INVALID_API_KEY` | 401 | a key that isn't a master key or a live account key (`access.ts`) |
| `KEY_LIMITED` | 429 | an account key over 120 lookups a minute, with `Retry-After` |
| `NO_CREDITS` | 402 | an account key whose credit doesn't cover a lookup |
| `SIGNED_OUT` | 401 | a `/v1/account/*` call without a session |
| `USE_API_HOST` | 400 | from the landing's Worker, not the API: a request to opentaxrate.com/v1/* carrying a key (keys go to api.opentaxrate.com) |
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
- Builds a staged locator, `createLocator(address, { trace })`; Mapbox is one of its providers when `MAPBOX_ACCESS_TOKEN` is set.
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
| `MAPBOX_ACCESS_TOKEN` | unset | `geocoding/providers/mapbox.ts`, via the registry |
| `OPENTAXRATE_CORS_ORIGINS` | unset (no CORS) | `server.ts` |
| `OPENTAXRATE_PUBLIC_LIMIT` | unset (no limit) | `limits.ts`, via `server.ts` |
| `OPENTAXRATE_TRUST_CF` | unset (socket address) | `limits.ts` |
| `OPENTAXRATE_CLIENT_IP_HEADER` | unset | `limits.ts` (`clientIpHeader`) |
| `OPENTAXRATE_CACHE_HOURS` | unset (no cache) | `cache.ts`, via `server.ts` |
| `OPENTAXRATE_PHOTON_URL` | unset (`/v1/suggest` off) | `suggest.ts`, via `server.ts` |
| `OPENTAXRATE_SUGGEST_LIMIT` | unset (no limit) | `limits.ts`, via `server.ts` |
| `OPENTAXRATE_PUBLIC_PROVIDERS` | unset (every provider) | `access.ts`, via `server.ts` |
| `OPENTAXRATE_MASTER_KEYS` | unset (none) | `access.ts`, via `server.ts` |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | unset (accounts off) | `auth.ts` |
| `RESEND_API_KEY` | unset (codes printed outside production) | `mail.ts` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | unset (no buying) | `billing.ts` |
