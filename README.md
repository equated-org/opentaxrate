<h1 align="center">
  <a href="https://opentaxrate.com">OpenTaxRate</a>
</h1>

<p align="center">US sales tax rates by street address, from the states’ own data.</p>

<p align="center">
  <a href="https://opentaxrate.com"><strong>Website · Try a lookup</strong></a> ·
  <a href="#quick-start">Self-host</a> ·
  <a href="docs/configuration.md">Configuration</a> ·
  <a href="docs/state-coverage.html">Coverage</a> ·
  <a href="docs/benchmarks.md">Benchmarks</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License: MIT"></a>
  <a href="docs/state-coverage.html"><img src="https://img.shields.io/badge/coverage-50%20states%20%2B%20DC-2ea44f?style=flat-square" alt="Coverage: 50 states + DC"></a>
</p>

Look up a US street address and date to get the combined sales tax rate, jurisdiction breakdown, and source. OpenTaxRate uses published state data and explicitly declines lookups it cannot settle.

- **Address-level:** state-published address ranges and geographic tax boundaries.
- **Verifiable:** published sources, dated rates, and benchmarks against official answers.
- **Explicit uncertainty:** ambiguous lookups return `422`; missing data is never treated as zero.
- **Open source:** MIT licensed. Self-host with PostgreSQL + PostGIS; paid geocoders are optional.

General sales tax rates, with lookup methods for all 50 states and DC. See [coverage and limits](docs/state-coverage.html).

## Why street addresses matter

ZIP codes cross tax boundaries. A single ZIP-level rate cannot distinguish addresses subject to different rates within that ZIP.[^boundaries]

OpenTaxRate combines state address ranges, tax-area polygons, and dated rates. See [how it works](docs/architecture.html) and [where the data comes from](docs/maintenance/sources.md).

[^boundaries]: Stripe's engineering team [illustrates this with two nearby houses](https://stripe.dev/blog/how-we-built-it-jurisdiction-resolution-for-stripe-tax) in the same ZIP but different counties, and describes resolving addresses against geographic boundaries.

## Benchmarks

| Test | Correct | Wrong | Declined |
|---|---:|---:|---:|
| Development · 2026-10-23 | 5,301 / 5,317 | 4 | 12 |
| Held-out comparison · 2026-10-22 | 275 / 277 | 0 | 2 |

Combined-rate results against official answers.[^bench] See [methodology and how to run the benchmarks](docs/benchmarks.md).

[^bench]: Development addresses guide improvements. The separate held-out comparison uses `evalA`, with geocoding providers and no live state lookup. Public development datasets: [opentaxrate-bench](https://github.com/equated-org/opentaxrate-bench). Held-out sets and recorded geocodes remain private. Scoring exceptions and historical limits are documented in the methodology.

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

## Hosted API

Hosted lookups are $1.95 per 1,000 at [opentaxrate.com](https://opentaxrate.com). The MIT-licensed code can also be self-hosted; hosting and any external geocoding costs depend on your configuration.

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
- [Benchmarks](docs/benchmarks.md) — the benchmark sets and how to benchmark a change
- [Self-hosted geocoders](docs/self-hosted-geocoders.html)
- [Web client](client/README.md)

## Sources and license

Rates come from state tax offices and [Streamlined Sales Tax](https://www.streamlinedsalestax.org/ratesandboundry/). [Census TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html) supplies reference geography, not tax rates. See the [source overview](docs/maintenance/sources.md) for source roles, editions, and historical limits. Provider terms apply; see [configuration](docs/configuration.md#geocoding). **Not tax advice:** verify the sources returned with each rate.

[MIT License](LICENSE). Use, modify, and run it for your business, including as a hosted service.
