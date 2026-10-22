#!/usr/bin/env sh
# Deploys a committed revision to the production server and, with --ingest,
# loads the supplemental tax-area polygons there and verifies them.
#
#   scripts/deploy.sh [REV] [--ingest [STATE...]]
#
# 1. Stops if a one-off job (a refresh or ingest, `docker compose run`) is
#    running there: rebuilding under one kills it mid-load.
# 2. Stops if a file under deploy/ or docker-compose.yml was edited on the
#    server since the revision it runs: that edit would be overwritten.
# 3. Backs up the code and settings (not artifacts/ or data/) to /root.
# 4. Unpacks REV (default HEAD) over /opt/opentaxrate, keeping deploy/.env.
# 5. Builds every image (refresh's too), migrates, then restarts the API alone. The database is never
#    recreated, so its data and anything connected to it carry on.
# 6. Waits until the API answers on the server.
# 7. --ingest: downloads the supplemental polygons into artifacts/ and
#    verifies them against the loaded rate files (`opentaxrate ingest`).
set -eu
cd "$(dirname "$0")/.."

host=${OPENTAXRATE_HOST:-opentaxrate}
dir=/opt/opentaxrate
compose="docker compose --env-file deploy/.env -f docker-compose.yml -f deploy/compose.public.yml"

rev=HEAD
if [ $# -gt 0 ] && [ "$1" != "--ingest" ]; then rev=$1; shift; fi
ingest=""
if [ "${1:-}" = "--ingest" ]; then ingest=yes; shift; fi
states="$*"
rev=$(git rev-parse --short "$rev")
on() { ssh "$host" "cd $dir && $*"; }

jobs=$(on "docker ps --filter label=com.docker.compose.oneoff=True --format '{{.Names}}'")
if [ -n "$jobs" ]; then
  echo "Jobs running on $host: $jobs. Deploy once they finish." >&2
  exit 1
fi

deployed=$(on "cat DEPLOYED_REVISION")
for f in $(git ls-tree -r --name-only "$deployed" deploy docker-compose.yml); do
  if ! git show "$deployed:$f" | on "cmp -s - $f"; then
    echo "$f on $host differs from $deployed, the revision it runs: bring that edit into the repo first." >&2
    exit 1
  fi
done

backup=/root/opentaxrate-$deployed-$(date -u +%Y%m%dT%H%M%SZ).tgz
on "tar -C /opt --exclude=opentaxrate/artifacts --exclude=opentaxrate/data -czf $backup opentaxrate"
echo "Backed up $deployed to $host:$backup"

git archive "$rev" | ssh "$host" "tar -x -C $dir"
on "echo $rev > DEPLOYED_REVISION"
# The refresh image runs --ingest and later refreshes: built with the rest.
on "$compose build migrate api refresh && $compose run --rm --no-deps migrate && $compose up -d --no-deps api"

tries=0
until on "curl -fs -o /dev/null http://127.0.0.1:8080/v1/coverage"; do
  tries=$((tries + 1))
  if [ $tries -ge 30 ]; then echo "The API on $host isn't answering after the deploy." >&2; exit 1; fi
  sleep 2
done
echo "Deployed $rev to $host"

if [ -n "$ingest" ]; then
  # shellcheck disable=SC2086
  on "$compose run --rm --no-deps --entrypoint 'node dist/cli.js ingest' refresh $states"
fi
