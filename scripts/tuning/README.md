# Tuning

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
