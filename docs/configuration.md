# Configuration

[← README](../README.md)

Copy [.env.example](../.env.example) to `.env` for local use. Production settings belong in the server’s `deploy/.env`; keep that file when deploying code. Both files are ignored by Git. Exported variables take precedence over local `.env` in the pnpm scripts. Restart the API after changes.

## Basic settings

- `PORT`: API port, default `8080`.
- `DATABASE_URL`: Postgres connection for local commands. Docker supplies its own connection; the database is exposed locally on `DB_PORT` (default `5433`).
- `OPENTAXRATE_USER_AGENT`: identify your app and include a contact for source downloads.
- `OPENTAXRATE_HISTORY_FROM`: earliest SST/Missouri history to load, default `2020-01-01`.

See [.env.example](../.env.example) for provider credentials and defaults, and [deploy/.env.example](../deploy/.env.example) for public server settings.

## Geocoding

Census and public Nominatim work without keys. Set `PHOTON_URL`, `PELIAS_URL`, or `NOMINATIM_URL` for your own services; see [self-hosted geocoders](self-hosted-geocoders.html). `PHOTON_URL` places addresses; `OPENTAXRATE_PHOTON_URL` separately enables autocomplete.

Optional paid providers use credentials from `.env.example`. Cached results and cheaper providers run first; Google is a last resort. Near a boundary, a precision refinement may be needed before a rate can be returned.

- `<ID>_DAILY_CAP` and `<ID>_RATE_PER_SECOND` limit calls across replicas; zero disables calls. Keep settings consistent across replicas. Caps cover this app’s calls, not other apps on the same vendor account.
- `<ID>_COST_PER_CALL` adjusts provider ordering. Esri’s ID is `ARCGIS`.
- `OPENTAXRATE_GEOCODE_CACHE=off` disables result caching; budget writes still apply.
- `OPENTAXRATE_GEOCODE_READ_ONLY=true` uses cached placements only.

Run migrations before starting the API; failed budget reservations skip providers. Google, HERE, and Smarty results stay in request memory. Mapbox and Esri caching require `MAPBOX_PERMANENT=true` and `ARCGIS_FOR_STORAGE=true`, respectively, with the appropriate paid storage rights.

Follow each provider’s terms. Public [Nominatim](https://operations.osmfoundation.org/policies/nominatim/) requires attribution, a contact, and at most one request per second; autocomplete is prohibited. Public Photon is for reasonable use; self-host for volume. Colorado and Alaska’s official lookup services are not documented bulk APIs; ask before using them at scale.

## Keys and accounts

Self-hosting works without accounts or Stripe.

| Use case | Settings |
|---|---|
| Private keys for your apps | `OPENTAXRATE_MASTER_KEYS=name=otr_master_…` |
| Public API limits | `OPENTAXRATE_PUBLIC_LIMIT`, `OPENTAXRATE_PUBLIC_PROVIDERS` |
| Accounts and per-user keys | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `RESEND_API_KEY` |
| Credit purchases | Add `STRIPE_SECRET_KEY`; use test keys locally |

Generate a master key with `echo otr_master_$(openssl rand -hex 24)` and send it as `x-api-key` or `Authorization: Bearer`. Master keys use every configured provider without public per-IP limits or credit charges. Keyed requests are logged for 90 days.

Accounts expose `/api/auth/*` and `/v1/account/*`. Enable `PUBLIC_ACCOUNTS=on` in the [web client](../client/README.md) to show sign-in. User keys use prepaid credit; Stripe Checkout supports $5–$1,000 top-ups.

## Public deployment

Set browser origins, request limits, response caching, and autocomplete in [deploy/.env.example](../deploy/.env.example). Only trust client-IP headers when the API is accessible exclusively through a proxy that sets them.

```bash
docker compose --env-file deploy/.env \
  -f docker-compose.yml -f deploy/compose.public.yml up -d
```

This binds the API to `127.0.0.1:8080` and removes the published Postgres port.
