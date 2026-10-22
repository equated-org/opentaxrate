# Autonomous tax rate maintenance

[← Data maintenance](../data.md) · [Sources](sources.md) · Release log: `client/src/lib/data-releases.json`, published at `/docs/releases`

This is the prompt for a scheduled agent (Claude, Codex) that keeps the
published tax data current. `pnpm rates maintain cron` runs it monthly on the
maintenance server; it can also be run by hand. When a publisher has a new
edition, the agent builds a new release in a database of its own, checks
and benchmarks it, and publishes it only past the gates below: with a
human's approval, or, in an unattended run, on the gates alone. It never
touches production.

Read first: `CLAUDE.md`, [data maintenance](../data.md), [sources](sources.md),
the [refresh note](../context/refresh.html), `scripts/rates` (its
`maintain` steps) and `artifacts/maintenance/` (earlier runs, and
`accepted`: the last approved run's scores).

## Rules

- Production is the human's. Never run `refresh`, `ingest`, `pull --prod` or
  a deploy against it, and never publish without the human's approval of
  this run's report.
- Work only in this run's database (`opentaxrate_maint_<run>`, made by
  `pnpm rates maintain prepare`) and `artifacts/maintenance/<run>/`. Never write
  to the stack's own `opentaxrate` database.
- Official sources only: a state's (or its designated agent's) published
  files, services and notices. Never take a rate from a commercial service;
  those are cross-checks at most.
- When the evidence can't settle a rate, the data must refuse, not guess
  (see `CLAUDE.md`). A source you can't verify is recorded as a gap, not
  loaded.
- Keep geocoder spend under `MAINT_GEOCODE_BUDGET` (default $2 a run; the
  bench replays recorded geocodes, so a normal run spends cents).
- A stage that fails is investigated, not retried blindly. Record what
  failed in the run's `log.txt` and stop.

## 1. Look for new rates and sources

1. List what the newest release was built from: `pnpm rates status` and
   the `release` lines of the last run's `check.tsv` (or prepare one and
   read `baseline.releases` in its database).
2. Check every publication on the [watch list](sources.md#watch-list) for an
   edition newer than that: new Streamlined files, a new Texas quarter, a new
   Missouri quarter, a new Minnesota or Washington quarter, an announced
   change in a hand-kept table (Florida's DR-15DSS, New York's Pub 718,
   Hawaii, Idaho, Mississippi, Pennsylvania, Montana, South Carolina's
   ST-500, Virginia's workbook).
3. Search the web for announced local rate changes taking effect in the
   next two quarters (state revenue department news, "local sales tax rate
   changes effective" notices). For each, find the official source and check
   whether the loaded data has it. A hand-kept table that lacks one is
   updated in its adapter (`src/ingest/states/`), with the publication cited.
4. Look for new official sources (a state's new boundary layer, an archive
   of past editions) as [sources](sources.md#adding-a-source) describes, and
   record what you find there, loaded or not.

If nothing is new and no code changed, report "no new editions" with what
you checked, and stop.

## 2. Build and check the update

```bash
pnpm rates maintain prepare              # newest release into opentaxrate_maint_<run>, migrated, its baseline kept
pnpm rates maintain update               # every source, saved downloads reused (an hour or two)
pnpm rates maintain check                # invariants and the diff from the release: check.txt, check.tsv
KEYS_ENV=path/to/keys.env pnpm rates maintain bench   # fresh official answers + standing sets: bench.txt
```

Files go to `artifacts/maintenance/<run>/`.

- `update` takes states (`pnpm rates maintain update TX MO`) when only they
  changed. Run long stages in the background and check their logs.
- `check` fails on any invariant (a state with no state rate today, a row
  ending before it starts, two editions of an outline in force at once, an
  invalid outline, an implausible rate). Fix the cause; don't publish around
  it.
- Read the diff: `check.txt` by state, every rate in `check.tsv`. Every changed rate in force today should
  trace to a new publication you found in step 1. A change you can't explain
  (a whole state's rates moving, many outlines vanishing, a source file
  going backwards) is a stop.
- `bench` labels points near lines with each state's own service today
  (fresh official answers), then scores the standing boundary, address and
  history sets with recorded geocodes. A set whose wrong answers rise above
  the accepted run's is marked `REGRESSION`: find which answers changed
  (`scripts/tuning/score.py NAME BASE`, `scripts/tuning/boundary/score.py
  NAME BASE`) and whether the state or the data is right before going on.

## 3. Ask a human, or apply the gates

An unattended run (`MAINT_AUTO_PUBLISH=yes`, set by `pnpm rates maintain cron`)
publishes without asking only when all of these hold; otherwise it stops
here, as an attended run does, and leaves the report for a human:

- `check` passed: no failed invariant;
- `bench` shows no `REGRESSION` against the accepted run, and its geocoder
  spend is under budget;
- every changed rate in force today traces to a new official publication
  you found in step 1, and nothing in the diff is unexplained;
- no code change is part of the update (a changed adapter or table goes to
  a human as a commit to review, never straight to a release).

`pnpm rates maintain publish` refuses on its own when the first two fail.

In an attended run, stop here. Report, in this order: what was new and where it came from; the
invariants; the rate changes by state with a few examples traced to their
publications; the bench against the accepted run; anything unexplained;
geocoder spend. Write this as `artifacts/maintenance/<run>/report.md`, and
the release's notes as `notes.md` beside it: a few bullets a reader needs
(which states, cities and rates changed, from when; new sources). Wait for
an explicit approval of this run.

## 4. Publish and record (after approval, or past the gates)

```bash
MAINT_APPROVED=yes pnpm rates maintain publish data-<run>   # or MAINT_AUTO_PUBLISH=yes, unattended
pnpm rates maintain accept                                  # this run's scores become the next run's baseline
```

`notes.md` becomes the release's notes. Then add the release to the release
log, `client/src/lib/data-releases.json`, the one file the public
[/docs/releases](https://opentaxrate.com/docs/releases) page is built from:
first in the list, with its tag, date, release URL, dump name and size
(`gh release view TAG --json url,publishedAt,assets`) and the same bullets.
Commit it and push to `main`. Keep the run's database until production
serves the release, then `pnpm rates maintain drop` it.

Production pulls the release (`pnpm rates pull data-<run> --prod`) only when
the human says so. If this release's migrations are newer than production's
(`pnpm rates status` compares them), the code must be deployed first
(`scripts/deploy.sh`), then pulled.

Only commit the release log (and, attended, a reviewed source change);
never commit `artifacts/` or `data/`. Push to `main` only after
`pnpm typecheck`, the relevant tests, and `pnpm --dir client check` pass.

End every run with a short report: new editions found (or none), what was
built, checked and benched, what waits for approval, and what failed.
