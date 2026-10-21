#!/usr/bin/env sh
# Loads a snapshot (a path, or a URL to download) in place of the data, so a
# new install skips the first refresh.
#   scripts/restore.sh https://github.com/OWNER/opentaxrate/releases/download/2026-10/opentaxrate-2026-10-21.dump
set -eu
src="$1"
if [ "${src#http}" != "$src" ]; then
  mkdir -p data
  curl -fL "$src" -o data/restore.dump
  src=data/restore.dump
fi
docker compose up -d db
docker compose exec -T db pg_restore -U opentaxrate -d opentaxrate --clean --if-exists --no-owner < "$src"
echo "restored $src"
