# Data maintenance

[← README](../README.md)

A full load is about 5 GB, mostly street and ZIP+4 ranges. Source data is downloaded from publishers and is not committed to Git.

## Refresh

```bash
docker compose build refresh
docker compose run --rm refresh          # all states
docker compose run --rm refresh OH TX WA # selected states
```

Every file and live answer refresh builds the database from is kept under `artifacts/sources/` (`/artifacts/sources` in Docker), filed by its URL (`www2.census.gov/geo/tiger/TIGER2026/COUNTY/tl_2026_us_county.zip`), with each query or POST in a folder of its own and gzipped. When a file's contents change, the older copy stays beside it in `previous/`, dated; `artifacts/sources/manifest.jsonl` records every fetch. Files read with `--dir` are copied in too, so the folder holds every input either way. A saved file is read back instead of downloading it again: one whose name says its edition (`OHB2026Q4SEP17.zip`, `tl_2026_…`, Missouri's `-q4-2026` files, Arizona's monthly tables, Texas's `taxrates264.txt`) always, any other (Alabama's `taxrates.csv`, Texas's `city-rates.xlsx`) for `OPENTAXRATE_DOWNLOAD_MAX_AGE_HOURS`, 24 by default; `0` downloads those every run. `scripts/backup-sources.sh` backs the folder up to a restic repository in R2 (bucket `opentaxrate-sources`, password `OPENTAXRATE_RESTIC_PASSWORD` in your secret manager); `restic snapshots` lists the dated versions. Use `--download-dir` or `OPENTAXRATE_DOWNLOAD_DIR` to change where `sources/` goes; Docker paths must be mounted. `--dir` selects existing input files instead.

Already-loaded core sources are skipped unless `--force` is used. Downloaded files keep their original names in URL-hash folders. Supplemental GIS responses are archived; some existing core adapters query live GIS/API responses directly. Artifacts are ignored by Git and excluded from snapshots.

Set `OPENTAXRATE_HISTORY_FROM=2024-01-01` to reduce SST/Missouri history and roughly halve the street ranges. Map-state history is kept in full.

Refresh also indexes Missouri tax-district polygons and Utah tax zones for local map fallbacks. Rates still come from the dated DOR/SST files. Missouri’s polygon source is an archived May 2023 MSDIS snapshot; missing district outlines remain unresolved. Answers cite the polygon snapshot used. Missouri tries local data before its optional `STATE_LOOKUPS=MO` fallback. Use `--force` to reload outlines.

Refresh acquires versioned supplemental polygons and validates general-tax features against dated codes/rates, then writes verified shapes/rates into the existing lookup tables. Where every component's code and dated rate is published, a combination the boundary files lack is built as a new area (ids from state FIPS × 1,000,000 + 900,001). A feature that can't be verified is kept as a `held:<source>:<feature>:<from>` coverage marker in `sales_tax_shapes`, with no area or rate: a lookup inside or near one declines (California asks CDTFA instead) rather than fall back to a smaller total. A source that can't be validated leaves what was indexed before in place. Minnesota's and Washington's tax areas are acquired for every published quarter from `OPENTAXRATE_HISTORY_FROM`, each verified and indexed for its own quarter, so a past date reads that quarter's areas. Run `pnpm ingest` for that phase alone. The sources, their roles and the known gaps are listed in `src/ingest/supplemental-sources.ts`. Holidays, caps and customer exemptions are [documented research only](tax-rules.md).

## Taxability rules

Whether a kind of sale is taxed (the API's `code=`) comes from reviewed rule files in `src/taxability/rules/`, one per place (`us-NY.json`, `ca-BC.json`, `ca-federal.json`): each rule names the tax, the code, its dates, the treatment, the conditions it turns on and the official pages it was read from, with the deciding sentence quoted. Change a rule by editing its file in a pull request, with the page that justifies it.

```bash
pnpm ingest --kind taxability            # check the files, archive cited pages, replace taxability_rules
pnpm ingest --kind taxability --no-fetch # the same, fetching nothing; lists pages the archive lacks
pnpm bench taxability                    # score the loaded rules (docs/benchmarks.md)
```

Ingest checks every file before writing (fields, codes, dates, citations, conditions, that a `follows` rule's target exists, and that no two rules for one tax and code cover the same day; the table's own constraints enforce the same), then replaces `taxability_rules` in one transaction. Every cited page is filed in `artifacts/sources/` like any other download, so it is versioned and backed up with the rest; a page is fetched only when the archive has no copy, and one that can't be fetched is listed, not a reason to drop its rule. The table ships in releases like the rate tables; the API reads it once per process.

## Raw sources and backups

`artifacts/sources/` holds every file and live answer refresh builds the database from, and nothing else:

- `<host>/<path>/<file>`: the newest copy, where its URL says, e.g. `www2.census.gov/geo/tiger/TIGER2026/COUNTY/tl_2026_us_county.zip`.
- `<host>/<path>/<query id>/`: one folder per query or POST (map layer pages, lookup pages), gzipped, with `url.txt` saying what was asked.
- `previous/<date>-<id>-<file>` beside a file: its older contents.
- `manifest.jsonl`: one line per fetch (time, URL, file, sha256, bytes, the copy it replaced; for a POST, its method, the body's first 2,000 characters and `bodySha256`, the whole body's hash).
- `KNOWN-BAD.md`: captures kept that aren't what their URL publishes (a "Request Rejected" page saved as a `.zip`, an ArcGIS error answer, an Internet Archive replay page instead of the PDF, a fragment, a script-only app shell), each with its SHA-256 and why. Nothing is deleted.
- `UNINDEXED.md`: files with no manifest line, and why.
- `GAPS.md`: inputs we know of but couldn't get, or got only in part (a scan with no text, an ordinance behind a block), one line each: what, why, and what was searched.

The cited taxability pages are filed here too, like any download. A page downloaded by hand is filed with `taxability file URL PATH`; a saved lookup answer (a POST or query) with `taxability file-answer URL PATH --body-file F`, under its request, its manifest `at` the file's download time and `from` the file it came from.

### Backups

One command backs up every input, versioned:

```bash
pnpm rates backup     # artifacts/sources (tag sources); artifacts/bench, tuning, taxability (tag bench)
```

It makes a dated [restic](https://restic.net) snapshot of each, in the
private R2 bucket `opentaxrate-sources`, and never prunes them, so every
earlier version stays restorable (`restic snapshots`, `restic restore`;
`pnpm bench restore` brings the `bench` tag back). Then it updates the
public mirror of the sources, the [evidence archive](#evidence) (bucket
`opentaxrate-evidence`): the cases and benchmarks never go there. `pnpm
rates publish` (and `maintain publish`) runs it first and stops if it
fails: no release exists without its inputs stored, and no rule it
carries cites a page the public archive lacks.
`pnpm bench backup` is the same command.

It needs `R2_ACCOUNT_ID`, an R2 access key (`OPENTAXRATE_R2_ACCESS_KEY_ID`
and `OPENTAXRATE_R2_SECRET_ACCESS_KEY`, else `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY`) and `OPENTAXRATE_RESTIC_PASSWORD`, taken from the
first of: the environment; `KEYS_ENV`, the file the monthly run reads
(`~/.config/opentaxrate/keys.env` on the maintenance server); or, where
neither has them, `OPENTAXRATE_SECRETS_RUN`, a command prefix that runs a
command with them in its environment (your secret manager's run command,
set in `KEYS_ENV`), under which the backup runs again. A key that can reach only the
backup bucket is safer than a shared one: in the Cloudflare dashboard, R2 →
Manage API tokens → Create API token, *Object Read & Write*, applied to
`opentaxrate-sources` only, stored as the two `OPENTAXRATE_R2_*` values.
`OPENTAXRATE_RESTIC_REPOSITORY` overrides the destination. The script
(`scripts/backup-sources.sh`) ignores unrelated `RESTIC_*` settings, so a
backup cannot land in another repository.

### Evidence

`npx tsx scripts/check-evidence.mts` checks the archive is complete, one line
per promise: every taxability citation has a copy and its quote is on one of
them, every watched page and benchmark case source has a copy (the cases are
read from `taxability/evals*` beside the sources, and a missing corpus fails)
and each case's quote is on one of its source's copies, no cited page rests
only on a known-bad capture, every manifest entry's bytes are on disk with
their hash and size, every file on disk is in the manifest, and every POSTed
answer is keyed by its whole request; every PDF has its text extracted and each quote cited on a
PDF is on one of its pages; and no quote rests on a scan a person hasn't read
(see [below](#pdfs-the-evidence-and-the-views-beside-it)). `--public` also checks each copy is on
evidence.opentaxrate.com. It exits 1 on any failure (the monthly gates run it).

`npx tsx src/cli.ts evidence` mirrors every file in `artifacts/sources/` (older
versions included) to the public R2 bucket `opentaxrate-evidence`, unchanged,
as `sha256/<hash>`, plus `catalog.json`: each URL's captures and the
taxability rules citing it. It uploads only what the bucket lacks, with the
same R2 settings as backups. The Worker in `evidence/` serves it at
[evidence.opentaxrate.com](https://evidence.opentaxrate.com): a readable
view of each page in the site's style (its scripts, styles and menus left
out; made on request, never stored), the raw bytes, every capture of a URL
(`/url?u=`), and the capture in force on a day (`/<YYYYMMDD>/<url>`). Deploy
it from `evidence/` with `wrangler deploy`.

#### PDFs: the evidence, and the views beside it

The PDF's bytes are the evidence. A quote is checked against the PDF's own
text layer as `pdftotext` reads it in reading order (no `-layout`), and every
citation links to that text. Browsers can't scroll a PDF to a quoted sentence,
so the archive shows PDF text beside the PDF. Each page links to the PDF at the
same page. A PDF page can show up to three views (`?view=`), all with the same
`#page-N` anchors:

| View | What it is | Made by | Evidence? |
| --- | --- | --- | --- |
| Text (default) | The text layer in reading order, page by page | `pdftotext`, kept in `artifacts/evidence-text/<sha256>.json` (`pages`) | It's what quotes are checked against; citations link here |
| Layout (columns and tables as printed) | The same text laid out as printed, in monospace and scrolling sideways: tables keep their columns and line-end hyphens stay | `pdftotext -layout`, the same file's `layout` field | No. A two-column page splits each sentence across its columns, so quotes are never checked against it |
| Formatted (machine, unverified) | Table-heavy pages as Markdown tables, only on pages that have one | A model (`scripts/format-tables.mts`), `<sha256>.formatted.json` | No. Machine-made and not reviewed; citations never link to it |

`pdftotext` drops the hyphen where a word or number breaks at a line end
(`39-26-` / `717` reads `39-26717`, `short-` / `term` reads `shortterm`). The
quote check (`quoteOnPage`) therefore falls back to comparing the page and the
quote with hyphens removed on both sides. It loosens nothing else.

A scan has no text layer (`scanned: true`). If a scan has been transcribed, its
page shows the **machine transcription**
(`<sha256>.machine.json`) instead, under the label "Machine transcription by
… not reviewed — check against the PDF; quotes are never checked against
it". Two models read every page:
`google/gemini-3.1-flash-lite` gives the text, and `google/gemini-2.5-flash-lite`
gives a second reading. Every place where they disagree is highlighted, with
both readings. In tests, each model alone made silent errors that changed the
meaning. Comparing two models caught nearly all of them, but not all, so the
transcription is never evidence. A quote on a page whose copies are only scans
must be read off the scan by a person and listed in
`src/taxability/rules/read-off-scans.json` (`[{ "url", "quote", "by", "on" }]`).
Otherwise `check-evidence` fails (check 11). No quote rests on a scan today.

The machine files are derived and cached by the PDF's hash. Each says
`reviewed: false`, the model(s), when it was made and what it cost. `npx tsx
src/cli.ts evidence` uploads them beside the text as `text/<sha256>.json`,
`.machine.json` and `.formatted.json`. It sends a text again when its bytes
have changed, which happened when the layout view was added. To make them
(the key is read from the environment, never from a file):

```bash
export OPENROUTER_API_KEY=…                                    # e.g. from your secret manager
npx tsx scripts/transcribe-scans.mts --budget 2                # every scan not yet transcribed
npx tsx scripts/format-tables.mts --budget 8 [--limit N]       # table pages not yet tried, cited PDFs first
```

Both scripts accept `--dry-run`, which counts what's left without spending
anything. They stop starting pages once their spend, plus the most the calls
still running could cost, would pass `--budget` (US dollars). Each model
reads a page as a one-page PDF (`pdfseparate`) at temperature 0, with its
output capped.

- **Table pages.** `format-tables` treats a page as tabular if its `-layout`
  text has at least 8 lines with two or more gaps of 3+ spaces, meaning three
  or more columns. Prose, even in two columns, has at most one gap a line. It
  keeps a page's Markdown only if all of these hold:
  - it has at least 99% of the text layer's words for that page (counted with
    repeats; case, punctuation and Markdown marks don't count);
  - the model didn't stop at its token cap;
  - it has no more than 3× the page's words.

  Every page tried is recorded with its recall, kept or not, so it is asked
  about only once.
- **Cost.** In November 2026, transcribing the 53 scans (403 pages) with both
  models cost $0.52. Formatting the 1,145 table pages in 193 PDFs cost $2.24;
  889 pages were kept, 227 fell under 99% recall and 29 hit the token cap.
  A new scan or table page costs a fraction of a cent.

### Links

`npx tsx --env-file-if-exists=.env scripts/check-links.mts --db <release database>`
checks every link a reader or API caller can click: the built site
(`pnpm --dir client build` first), `docs/`, the README, every rule's
citation and the `archived` link the API returns for it, and the evidence
archive's pages. It sends a HEAD (a GET when that fails) with a browser
User-Agent, one request a second to a host, and writes
`/tmp/otr-links/report.md`: ok, redirect (with where it lands), broken
(4xx/5xx, no such host, a bad certificate), blocked (a bot challenge or 403:
not the same as gone), timeout and unreachable (a resolver hiccup such as
`EAI_AGAIN`, a refused or reset connection, a failed TLS handshake). A server
that leaves out its intermediate certificate is retried with the one its
certificate names, as browsers do. `--self-test` checks the classes and the
offline merge below without a build or the network.

`--write-offline` also updates `client/src/lib/offline-originals.json`: the
cited originals that are gone (404/410, no such host, a certificate for
another name or expired, or a redirect to a home, error or search page). The
site and the evidence archive name those originals without linking them and
say they are no longer online; the archived copy is the evidence. The update
merges: a gone answer seen once goes to `pending` with its date, and the URL
is listed only when a run at least three days later sees it gone again. A
blocked, timed-out, unreachable or 5xx answer never adds or removes a mark.
A mark, `by hand:` ones included (a retired portal that answers 502
everywhere, a host that takes no connections), is removed only when the run
fetched the page and it answered. URLs a run did not check (`--only`,
`--internal-only`) keep their marks, and such a filtered run leaves the
`checked` date as it was. The list is read at build time, so a change
reaches the site with its next build and the archive with its next
`wrangler deploy`.

Each POSTed query is its own entry, `<url> (POST <first 12 of the body's
SHA-256>)`, hashed over the whole body (an empty body too; a bodyless POST is
`<url> (POST)`), so requests alike for their first 2,000 characters, such as
Colorado's rate queries for different dates, are never taken for versions of
one. Where a manifest line predates `bodySha256`, the body is read back from
the query's `url.txt` only when that file is this request's (same method and
URL, starting with the line's prefix, hashing to the query folder's id);
otherwise the answer is filed under `<url> (POST, whole body not kept: answer
<hash>)`, never merged with another request, and check 8 fails. A capture
listed in `KNOWN-BAD.md` carries `bad` in the catalog (`"request rejected"`,
`"error answer"`, …) and is typed by its bytes, not its name; the Worker says
so on the capture, in other captures' lists and in `/url`, and a dated
address (`/<YYYYMMDD>/<url>`) goes to the last good capture on or before the
day.

Each capture's file is found by its hash, never trusted from the manifest's
path: a path filed again holds its newest bytes, and older ones are in
`previous/`. The catalog and `copiesByUrl` order a URL's captures by capture
time and keep a run of identical bytes once, at its earliest time, so an
answer filed later but downloaded earlier dates its run, and a page that
changed and changed back is three captures. The archive's hashes are kept in
`artifacts/cache/source-hashes.json` (derived; a file is hashed again when
its size, times or inode change).

Pages are read as text (`pageText`) in their own encoding: a byte-order mark's,
UTF-16 without one (a Word page saved as HTML), else UTF-8, with any byte that
isn't valid UTF-8 read in the page's declared single-byte encoding or
windows-1252, so no U+FFFD stands in for a curly quote. A Word 97–2003 `.doc`
is read with `antiword` or `catdoc` where installed, else straight from the
file (every run of windows-1252 and UTF-16LE text, as `strings` would; the
file's style and font names come along as lines of their own).

**Live lookups are not archived per request.** Some answers are read from a
state's service when the request is made, not from loaded data: California
asks CDTFA's rate API (`GetRateByAddress`, `GetRateByLngLat`) where its
outlines decline; and, where `STATE_LOOKUPS` names them (off by default),
Missouri's DOR lookup and Colorado's and Alaska's rate services answer at
the point (`src/rates/california.ts`, `src/rates/state-lookups.ts`). Those
answers are not saved, so the evidence archive has no copy of any one of
them; the answer's `source` names the service asked. What is archived
instead: the bulk inputs those states' loaded data come from (California's
tax-area layers, Missouri's quarterly DOR files, and every Colorado and
Alaska request refresh made, each with its date, URL, body and hash). The
benchmark's labels from the same services are kept too, but privately, in
the `bench` backup, not in the public archive.

## Snapshots and releases

`scripts/rates` (also `pnpm rates`) moves the published data between this machine, GitHub Releases and production. Data reaches production only as a release: load and benchmark it locally, publish it, then pull it. Never refresh or ingest on the server.

```bash
pnpm rates status                      # newest release; what production runs and serves
pnpm rates snapshot [--check]          # this stack's data to data/opentaxrate-DATE.dump
pnpm rates publish [TAG]               # snapshot, then GitHub Release TAG (default data-DATE)
pnpm rates pull TAG --prod             # load release TAG into production
pnpm rates pull TAG --local [--db D]   # load it into this stack (database D), to try it first
pnpm rates load DUMP [--db D]          # replace this stack's published data with DUMP's
pnpm rates install DUMP|URL            # fill a new, empty install from a dump
pnpm rates restore TAG|DUMP --db D     # a release into a new database D, to update or inspect it
pnpm rates maintain STEP               # a maintenance run (below)
```

`snapshot` and `publish` take `--db D` to dump another database than the
stack's own; `publish` puts `RELEASE_NOTES` (a file) first in the release's
notes.

## Benchmark data

The benchmark's dev addresses and points are public in
[equated-org/opentaxrate-bench](https://github.com/equated-org/opentaxrate-bench),
one tag a version; `bench/benchmark.json` pins the version and names the dev
and eval splits. `pnpm bench fetch` downloads it into `artifacts/bench`. The
eval splits, recorded geocodes and other services' answers stay private, in
the same restic repository as the sources under the tag `bench`
([backups](#backups)); `pnpm bench restore` brings them back. `pnpm bench publish` exports a new version,
refusing if any eval address would be in it.

## Maintenance runs

New editions reach a release through a maintenance run, by hand or monthly
by an agent: [cron.md](maintenance/cron.md) is its prompt and
[sources.md](maintenance/sources.md) the sources it watches. `pnpm rates
maintain prepare` restores the newest release into `opentaxrate_maint_<run>`
and migrates it; `update` refreshes and ingests into it; `check` tests
invariants and lists what changed from the release; `bench` asks the states'
own services about fresh points and scores the standing benchmark sets;
`publish TAG` releases it only past those gates and with approval; `accept`
makes its scores the next run's baseline; `cron` is the unattended monthly
run. Every published release is listed, with what changed, on the site's
[data releases](https://opentaxrate.com/docs/releases) page, built from
`client/src/lib/data-releases.json`.

**What a snapshot holds.** The published data (`TAX_TABLES` in `scripts/rates`: rates, jurisdictions, areas and shapes, street and ZIP ranges, ZIP street lists, supplemental source polygons, taxability rules) plus the migration history. Every other table (`EMPTY_TABLES`: accounts, keys, request history, credit, the geocoding cache) is dumped empty. A table in neither list stops the snapshot, so nothing new reaches a dump by default; `snapshot --check` runs that check and the one below without dumping. Transaction-policy research is excluded, and a database holding experimental policy snapshots is refused, so their metadata can't leak through the source table.

**Publishing** needs `gh auth login`; check `/v1/coverage` and benchmark first. It never overwrites a release: give a new tag to publish again the same day. Each release has the dump and its SHA-256.

**Pulling** downloads the release here (the repository is private and the server has no GitHub login), checks its SHA-256 (downloading again once if it fails), copies it to the server unless the same file is there, and runs `scripts/rates load` there. It stops if the deployed revision has no `scripts/rates` or a refresh or ingest job is running. The server's `DATA_RELEASE` then names the release it serves.

**Loading** replaces the published-data tables and nothing else, so accounts, keys, request history, credit and the geocoding cache are kept. It is idempotent: loading the same dump twice leaves the same rows and sequence positions. It refuses a dump whose migrations differ from the database's (deploy the revision the dump was made with first). Everything happens in one transaction, about 75 s for every state: lookups wait meanwhile, and a failure anywhere rolls it all back. It then refreshes the planner's statistics and restarts a running API, whose caches hold answers from the old data.

**Installing** is for a new, empty database: it replaces every table the dump holds, accounts included, so it refuses a database with accounts, requests or credit. Never use it on production; use `pull` there. A release URL downloads without a login only while the repository is public; otherwise `gh release download TAG` first and give the file.

```bash
pnpm rates install https://github.com/equated-org/opentaxrate/releases/download/data-2026-10-22-regions/opentaxrate-2026-10-22.dump
docker compose up -d
```

**Who can do what.** Only the repository's maintainers (a GitHub login with write access) publish releases or pull into production. Anyone else gets a plain refusal before anything is dumped, downloaded or uploaded. The script's check is only a courtesy: the real limits are GitHub's write permission on the repository and SSH access to the production host. `status`, `pull --local` and `load` work for anyone who can read the releases.

Set `COMPOSE` for a stack with another compose command, and `OPENTAXRATE_HOST` for another production host. `OPENTAXRATE_REPO` sets the releases' repository.
