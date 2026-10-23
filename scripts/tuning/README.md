# Tuning

What `pnpm bench` (`scripts/bench`) runs underneath. Use the command, not
these files directly; [docs/benchmarks.md](../../docs/benchmarks.md) and the
[benchmark skill](../../.agent-skills/benchmark/SKILL.md) say how.

The engine's rules are settings in `src/params.ts`, overridable for a run by
`OTR_PARAMS` (JSON). A change is kept only if it answers more addresses
right with no new wrong rate, and leaves the held-out sets alone.

| File | Does |
|---|---|
| `trial.sh NAME ['{json}']` | Runs one configuration on `$SPLITS` in parallel, set up like production, with geocodes and live services replayed (`scripts/bench.ts` asks the engine) |
| `score.ts NAME [BASE]` | Right / wrong / declined, the wrong rate's 95% upper bound, and what changed from BASE; `LIST=1` lists every miss |
| `boundary/run.mts NAME STATE...` | The engine at each boundary point, with `MARGIN` metres (0: the exact point; 15: a rooftop geocode's) |
| `boundary/score.ts NAME [BASE] [STATE...]` | Right / wrong / declined, and right rates whose jurisdictions differ, by state, distance to the line and date |
| `stats.ts` | What the scorers share: the confidence bound, JSON lines, CSV |
| `one.mts` | One address through the engine with its points and outlines |
| `disputes.json` | Addresses where official sources disagree: counted apart, neither right nor wrong |

Two rules sit beside the labels: in a Streamlined state, an answer read
exactly from the state's address database is right even where its map
says otherwise (sellers are told to rely on that database); and a disputed
address is neither right nor wrong.

## Working files

All in `artifacts/` (git-ignored):

- `artifacts/bench/pool/sets/<split>/cases.csv` and
  `answers/<split>/official.jsonl`: each set's addresses and the state's
  answer for each.
- `artifacts/bench/boundary/<STATE>/`: `points.csv`, `official.jsonl`, and
  `runs/NAME.jsonl`.
- `artifacts/tuning/` (`$TUNE_DIR`): `replay-<split>.json` and
  `lookups-<split>.json` hold every geocoder and state-lookup answer, asked
  live once; `NAME/<split>/` holds a run's answers.

Geocoder calls cost about $1 per 1,000 addresses the first time a set is
run; later runs replay them. Changing settings, or switching a geocoder off
(`'{"disabledGeocoders":["google","here","mapbox"]}'`: the list replaces the
default), can make the locator ask a geocoder it skipped before, which is a
live call. Geocodio's ZIP+4 lookup is kept only when it finds one, so a
no-match is asked again each trial. `pnpm bench cost` adds up what's
recorded.

What replay can't show: each geocoder's answer is kept after its adapter has
matched it (`src/geocoding/providers/`), so a setting inside an adapter
(street matching, `peliasDuplicateMetres`) needs the geocoders asked live:
a fresh `TUNE_DIR`. Trials run one at a time, since they share the replay
files.

## New sets

New addresses, their official labels and new boundary points are drawn by
the benchmark refresh, an agent's job described in
[docs/maintenance/bench-refresh.md](../../docs/maintenance/bench-refresh.md);
its scripts live in `artifacts/`, not here. Once a set is in
`artifacts/bench/pool/`, `pnpm bench split SPLIT NAME` runs it.
