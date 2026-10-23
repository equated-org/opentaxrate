# Benchmarks

[← README](../README.md)

OpenTaxRate is measured against each state's own answer. Every benchmark
address or point is labelled by the state's official service for a sale
date, and an answer is right, wrong or declined against that label. A wrong
rate is worse than a refusal, so results report all three.

## The sets

The sets are public in
[equated-org/opentaxrate-bench](https://github.com/equated-org/opentaxrate-bench),
one tagged release a version. `bench/benchmark.json` pins the version this
code is measured on.

| Set | Size | What it measures |
|---|---|---|
| Addresses | about 5,300 labelled | the whole pipeline: geocoding, address ranges, the map, refusals |
| History | about 1,070 labelled | the same addresses on past dates (2024–2025) |
| Typos | 373 | the same addresses typed with mistakes |
| Boundary points | 2,836 point-dates in TX, CO, AK, AZ, VA, SC | outlines, rate tables and edge rules near lines, without geocoding |

The addresses are random real addresses in every state, from the USDOT
National Address Database, OpenStreetMap, Mississippi's parcels and
OpenAddresses. As of 2026-10-23, 5,293 of 5,317 get the state's rate, 7 get
a wrong one and 17 are declined.

## How to benchmark

1. **Get the sets.** `pnpm bench fetch` downloads the pinned version into
   `artifacts/bench`.
2. **Load the data.** Start the database (`docker compose up -d db`) and
   load the release to measure: `pnpm rates pull TAG --local`.
3. **Run a baseline.** `KEYS_ENV=keys.env pnpm bench all base` scores the
   addresses, history and boundary sets, one line each.
4. **Make a change** and run it under a new name. A setting in
   `src/params.ts` can be tried without editing anything:
   `pnpm bench all mine '{"breakdownMarginMetres":30}'`.
5. **Compare.** `pnpm bench compare mine-dev base-dev dev` lists every
   address whose result changed (`history` and `boundary` likewise);
   `LIST=1` lists every miss. Keep a change only if wrong answers don't
   rise in any set.

| Command | Does |
|---|---|
| `pnpm bench all NAME [SETTINGS]` | addresses, history and boundary |
| `pnpm bench dev NAME [SETTINGS]` | the addresses |
| `pnpm bench history NAME [SETTINGS]` | the addresses on past dates |
| `pnpm bench boundary NAME [SETTINGS]` | points near lines (`MARGIN` metres, default 15) |
| `pnpm bench compare NAME BASE [SET]` | what changed between two runs |
| `pnpm bench cost` | geocoder spend recorded so far |

**Cost.** The first run asks your geocoders about each address, about $1
per 1,000 with paid ones (keys in `KEYS_ENV`); later runs replay those
answers for free.
