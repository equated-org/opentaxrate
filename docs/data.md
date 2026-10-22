# Data maintenance

[← README](../README.md)

A full load is about 5 GB, mostly street and ZIP+4 ranges. Source data is downloaded from publishers and is not committed to Git.

## Refresh

```bash
docker compose build refresh
docker compose run --rm refresh          # all states
docker compose run --rm refresh OH TX WA # selected states
```

Downloads are saved under `artifacts/`, mounted as `/artifacts` in Docker, and read back instead of downloading again: a file whose name says its edition (`OHB2026Q4SEP17.zip`, `tl_2026_…`, Missouri's `-q4-2026` files, Arizona's monthly tables, Texas's `taxrates264.txt`) always, any other (Alabama's `taxrates.csv`, Texas's `city-rates.xlsx`) for `OPENTAXRATE_DOWNLOAD_MAX_AGE_HOURS`, 24 by default; `0` downloads those every run. Use `--download-dir` or `OPENTAXRATE_DOWNLOAD_DIR` to change the destination; Docker paths must be mounted. `--dir` selects existing input files instead.

Already-loaded sources are skipped unless `--force` is used. Downloaded files keep their original names in URL-hash folders; live GIS/API responses are not archived. Artifacts are ignored by Git and excluded from snapshots.

Set `OPENTAXRATE_HISTORY_FROM=2024-01-01` to reduce SST/Missouri history and roughly halve the street ranges. Map-state history is kept in full.

Refresh also indexes Missouri tax-district polygons and Utah tax zones for local map fallbacks. Rates still come from the dated DOR/SST files. Missouri’s polygon source is an archived May 2023 MSDIS snapshot; missing district outlines remain unresolved. Answers cite the polygon snapshot used. Missouri tries local data before its optional `STATE_LOOKUPS=MO` fallback. Use `--force` to reload outlines.

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
