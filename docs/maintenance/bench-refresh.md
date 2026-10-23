# Benchmark refresh

[← Maintenance](cron.md) · [Benchmarks](../benchmarks.md)

The prompt for redrawing the benchmark. It runs before the monthly tax-rate
update (`pnpm rates maintain cron`), does the monthly fresh check every
time, and redraws the whole benchmark once a quarter. The output is data
in the standard layout; the scripts that draw and label it are written for
the run in `artifacts/`, not committed.

Read first: [benchmarks](../benchmarks.md), `bench/benchmark.json`,
`scripts/tuning/README.md`, and `artifacts/maintenance/bench-refresh.json`
(the last refresh's date and the next one due). Reference material, saved
and backed up with the benchmark (`pnpm bench restore` if it's missing):

- `artifacts/bench/pool/README.md`, `sets/oa-README.md`,
  `ADDRESS-SOURCES-AUDIT.md`, `OFFICIAL-ORACLES.md`: how the sets were
  drawn, which sources cover which states, each state's official service.
- `artifacts/bench/pool/scripts/` (`r3/`, `oa/`, `py-draft/`) and
  `artifacts/bench/oracles/`: the samplers and labellers used before.
- `artifacts/bench/reference/`: the boundary point sampler and labeller.

## Rules

- Addresses come from open data only: the USDOT National Address Database,
  OpenAddresses (on `spark-3`, `/home/winxton/pelias/data/openaddresses`,
  read over ssh, only sampled rows copied back), OpenStreetMap extracts,
  Mississippi's MARIS parcels. Record each row's source and source id.
- Labels come only from each state's own service or published table, never
  a commercial tax service. A case the service can't settle is refused with
  the reason, not guessed. Be polite: a second between calls to one
  service; stop on 403 or 429.
- No paid service except the geocoders' first run of a new set, which
  `pnpm bench split` records; stay under `MAINT_GEOCODE_BUDGET`.
- Write scripts in TypeScript (`npx tsx`) in `artifacts/bench/refresh/<run>/`,
  never in the repository. Commit only `bench/benchmark.json` and docs.
- Never publish an eval split.

## Every month: the fresh check

1. Draw about 300 new random addresses, about 6 a state, deduplicated
   against every set in `artifacts/bench/pool/sets/`.
2. Label them with each state's official service for today's date.
3. Save them as the set `fresh-<run>` in `artifacts/bench/pool/sets/` and
   `answers/` (the layout of any set: `cases.csv`, `official.jsonl`).
4. Score it once the maintenance run has updated its database, just before
   its bench: `DATABASE_URL=<the run's database> pnpm bench split
   fresh-<run> fresh-<run>`, and write the score line to
   `artifacts/maintenance/<run>/fresh.txt`. The maintenance bench reports it
   beside dev, history and boundary; it isn't a gate, since every month's
   sample is new.

## Every quarter: redraw the benchmark

When `next_due` in `artifacts/maintenance/bench-refresh.json` has passed:

1. **Draw** a new benchmark the size of the current one (about 5,900 dev
   and 2,200 eval addresses): random addresses in every state, weighted
   county by county by housing units where the national database is thin,
   deduplicated against every earlier set. Name the splits by quarter:
   `q2027-1-dev`, `q2027-1-eval`.
2. **Label** every case as above. Also label the boundary points again for
   today, as a new set beside the old.
3. **Run** each new split once (`pnpm bench split`), which records its
   geocodes, and score the current release on both the old and the new
   benchmark, so the change in scores is explained by the new addresses,
   not mistaken for a regression.
4. **Switch** `bench/benchmark.json` to the new splits and a new version
   (the date), and keep the old splits' files: earlier versions stay
   reproducible.
5. **Publish** the new dev version (`pnpm bench publish`), back up
   everything (`pnpm bench backup`), and set `last_refresh` and `next_due`
   (three months on) in `artifacts/maintenance/bench-refresh.json`.
6. **Re-baseline** the maintenance gate with the new benchmark's scores
   (`artifacts/maintenance/accepted`), since the old numbers don't compare.

End with a short report: the fresh check's score, whether a quarterly
redraw ran, its counts by state (drawn, labelled, refused), geocoder spend,
and anything that failed.
