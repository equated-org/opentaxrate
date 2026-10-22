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
attempt=0
until docker compose exec -T db pg_isready -U opentaxrate -d opentaxrate > /dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "Database did not become ready." >&2
    exit 1
  fi
  sleep 1
done
# A snapshot replaces every table it holds, accounts and request history
# included (as empty tables), so it's for a new database. Refuse one that
# has accounts or keyed lookups in it.
in_use=$(docker compose exec -T db psql -U opentaxrate -d opentaxrate -At -v ON_ERROR_STOP=1 -c "
  select coalesce(sum(n), 0) from (
    select (xpath('//n/text()', query_to_xml(format('select count(*) as n from %I', t), false, false, '')))[1]::text::bigint as n
    from unnest(array['user', 'api_requests', 'credit_grants']) t
    where to_regclass(format('public.%I', t)) is not null
  ) counts")
if [ "$in_use" != "0" ]; then
  echo "This database has $in_use account, request or credit rows; a snapshot would erase them. Restore into a new database." >&2
  exit 1
fi
# Table-selected snapshots carry migration history but not its parent schema.
docker compose exec -T db psql -U opentaxrate -d opentaxrate -v ON_ERROR_STOP=1 \
  -c 'CREATE SCHEMA IF NOT EXISTS drizzle'
docker compose exec -T db pg_restore -U opentaxrate -d opentaxrate \
  --clean --if-exists --no-owner --no-privileges --exit-on-error < "$src"
echo "restored $src"
