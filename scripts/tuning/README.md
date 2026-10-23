# Tuning

Run benchmarks through `pnpm bench` (`scripts/bench`): `dev`, `eval`,
`history`, `boundary`, `split SPLIT`, `all`, `compare`, `cost`. It wraps
the scripts below; the [benchmark skill](../../.agent-skills/benchmark/SKILL.md)
says how to use it for a change.

The engine's rules are settings in `src/params.ts`, overridable for a run by
`OTR_PARAMS` (JSON). These scripts tune them on labelled random addresses
the way a model is tuned: run a configuration on the dev splits, score it
against each state's official rate, keep a change only if it answers more
addresses right with no new wrong rate and leaves the eval splits alone.
Keep tuning research and development logs outside the public repository.

| Script | Does |
|---|---|
| `trial.sh NAME ['{json}']` | Runs one configuration on `$SPLITS` (default: the dev splits) in parallel, set up like production, geocodes and the other live services (state lookups, California's, the Census's checks, Jev) replayed |
| `score.py NAME [BASE]` | Right / wrong / declined, the wrong rate's 95% upper bound, and what changed from BASE; `LIST=1` lists every miss. Fails if any labelled address has no answer |
| `cost.py` | What the kept geocoder answers cost at list price: run before and after a round |
| `one.mts` | One address through the engine with its points and outlines |
| `history_split.py NAME DATES STATES` | A split of the dev splits' addresses in STATES asked again on past DATES, their geocodes copied so trials replay them (no geocoder spend) |

```bash
KEYS_ENV=path/to/keys.env scripts/tuning/trial.sh base ''
KEYS_ENV=path/to/keys.env scripts/tuning/trial.sh wide '{"wideMetres":50000}'
python3 scripts/tuning/score.py wide base
SPLITS="evalA evalB" scripts/tuning/trial.sh eval ''      # the honest check, sparingly
python3 scripts/tuning/cost.py
```

Working files go to `$TUNE_DIR` (default `artifacts/tuning`, git-ignored):
`replay-<split>.json` and `lookups-<split>.json` hold every geocoder and
state-lookup answer, asked live once; `<NAME>/<split>/` holds a run's
answers. Splits, their cases and official labels are in `artifacts/bench/pool`.

Geocoder calls cost about $1 per 1,000 addresses the first time a split is
run; cap a round at about $5–10. Changing settings, or switching a geocoder
off with `'{"disabledGeocoders":["google","here","mapbox"]}'` (the list
replaces the default, so name the default ones too), can make the locator ask
a geocoder it skipped before, which is a live call. Geocodio's ZIP+4 lookup is
kept only when it finds one, so a no-match is asked again each trial.

What replay can't show: each geocoder's answer is kept after its adapter has
matched it (`src/geocoding/providers/`), so a setting or change inside an
adapter (street matching, `peliasDuplicateMetres`) needs that geocoder asked
live: a fresh `TUNE_DIR`, or the bench's `opentaxrate` provider without
`BENCH_GEOCODE_REPLAY`. `trial.sh` runs one trial at a time, since trials
share the replay files.

## Boundary benchmark

The address splits measure the whole pipeline. `boundary/` measures the
outlines, rate tables and edge rules alone: points near the lines a map
state's rate changes at, each labelled with the state's own answer *at that
point* (no geocoding), on today's date and on past dates where the state's
service answers for them. Every label names the jurisdictions as well as the
total, so a right rate paid to the wrong jurisdictions is caught, and a
wrong answer on a past date is a gap in history.

| Script | Does |
|---|---|
| `boundary/sample.mts STATE N [DATES]` | N seeded points: 80% within `BAND_METRES` (250) of a rated outline's line, 20% anywhere in the state, each asked on every date |
| `boundary/label.py STATE` | The state's answer at each point and date (TX, CO, AK, MO, NE, SD, WI by date; AZ, VA, SC today only); resumes where it stopped. With `BOUNDARY_CASES` and `BOUNDARY_OUT` it labels a split's addresses instead |
| `boundary/run.mts NAME STATE...` | The engine at each point, with `MARGIN` metres (0: the exact point; 15: a rooftop geocode's) |
| `boundary/score.py NAME [BASE] [STATE...]` | Right / wrong / declined, and right rates whose jurisdictions differ (silently, or flagged as uncertain with the state's among the alternatives), by state, distance to the line and date; `LIST=1` lists them |

```bash
npx tsx scripts/tuning/boundary/sample.mts TX 400 2026-10-21,2025-01-15,2023-01-15
python3 -I scripts/tuning/boundary/label.py TX      # TX needs TX_CPA_CLIENT_ID/SECRET
MARGIN=0 npx tsx scripts/tuning/boundary/run.mts exact TX
MARGIN=0 OTR_PARAMS='{"refuseBeforeFirstRate":false}' npx tsx scripts/tuning/boundary/run.mts exact-off TX
python3 -I scripts/tuning/boundary/score.py exact exact-off
```

Files go to `$BOUNDARY_DIR` (default `artifacts/bench/boundary`, git-ignored):
`<STATE>/points.csv`, `official.jsonl` and `runs/NAME.jsonl`. A run costs
nothing; labelling asks each state's service about once a second (Texas's
takes about five). Colorado's and Alaska's services are the ones the engine
loads its rates from, so they check placement on our outlines, not the rates.
The sample leans on lines, so its decline rate is far above real traffic's:
compare runs with each other, not with the address splits.

### History splits

A history split asks labelled addresses again on past dates, scored like
any split. Geocodes don't depend on the date, so they're copied, not asked;
the state lookups and the Census's checks for the new dates are asked live,
which is free. Only states whose own service answers for a past date are
labelled; a service that can't settle one refuses (South Dakota's layer
keeps only each city's current rate).

```bash
python3 -I scripts/tuning/history_split.py hist-dev 2024-07-15,2025-01-15,2025-07-15 TX,CO,AK,MO,NE,SD,WI
for s in TX CO AK MO NE SD WI; do
  BOUNDARY_CASES=artifacts/bench/pool/sets/hist-dev/cases.csv \
  BOUNDARY_OUT=artifacts/bench/pool/answers/hist-dev/official-$s.jsonl python3 -I scripts/tuning/boundary/label.py $s &
done; wait
cat artifacts/bench/pool/answers/hist-dev/official-*.jsonl > artifacts/bench/pool/answers/hist-dev/official.jsonl
PER_STATE=999 SPLITS=hist-dev scripts/tuning/trial.sh hist ''
SPLITS=hist-dev python3 scripts/tuning/score.py hist
```

`PER_STATE` (default 99) is how many addresses of each state a trial asks
per split; a history split has more than 99.
