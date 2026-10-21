#!/usr/bin/env sh
# Writes the loaded data to data/opentaxrate-YYYY-MM-DD.dump (custom format,
# compressed; about 570 MB with every state), for a release download.
set -eu
mkdir -p data
out="data/opentaxrate-$(date +%F).dump"
docker compose exec -T db pg_dump -U opentaxrate -Fc -Z 6 opentaxrate > "$out"
ls -lh "$out"
