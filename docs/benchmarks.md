# Benchmarks

[← README](../README.md)

We compare OpenTaxRate's combined rates with official state answers. Results
separate correct rates, wrong rates, and declined lookups.

## Published results

| Test | Tested | Correct | Wrong | Declined |
|---|---|---:|---:|---:|
| Development addresses | 2026-10-23 | 5,301 / 5,317 | 4 | 12 |
| Held-out comparison (`evalA`) | 2026-10-22 | 275 / 277 | 0 | 2 |

Development addresses guide improvements. The held-out comparison is a
separate sample, run with geocoding providers and no live state lookup.
See the [provider comparison](https://opentaxrate.com/benchmarks) for its
configuration and results with self-hosted geocoders only.

## The sets

| Set | Size | What it measures |
|---|---|---|
| Development addresses | about 5,300 labelled | geocoding, address ranges, maps and refusals |
| Held-out addresses | about 2,000 across private eval splits | the pipeline on addresses reserved from tuning |
| History | about 1,070 labelled | addresses on past dates (2024–2025) |
| Typos | 373 | addresses typed with mistakes |
| Boundary points | 2,836 point-dates in TX, CO, AK, AZ, VA, SC | rates and jurisdiction breakdowns near lines, without geocoding |
| Taxability | about 600 sales in every state, DC and every province | whether a kind of sale (the `code` parameter) is taxed, against the agencies' own worked examples |

Addresses are sampled from the USDOT National Address Database,
OpenStreetMap, Mississippi's parcels and OpenAddresses across all states.
The public development datasets are in
[opentaxrate-bench](https://github.com/equated-org/opentaxrate-bench);
[bench/benchmark.json](../bench/benchmark.json) pins their version and splits.[^public]

## A quick check, with nothing to install

```bash
node scripts/spot-check.mjs              # 30 random public dev addresses, hosted API, no key
node scripts/spot-check.mjs --n 100 --seed 7 --api http://localhost:8080
```

[spot-check.mjs](../scripts/spot-check.mjs) downloads the pinned public dataset,
asks an API about a seeded random sample on each case's own date, and scores the
answers with the same tolerance as below. Without `OPENTAXRATE_API_KEY` it paces
itself to the public limit (10 a minute) and uses only the hosted geocoders, so
it declines more than the published runs. Dev addresses were tuned on; treat the
result as a sanity check, not a held-out score.

## How to benchmark

Requires Node 22+, pnpm, and the [local database setup](../README.md#development).
Use a disposable local database: pulling a release replaces its tax data.

```bash
pnpm bench fetch                          # pinned public development sets
pnpm rates pull TAG --local                # choose a published data release
KEYS_ENV=keys.env pnpm bench all base       # development, history, boundary
```

Make the change, then run and compare:

```bash
KEYS_ENV=keys.env pnpm bench all mine
pnpm bench compare mine-dev base-dev dev
pnpm bench compare mine-history base-history history
pnpm bench compare mine base boundary
```

Keep a change only if wrong answers do not rise in any set. Inspect individual
misses with `LIST=1 pnpm bench compare mine-dev base-dev dev`; missing
answers mean an incomplete run. Run one trial at a time.

| Command | Use |
|---|---|
| `pnpm bench dev NAME [SETTINGS]` | development addresses |
| `pnpm bench history NAME [SETTINGS]` | past dates |
| `pnpm bench boundary NAME [SETTINGS]` | boundary points; `MARGIN=15` metres by default |
| `pnpm bench split batch-dev-typos NAME` | typo set, separate from `all` |
| `pnpm bench eval NAME` | private held-out sets; once after tuning, when available |
| `pnpm bench taxability [--list]` | the taxability rules against the taxability cases; no database or geocoder |
| `pnpm bench cost` | recorded geocoder spend |

`SETTINGS` is a JSON override, e.g. `'{"breakdownMarginMetres":30}'`.
The first run can call external geocoders; later runs reuse recorded answers.
Check provider settings and costs before starting.[^replay]

## Scoring and limits

A correct combined rate does not establish a correct jurisdiction breakdown.
Boundary scoring reports breakdown differences separately. Boundary points
stress difficult cases; their refusal rate is not a forecast of normal traffic.

<details>
<summary>Scoring rules, dependencies and reproduction</summary>

- **Tolerance:** the absolute rate difference must be less than `0.00005`
  (0.005 percentage points).
- **Official-source conflicts:** an exact SST street-range match can count as
  correct even when the state's map label differs. The scorer reports these
  separately as “right by the address database.”
- **Disputes:** cases in [disputes.json](../scripts/tuning/disputes.json) are
  counted separately and excluded from the scored denominator. Unlabelled
  cases are not scored; missing run answers are reported separately.
- **Uncertainty:** scorers report the one-sided 95% Clopper–Pearson upper
  bound on wrong rates among answered cases. Zero observed wrong answers
  does not establish a zero error rate.
- **Shared sources:** ingestion and labels can use the same official data.
  Alaska, Colorado and Missouri have Avalara-operated official lookups;
  the provider comparison discloses this dependency. This is agreement with
  official answers, not an independent tax audit.
- **Reproduction:** record the code commit, data release, benchmark version,
  run name, provider configuration, settings, boundary margin and replay
  files used. Public data alone cannot reproduce the private held-out test
  or guarantee identical live geocoder results.

The address scorer is [score.ts](../scripts/tuning/score.ts); boundary scoring
is [boundary/score.ts](../scripts/tuning/boundary/score.ts). See
[source coverage](maintenance/sources.md) for dated-data limits and
[benchmark refresh](maintenance/bench-refresh.md) for sampling and labelling.

</details>

[^public]: Held-out sets, recorded geocodes, state-lookup replays and other providers' raw answers remain private. Rows without a redistribution licence publish source references rather than address text; `fetch` skips these, so a public run can have fewer addresses than the full development run.

[^replay]: `KEYS_ENV` names an optional local credentials file; never commit it. The trial runner uses enabled providers with `STATE_LOOKUPS=MO` and Nominatim disabled. Replays live in `artifacts/tuning` (`TUNE_DIR` overrides it); a maintainer with backup credentials can use `pnpm bench restore`. Changes inside geocoder adapters need fresh calls because replays store already-matched answers; use a new `TUNE_DIR`. See [tuning notes](../scripts/tuning/README.md).

## Taxability

`artifacts/taxability/evals/` holds one sale per case, taken from a tax
agency's own worked example or statement, with the sentence that settles it
quoted word for word: the code it falls under (`src/taxability/codes.ts`),
the date, and what each tax does with it. `dev/` is the development set, one
file per state, DC, province and territory; the top-level `us.json` and
`canada.json` were the first cases written. Like the other sets it lives
outside the repository and is backed up by `pnpm rates backup` (the rule
research it was written against is beside it, in `artifacts/taxability/rules/`).
The cases are written apart from the rules in `src/taxability/rules/` and
never read them, so a rule and its test can't share a misreading.

`pnpm bench taxability` scores every case: *right* when every tax comes out
as the source says; *wrong* when a tax is charged that the source says isn't,
or the reverse; *kind* when the amount agrees but zero-rated and exempt are
swapped; *declined* when the rule is conditional and the code doesn't carry
the deciding fact; *not researched* when no rule covers the place, code and
date. Keep a rule change only if *wrong* doesn't rise. Add a case by copying
an agency example into the place's file; a new case that scores *wrong* is
settled by reading the page, not by editing the case.

