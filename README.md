<h1 align="center">
  <a href="https://opentaxrate.com">OpenTaxRate</a>
</h1>

<p align="center">US sales tax rates by street address, from the states’ own data.</p>

<p align="center">
  <a href="https://opentaxrate.com"><strong>Website · Try a lookup</strong></a> ·
  <a href="#quick-start">Self-host</a> ·
  <a href="docs/configuration.md">Configuration</a> ·
  <a href="docs/state-coverage.html">Coverage</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Elastic%202.0-blue?style=flat-square" alt="License: Elastic 2.0"></a>
  <a href="docs/state-coverage.html"><img src="https://img.shields.io/badge/coverage-50%20states%20%2B%20DC-2ea44f?style=flat-square" alt="Coverage: 50 states + DC"></a>
</p>

Look up an address and date to get the combined rate, jurisdiction breakdown, and sources. Ambiguous addresses return `422` rather than a guessed rate. Self-host with Postgres + PostGIS; paid geocoders are optional.

## Why this exists

ZIP codes do not follow tax boundaries. The same ZIP can span cities, counties, and special districts with different rates, and ZIP-level APIs average that away.

OpenTaxRate is built for developers wiring sales tax into checkout, invoicing, or accounting software:

- **Address-level, not ZIP-level:** the rate for the actual street address, with a jurisdiction breakdown and the source behind it
- **Honest about uncertainty:** ambiguous or missing data returns `422` instead of a guessed or zero rate
- **Verifiable:** rates come from the states' own published data. In our test of 277 random addresses against each state's published rate, 275 matched and 2 were declined rather than guessed
- **Cheaper than the incumbents:** hosted lookups are $1.95 per 1,000 at [opentaxrate.com](https://opentaxrate.com), and self-hosting is free under the Elastic 2.0 license (source available; offering it as a hosted or managed service requires a hosting license)

If this saves you a TaxJar, Avalara, or Stripe Tax integration headache, a star helps other developers find it.

## Quick start

```bash
git clone https://github.com/equated-org/opentaxrate.git && cd opentaxrate
cp .env.example .env
docker compose up -d
docker compose run --rm refresh OH TX WA
```

The API runs on `localhost:8080`. Omit the state codes to load every state (~45 minutes, ~5 GB), or [install a snapshot](docs/data.md#snapshots-and-releases).

```bash
curl -G localhost:8080/v1/rate \
  --data-urlencode state=OH --data-urlencode "street=90 W Broad St" \
  --data-urlencode city=Columbus --data-urlencode zip=43215
```

Responses include `rate` (a decimal: `0.08` = 8%), `parts`, `match`, and `source`. Add `date=YYYY-MM-DD` for a historical rate or `include=trace` for lookup details.

## API and CLI

| Endpoint | Purpose |
|---|---|
| `GET /v1/rate` | Rate by `state`, `street`, `city`, `zip` (or one-line `address`), and optional `date` |
| `GET /v1/coverage` | Loaded states and source files |
| `GET /v1/openapi.json` | The OpenAPI 3.1 spec for the two above, generated from `src/api-schema.ts` |
| `GET /v1/suggest?q=` | Address autocomplete, when configured |
| `GET /health` | Database health |

Rate lookups return `400` for invalid input, `422` when confirmation is needed, and `502` when state data is missing.

```bash
docker compose run --rm api rate OH "90 W Broad St" Columbus 43215
docker compose run --rm api check --cases cases.csv
docker compose run --rm refresh [STATE...] [--force]
```

## Configuration

Edit `.env` locally; keep production settings in the server’s `deploy/.env`. Restart the API after changes.

See the [configuration guide](docs/configuration.md) for geocoders, limits, keys, and accounts. Available settings are listed in [.env.example](.env.example) and [deploy/.env.example](deploy/.env.example).

## Coverage and limits

Uses published SST/state address ranges, PostGIS boundaries, and California’s live CDTFA lookup. Historical coverage varies by state; SST and Missouri generally go back to 2020.

This is the general sales tax rate. Taxability, exemptions, item caps, sourcing rules, and tribal taxes are outside scope. Missing boundaries or conflicting placements can require confirmation. See [state coverage](docs/state-coverage.html) for specifics.

## Development

Requires Node 22+ and pnpm.

```bash
pnpm install
cp .env.example .env # first setup only
export DATABASE_URL=postgres://opentaxrate:opentaxrate@localhost:5433/opentaxrate
docker compose up -d db
pnpm migrate
pnpm refresh OH
pnpm test
pnpm dev
```

## Documentation

- [Architecture](docs/architecture.html) — lookup engines, tables, and stacking rules
- [Data maintenance](docs/data.md) — refresh, downloads, and snapshots
- [Self-hosted geocoders](docs/self-hosted-geocoders.html)
- [Web client](client/README.md)

## Sources and license

Data comes from [Streamlined Sales Tax](https://www.streamlinedsalestax.org/ratesandboundry/), [Census TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html), and state tax offices. Provider terms apply; see [configuration](docs/configuration.md#geocoding). **Not tax advice:** verify the sources returned with each rate.

[Elastic License 2.0](LICENSE). Use, modify, and run it for your business. Offering OpenTaxRate as a hosted or managed service requires a hosting license; open an issue to discuss.
