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

Refresh acquires versioned supplemental polygons and validates general-tax features against dated codes/rates, then writes verified shapes/rates into the existing lookup tables. Where every component's code and dated rate is published, a combination the boundary files lack is built as a new area (ids from state FIPS × 1,000,000 + 900,001). A feature that can't be verified is kept as a `held:<source>:<feature>:<from>` coverage marker in `sales_tax_shapes`, with no area or rate: a lookup inside or near one declines (California asks CDTFA instead) rather than fall back to a smaller total. A source that can't be validated leaves what was indexed before in place. Run `pnpm ingest` for that phase alone. The sources, their roles and the known gaps are listed in `src/ingest/supplemental-sources.ts`. Product taxability, holidays, caps and exemptions are [documented research only](tax-rules.md), with no policy importer, API support or policy data in public exports.

## Raw sources and backups

`artifacts/sources/` holds every file and live answer refresh builds the database from, and nothing else:

- `<host>/<path>/<file>`: the newest copy, where its URL says, e.g. `www2.census.gov/geo/tiger/TIGER2026/COUNTY/tl_2026_us_county.zip`.
- `<host>/<path>/<query id>/`: one folder per query or POST (map layer pages, lookup pages), gzipped, with `url.txt` saying what was asked.
- `previous/<date>-<id>-<file>` beside a file: its older contents.
- `manifest.jsonl`: one line per fetch (time, URL, file, sha256, bytes, the copy it replaced).

Use [restic](https://restic.net) with your own R2 credentials to back up the folder.
Set `R2_ACCOUNT_ID`, `OPENTAXRATE_R2_ACCESS_KEY_ID`,
`OPENTAXRATE_R2_SECRET_ACCESS_KEY` and `OPENTAXRATE_RESTIC_PASSWORD`
in your environment or secret manager. Use `OPENTAXRATE_RESTIC_REPOSITORY`
to override the destination.

```bash
scripts/backup-sources.sh artifacts/sources
```

The script creates dated snapshots without pruning them. It ignores unrelated
`RESTIC_*` settings so a source backup cannot accidentally use another repository.

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
```

**What a snapshot holds.** The published data (`TAX_TABLES` in `scripts/rates`: rates, jurisdictions, areas and shapes, street and ZIP ranges, ZIP street lists, supplemental source polygons) plus the migration history. Every other table (`EMPTY_TABLES`: accounts, keys, request history, credit, the geocoding cache, rule rows) is dumped empty. A table in neither list stops the snapshot, so nothing new reaches a dump by default; `snapshot --check` runs that check and the one below without dumping. Transaction-policy research is excluded, and a database holding experimental policy snapshots is refused, so their metadata can't leak through the source table.

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
