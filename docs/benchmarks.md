# Benchmarks

[← README](../README.md)

OpenTaxRate is measured against each state's own answer. Every benchmark
address or point is labelled by the state's official service (its lookup,
rate map or published table) for a given sale date, and an answer is right,
wrong or declined against that label. A wrong rate is worse than a refusal,
so results always report all three, never accuracy alone.

## The sets

| Set | Size | What it measures | Where |
|---|---|---|---|
| Dev addresses | about 5,300 labelled | the whole pipeline: geocoding, address ranges, the map, refusals | public |
| Eval addresses | about 2,000 labelled | the same, on addresses never tuned on | private |
| History | about 1,070 labelled | dev addresses on past dates (2024–2025) | public |
| Typos | 373 | dev addresses typed with mistakes | public |
| Boundary points | 2,836 point-dates in TX, CO, AK, AZ, VA, SC | outlines, rate tables and edge rules near lines, without geocoding | public |

The addresses are random samples of real addresses in every state: the
USDOT National Address Database, OpenStreetMap, Mississippi's parcels, and
OpenAddresses, drawn county by county for the states the national database
covers thinly. Results as of 2026-10-23: dev 5,293 of 5,317 right with 7
wrong; eval 1,986 of 1,999 right with 3 wrong.

**Where they live.** The dev sets are public in
[equated-org/opentaxrate-bench](https://github.com/equated-org/opentaxrate-bench),
one git tag and release a version (`v2026.10.23`), with each address's
source and licence. The eval sets stay private, so they stay an honest
check; they are backed up with restic, as are the recorded geocoder answers
that let a run repeat for free and other services' answers, which may not
be published. `bench/benchmark.json` pins the version and names which sets
are dev and which eval.

## How to benchmark

Everything runs through one command, `pnpm bench` (`scripts/bench`). Agents
follow the same steps in the [benchmark skill](../.agent-skills/benchmark/SKILL.md).

1. **Get the sets.** On a fresh clone, `pnpm bench fetch` downloads the
   pinned dev version into `artifacts/bench`. Maintainers add the eval sets
   and recorded geocodes with `pnpm bench restore` (restic settings as in
   [data maintenance](data.md#raw-sources-and-backups)).
2. **Load the data.** The engine reads the local database:
   `docker compose up -d db`, then `pnpm rates pull TAG --local` (or a
   refresh) so it holds the release you want to measure.
3. **Run a baseline.** `pnpm bench all base` scores the dev, history and
   boundary sets, one line each:
   ```
   dev:      base-dev: n=5317 right 5293 (99.55%) wrong 7 declined 17 | wrong-rate upper95 0.25% of answered
   history:  base-history: n=1072 right 1054 (98.32%) wrong 0 declined 18
   boundary: base: n= 2836  right  2582 ( 91.0%)  wrong    7  declined  247
   ```
4. **Make the change.** Prefer a setting in `src/params.ts` to new code; try
   it without editing anything by passing it:
   `pnpm bench all mine '{"breakdownMarginMetres":30}'`.
5. **Compare.** `pnpm bench compare mine-dev base-dev dev` lists every
   address whose grade changed (`history` and `boundary` likewise);
   `LIST=1` lists every miss. Keep a change only if wrong answers don't rise
   in any set and right answers rise on dev. The boundary set leans on
   lines, so its declines run far above real traffic's: confirm a margin
   change on dev.
6. **Check once on eval.** `pnpm bench eval mine` at the end, never while
   tuning.

| Command | Does |
|---|---|
| `pnpm bench dev NAME [PARAMS]` | the dev address sets |
| `pnpm bench eval NAME [PARAMS]` | the held-out sets (maintainers) |
| `pnpm bench history NAME [PARAMS]` | dev addresses on past dates |
| `pnpm bench boundary NAME [PARAMS]` | points near lines, no geocoding (`MARGIN` metres, default 15) |
| `pnpm bench split SPLIT NAME` | any labelled set, e.g. a new sample |
| `pnpm bench all NAME [PARAMS]` | dev, history and boundary |
| `pnpm bench compare NAME BASE [SET]` | what changed between two runs |
| `pnpm bench cost` | geocoder dollars recorded so far |
| `pnpm bench fetch` | the pinned public dev version |
| `pnpm bench export`, `publish` | a new public version (maintainers) |
| `pnpm bench backup`, `restore` | the private sets, to and from restic (maintainers) |

**Cost.** A set's first run asks the geocoders live, about $1 per 1,000
addresses with your keys (`KEYS_ENV`); every run after replays those answers
for free. `pnpm bench cost` before and after shows the spend. Trials run one
at a time.

**Without the eval sets** (anyone outside the maintainers), `dev`, `history`
and `boundary` work; rows whose source states no licence come without their
address text and aren't asked.

More detail on each set and the scripts underneath is in
[scripts/tuning/README.md](../scripts/tuning/README.md).
