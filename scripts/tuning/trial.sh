#!/usr/bin/env bash
# One configuration of the engine's settings on labelled pool splits, set up
# like production (every enabled geocoder, STATE_LOOKUPS=MO), with geocodes
# and state lookups replayed: each is asked live once, then answered from
# $TUNE_DIR, so a trial costs nothing after the first.
#
#   scripts/tuning/trial.sh NAME ['{"setting":value}']
#
# NAME names the run (its answers go to $TUNE_DIR/NAME/<split>); the JSON is
# OTR_PARAMS (src/params.ts). Environment:
#   SPLITS     splits to run (default: the dev splits)
#   TUNE_DIR   working folder (default: artifacts/tuning, git-ignored)
#   KEYS_ENV   an extra env file with geocoder keys, read after .env
#   DROP       variables to unset, e.g. DROP=MAPBOX_ACCESS_TOKEN
#   EXTRA      variables to set, e.g. EXTRA=CENSUS_DISABLED=true
#   DATABASE_URL  (default: the local Docker database on port 5433)
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
NAME=$1; PARAMS_JSON=${2:-}
TUNE_DIR=${TUNE_DIR:-$ROOT/artifacts/tuning}
POOL=$ROOT/artifacts/bench/pool
SPLITS=${SPLITS:-batch1 batch-dev batch2 batch3 batch4 batch5 round2}
DB=${DATABASE_URL:-postgres://opentaxrate:opentaxrate@localhost:5433/opentaxrate}
mkdir -p "$TUNE_DIR"
# Trials share the replay files, which each rewrites as answers arrive: one
# at a time.
exec 9>"$TUNE_DIR/.lock"
flock -n 9 || { echo "Another trial is running in $TUNE_DIR" >&2; exit 1; }
n=0; finished=0
for split in $SPLITS; do
  n=$((n + 1))
  dir=$TUNE_DIR/$NAME/$split; rm -rf "$dir"; mkdir -p "$dir"
  ( cd "$ROOT"; set -a; [ -f .env ] && . ./.env; [ -n "${KEYS_ENV:-}" ] && . "$KEYS_ENV"; set +a
    unset TX_CPA_CLIENT_ID TX_CPA_CLIENT_SECRET STRIPE_SECRET_KEY NOMINATIM_URL ${DROP:-}
    [ -n "${EXTRA:-}" ] && export ${EXTRA}
    # A replayed answer mustn't count against today's cap; a live call over
    # the provider's own quota just fails, and a failure isn't kept.
    export STATE_LOOKUPS=MO OTR_PARAMS="$PARAMS_JSON" DATABASE_URL="$DB" GEOCODIO_DAILY_CAP=1000000 NOMINATIM_DISABLED=true
    # One replay file per split: they're rewritten as new answers arrive.
    export BENCH_GEOCODE_REPLAY=$TUNE_DIR/replay-$split.json BENCH_LOOKUP_REPLAY=$TUNE_DIR/lookups-$split.json
    export BENCH_CASES=$POOL/sets/$split BENCH_ANSWERS=$dir
    npx tsx scripts/bench.ts ask opentaxrate-dev --per-state 99 --budget 5000 > "$dir.log" 2>&1 ) &
done
wait
for split in $SPLITS; do grep -q ' kept$' "$TUNE_DIR/$NAME/$split.log" && finished=$((finished + 1)); done
echo "$NAME: $finished/$n splits finished"
[ "$finished" = "$n" ]
