#!/usr/bin/env sh
# Back up raw sources (or, with BACKUP_TAG, other folders) to a restic
# repository in R2; unchanged files are deduplicated.
# Usage: scripts/backup-sources.sh [dir...]
#        scripts/backup-sources.sh --restore DIR   the newest BACKUP_TAG snapshot into DIR
# BACKUP_TAG tags the snapshot (default sources; the benchmark's is bench,
# from `pnpm bench backup`), so one repository holds both, apart.
# Set R2_ACCOUNT_ID, OPENTAXRATE_R2_ACCESS_KEY_ID,
# OPENTAXRATE_R2_SECRET_ACCESS_KEY and OPENTAXRATE_RESTIC_PASSWORD in your environment.
# OPENTAXRATE_RESTIC_REPOSITORY overrides the default source-backup repository.
# Ignore unrelated RESTIC_* and AWS_* settings inherited from the environment.
set -eu
cd "$(dirname "$0")/.."

: "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID}"
export AWS_ACCESS_KEY_ID="${OPENTAXRATE_R2_ACCESS_KEY_ID:-${R2_ACCESS_KEY_ID:?set OPENTAXRATE_R2_ACCESS_KEY_ID}}"
export AWS_SECRET_ACCESS_KEY="${OPENTAXRATE_R2_SECRET_ACCESS_KEY:-${R2_SECRET_ACCESS_KEY:?set OPENTAXRATE_R2_SECRET_ACCESS_KEY}}"
export AWS_DEFAULT_REGION=auto
export RESTIC_REPOSITORY="${OPENTAXRATE_RESTIC_REPOSITORY:-s3:https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com/opentaxrate-sources}"
export RESTIC_PASSWORD="${OPENTAXRATE_RESTIC_PASSWORD:?set OPENTAXRATE_RESTIC_PASSWORD}"
unset RESTIC_PASSWORD_FILE RESTIC_PASSWORD_COMMAND RESTIC_REPOSITORY_FILE
echo "Backing up to $RESTIC_REPOSITORY"

if [ "${1:-}" = --restore ]; then
  target=${2:?--restore needs a folder}
  restic restore latest --tag "${BACKUP_TAG:-sources}" --target "$target"
  exit
fi
[ $# -gt 0 ] || set -- artifacts/sources
for dir in "$@"; do [ -d "$dir" ] || { echo "No folder at $dir" >&2; exit 1; }; done

restic cat config > /dev/null 2>&1 || restic init
restic backup "$@" --tag "${BACKUP_TAG:-sources}" --host "${RESTIC_HOST:-$(hostname)}" --exclude '*.partial'
restic snapshots --tag "${BACKUP_TAG:-sources}" --latest 1 --compact
