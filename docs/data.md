# Data maintenance

[← README](../README.md)

A full load is about 5 GB, mostly street and ZIP+4 ranges. Source data is downloaded from publishers and is not committed to Git.

## Refresh

```bash
docker compose build refresh
docker compose run --rm refresh          # all states
docker compose run --rm refresh OH TX WA # selected states
```

Every file and live answer refresh builds the database from is kept under `artifacts/sources/` (`/artifacts/sources` in Docker), filed by its URL (`www2.census.gov/geo/tiger/TIGER2026/COUNTY/tl_2026_us_county.zip`), with each query or POST in a folder of its own and gzipped. When a file's contents change, the older copy stays beside it in `previous/`, dated; `artifacts/sources/manifest.jsonl` records every fetch. Files read with `--dir` are copied in too, so the folder holds every input either way. A saved file is read back instead of downloading it again: one whose name says its edition (`OHB2026Q4SEP17.zip`, `tl_2026_…`, Missouri's `-q4-2026` files, Arizona's monthly tables, Texas's `taxrates264.txt`) always, any other (Alabama's `taxrates.csv`, Texas's `city-rates.xlsx`) for `OPENTAXRATE_DOWNLOAD_MAX_AGE_HOURS`, 24 by default; `0` downloads those every run. `scripts/backup-sources.sh` backs the folder up to a restic repository in R2 (bucket `opentaxrate-sources`, password `OPENTAXRATE_RESTIC_PASSWORD` in your secret manager); `restic snapshots` lists the dated versions. `scripts/organize-sources.ts` moves files saved in the older per-URL-hash folders into `sources/`. Use `--download-dir` or `OPENTAXRATE_DOWNLOAD_DIR` to change where `sources/` goes; Docker paths must be mounted. `--dir` selects existing input files instead.

Already-loaded sources are skipped unless `--force` is used. Downloaded files keep their original names in URL-hash folders; live GIS/API responses are not archived. Artifacts are ignored by Git and excluded from snapshots.

Set `OPENTAXRATE_HISTORY_FROM=2024-01-01` to reduce SST/Missouri history and roughly halve the street ranges. Map-state history is kept in full.

Refresh also indexes Missouri tax-district polygons and Utah tax zones for local map fallbacks. Rates still come from the dated DOR/SST files. Missouri’s polygon source is an archived May 2023 MSDIS snapshot; missing district outlines remain unresolved. Answers cite the polygon snapshot used. Missouri tries local data before its optional `STATE_LOOKUPS=MO` fallback. Use `--force` to reload outlines.

Refresh acquires versioned supplemental polygons and reconciles general-tax features against dated codes/rates before lookup can use them. Run `pnpm ingest` for that phase alone, or `pnpm reconcile` for already-loaded evidence. See the [approved sources, date windows and remaining holds](research/source-reconciliation-2026-10-22.md). Product taxability, holidays, caps and exemptions are [documented research only](tax-rules.md), with no policy importer, API support or policy data in public exports.

## Raw sources and backups

`artifacts/sources/` holds every file and live answer refresh builds the database from, and nothing else:

- `<host>/<path>/<file>`: the newest copy, where its URL says, e.g. `www2.census.gov/geo/tiger/TIGER2026/COUNTY/tl_2026_us_county.zip`.
- `<host>/<path>/<query id>/`: one folder per query or POST (map layer pages, lookup pages), gzipped, with `url.txt` saying what was asked.
- `previous/<date>-<id>-<file>` beside a file: its older contents.
- `manifest.jsonl`: one line per fetch (time, URL, file, sha256, bytes, the copy it replaced).
- `_unknown-url/<hash>/`: pages saved before URLs were recorded.

Files saved in the older per-URL-hash folders (`artifacts/<sha256>/`) move in with:

```bash
npx tsx scripts/organize-sources.ts artifacts --dry-run   # then without --dry-run
# other folders: --hashed <dir> for hash folders, --loose <dir> for loose copies
```

The folder is backed up with [restic](https://restic.net) to R2, bucket `opentaxrate-sources`. Each run is a dated snapshot that stores only what changed, and nothing is ever pruned. The credentials are in your production secret manager: `R2_ACCOUNT_ID`, `OPENTAXRATE_R2_ACCESS_KEY_ID` and `OPENTAXRATE_R2_SECRET_ACCESS_KEY` (a token for this bucket only; `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` stand in until it exists), and `OPENTAXRATE_RESTIC_PASSWORD`.

```bash
cd /path/to/secret-manager-project

# Back up
infisical run --env=prod -- sh /path/to/opentaxrate/scripts/backup-sources.sh /path/to/opentaxrate/artifacts/sources

# List, browse or restore snapshots
infisical run --env=prod -- sh -c '
  export AWS_ACCESS_KEY_ID="${OPENTAXRATE_R2_ACCESS_KEY_ID:-$R2_ACCESS_KEY_ID}"
  export AWS_SECRET_ACCESS_KEY="${OPENTAXRATE_R2_SECRET_ACCESS_KEY:-$R2_SECRET_ACCESS_KEY}"
  export AWS_DEFAULT_REGION=auto
  export RESTIC_REPOSITORY="s3:https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com/opentaxrate-sources"
  export RESTIC_PASSWORD="$OPENTAXRATE_RESTIC_PASSWORD"
  restic snapshots                       # or: restic ls latest
                                         # or: restic restore <id> --target /tmp/sources-<date>
'
```

Always set `RESTIC_REPOSITORY` and `RESTIC_PASSWORD` from the `OPENTAXRATE_*` values, as above. Inherited `RESTIC_REPOSITORY` and `RESTIC_PASSWORD` may belong to unrelated backups (bucket `unrelated-backups`), and a command that inherits them writes there. `backup-sources.sh` ignores them and prints the repository it writes to.

## Snapshots

For a new installation, restore a published snapshot instead of refreshing:

```bash
scripts/restore.sh https://github.com/equated-org/opentaxrate/releases/download/data-2026-10-22/opentaxrate-2026-10-22.dump
```

Snapshots replace the included tables. They contain tax data and migrations, with account, key, request, credit, and geocoding tables empty. Restore refuses databases with accounts or keyed lookups.

To verify a downloaded dump, download its `.sha256` asset alongside it and run:

```bash
sha256sum -c opentaxrate-YYYY-MM-DD.dump.sha256
scripts/restore.sh opentaxrate-YYYY-MM-DD.dump
```

To publish the currently loaded database, authenticate with `gh auth login`, check `/v1/coverage`, then run:

```bash
scripts/publish.sh # release data-YYYY-MM-DD with dump + SHA-256
```

Publishing does not refresh data or overwrite existing releases. Supply a new tag to publish again the same day. Set `COMPOSE_PROJECT_NAME` if the stack uses a custom project name. Private releases require authenticated `gh release download` before restoring.
