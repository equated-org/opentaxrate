---
name: benchmark
description: Measure OpenTaxRate's accuracy against the states' official answers — before and after an engine, params or data change, for a new random sample, or for history (past dates). Use when asked to benchmark, evaluate, tune src/params.ts, compare runs, or check a release.
---

# Benchmarking OpenTaxRate

Every benchmark runs through one CLI, `pnpm bench` (`scripts/bench`), and
scores answers against each state's own official answer. Read
`scripts/tuning/README.md` for how each set was built.

## Where the sets live

`bench/benchmark.json` names the dev and eval splits and the dataset
version. The dev sets are public in
[equated-org/opentaxrate-bench](https://github.com/equated-org/opentaxrate-bench)
(one tag a version); `pnpm bench fetch` downloads the pinned version into
`artifacts/bench`. The eval sets, recorded geocodes and other services'
answers are private: `pnpm bench backup` and `restore` keep them in restic
(tag `bench`; credentials as for `scripts/backup-sources.sh`). Never export,
commit or publish an eval split; `pnpm bench export` refuses if one leaks.

## The sets

| Set | Command | What it measures | Cost |
|---|---|---|---|
| Dev address splits (~5,300 addresses: the random pool, r3-dev, and oa-dev for states the National Address Database covers thinly) | `pnpm bench dev NAME [PARAMS]` | the whole pipeline: geocoding, ranges, map, refusals | $0 (geocodes replayed) |
| Held-out splits (~2,000: evalA, evalB, r3-eval, oa-eval) | `pnpm bench eval NAME` | the same, on addresses never tuned on | $0; run sparingly, never tune on it |
| History (hist-dev) | `pnpm bench history NAME` | the dev addresses on past dates | $0 |
| Boundary points (~2,800 point-dates) | `pnpm bench boundary NAME [PARAMS]` | outlines, rate tables and edge rules, near lines, no geocoding | $0 |
| A new random sample | `pnpm bench split SPLIT NAME` | the pipeline on new addresses | about $1 per 1,000 addresses, first run only |
| All of dev, history, boundary | `pnpm bench all NAME [PARAMS]` | one line each | $0 |

`PARAMS` is `OTR_PARAMS` JSON, e.g. `'{"breakdownMarginMetres":30}'`.

## How to use it

1. Run the baseline first with the code and data as they are:
   `pnpm bench all base`.
2. Make the change (prefer a setting in `src/params.ts` over new code), and
   run it under a new name: `pnpm bench all mine '{"setting":value}'`.
3. Compare: `pnpm bench compare mine-dev base-dev dev`,
   `pnpm bench compare mine-history base-history history`,
   `pnpm bench compare mine base boundary`. `LIST=1` lists every miss.
4. Keep a change only if wrong answers don't rise anywhere and right
   answers rise on dev. The boundary set leans on lines, so its declines are
   far above real traffic's: confirm a margin change on dev before keeping
   it. Run `pnpm bench eval` once, at the end.
5. Record the settled result in the setting's comment in `src/params.ts`
   (the numbers, not a story).

## Rules

- Geocoder spend: `pnpm bench cost` before and after; a split's first run
  geocodes live (keys from `KEYS_ENV`). Keep a round under $10.
- One trial at a time (they share replay files; `trial.sh` locks).
- A wrong rate is worse than a refusal. Report right, wrong and declined,
  and the wrong rate's upper bound, never right alone.
- Disputed addresses (official sources disagree) are in
  `scripts/tuning/disputes.json`; add one only with both sources cited.
- New sets are drawn and labelled by the benchmark refresh
  ([docs/maintenance/bench-refresh.md](../../docs/maintenance/bench-refresh.md)),
  with scripts written for the run in `artifacts/`, never committed; then
  `pnpm bench split SPLIT NAME` runs them.
- Benchmark data lives in `artifacts/` (git-ignored); never commit it.
