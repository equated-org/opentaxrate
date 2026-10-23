# CLAUDE.md

OpenTaxRate looks up US sales tax rates from the states’ published data.
The API and CLI live in `src/`; the SvelteKit web client lives in `client/`.

## Documentation

Start with the local docs and read the relevant subsystem note before changing code.

| Document | Use it for |
| --- | --- |
| [README](README.md) | Setup, development, API and CLI overview |
| [Architecture](docs/architecture.html) | Lookup engines, data flow, tables and rate stacking |
| [Subsystem notes](docs/context/index.html) | [API and CLI](docs/context/api.html), [engine dispatch](docs/context/engine.html), [ranges](docs/context/range-engine.html), [maps](docs/context/map-engine.html), [geocoding](docs/context/geocoding.html), [refresh and schema](docs/context/refresh.html) |
| [State coverage](docs/state-coverage.html) | Supported sources, state-specific behavior and known gaps |
| [Configuration](docs/configuration.md) | Environment settings, credentials, provider limits and accounts |
| [Data maintenance](docs/data.md) | Local refresh, source archives, snapshots and production releases |
| [Benchmarks](docs/benchmarks.md) | The benchmark sets, where they live, and how to benchmark a change (`pnpm bench`) |
| [Maintenance runs](docs/maintenance/cron.md) | The monthly tax-rate update, step by step, and the [sources](docs/maintenance/sources.md) it watches |
| [Tax-rule scope](docs/tax-rules.md) | Research and taxability rules outside the implemented rate lookup |
| [Web client](client/README.md) | Client setup, commands, configuration and fixtures |
| [Self-hosted geocoders](docs/self-hosted-geocoders.html) | Geocoder infrastructure and setup |

## Development rules

- Update the matching subsystem note in the same change as the code it describes. Keep internal plans, research and development logs outside the public repository; check the implementation when a document appears stale.
- Return an explicit refusal when the published evidence cannot settle one rate. Preserve dated source evidence and the separation between tax-data ingestion and request-time lookup.
- Measure accuracy with `pnpm bench` and [the benchmark skill](.agent-skills/benchmark/SKILL.md): baseline, change, compare, and keep a change only if no set's wrong answers rise.
- Use Node.js 22+ and pnpm. For backend changes, run `pnpm typecheck` and relevant `pnpm test` tests. For client changes, run `pnpm --dir client check`, relevant `pnpm --dir client test` tests, and `pnpm --dir client build` when the build is affected. Report checks that could not run.
- Follow [the shared HTML style](.agent-skills/shared/html-design/STYLE.md) and [template](.agent-skills/shared/html-design/template.html) when writing HTML documentation or plans.
- Keep secrets in ignored environment files. Preserve the server's `deploy/.env` during deployment.
- Follow [data maintenance](docs/data.md) for production data: refresh and benchmark locally, publish a release, then pull that release into production. Never refresh or ingest on the production server; use `pull`, not `install`, for an existing production database.
- Every published data release goes in `client/src/lib/data-releases.json` (the public /docs/releases page), newest first, with a few bullets on what changed. Record a new or dropped source in [sources](docs/maintenance/sources.md).
- Do not add Claude co-author trailers or generated-by credits to commits. Preserve human authorship.
