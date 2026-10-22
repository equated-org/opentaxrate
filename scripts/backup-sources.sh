#!/usr/bin/env sh
# Back up raw sources to a restic repository in R2; unchanged files are deduplicated.
# Usage: scripts/backup-sources.sh [sources-dir]
# Set R2_ACCOUNT_ID, OPENTAXRATE_R2_ACCESS_KEY_ID,
# OPENTAXRATE_R2_SECRET_ACCESS_KEY and OPENTAXRATE_RESTIC_PASSWORD in your environment.
# OPENTAXRATE_RESTIC_REPOSITORY overrides the default source-backup repository.
# Ignore unrelated RESTIC_* and AWS_* settings inherited from the environment.
set -eu
cd "$(dirname "$0")/.."

: "${R2_ACCOUNT_ID:?set R2_ACCOUNT_ID}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-${R2_ACCESS_KEY_ID:?set R2_ACCESS_KEY_ID}}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-${R2_SECRET_ACCESS_KEY:?set R2_SECRET_ACCESS_KEY}}"
export AWS_DEFAULT_REGION=auto
export RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-s3:https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com/opentaxrate-sources}"
export RESTIC_PASSWORD="${RESTIC_PASSWORD:-${OPENTAXRATE_RESTIC_PASSWORD:?set OPENTAXRATE_RESTIC_PASSWORD}}"

sources="${1:-artifacts/sources}"
[ -d "$sources" ] || { echo "No sources folder at $sources" >&2; exit 1; }

restic cat config > /dev/null 2>&1 || restic init
restic backup "$sources" --tag sources --host "${RESTIC_HOST:-$(hostname)}" --exclude '*.partial'
restic snapshots --latest 1 --compact
