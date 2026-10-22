#!/usr/bin/env sh
# Writes the loaded data to data/opentaxrate-YYYY-MM-DD.dump (custom format,
# compressed; about 570 MB with every state), for a public release download.
#
# Rows: only the tax tables and the migration history. Every other table
# (geocoding cache and usage, accounts, keys, request history, credit) is
# dumped as an empty table, so a restored database has every table its
# migration history says it has, and `migrate` stays correct. A table this
# script doesn't know stops it: add it to TAX_TABLES or EMPTY_TABLES first,
# so nothing new reaches a public dump by default.
set -eu
cd "$(dirname "$0")/.."

TAX_TABLES="sales_tax_areas sales_tax_data_releases sales_tax_jurisdiction_rates
  sales_tax_jurisdictions sales_tax_shapes sales_tax_street_ranges sales_tax_zip_ranges zip_areas zip_street_names"
EMPTY_TABLES="geocode_results geocoder_usage user session account verification
  apikey api_requests credit_grants"

psql() { docker compose exec -T db psql -U opentaxrate -d opentaxrate -At -v ON_ERROR_STOP=1 "$@"; }

unknown=""
# Tables an extension owns (PostGIS's spatial_ref_sys) come with --extension.
for t in $(psql -c "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    order by 1"); do
  case " $(echo $TAX_TABLES $EMPTY_TABLES) " in
    *" $t "*) ;;
    *) unknown="$unknown $t" ;;
  esac
done
if [ -n "$unknown" ]; then
  echo "Tables not in TAX_TABLES or EMPTY_TABLES:$unknown. Classify them in scripts/snapshot.sh." >&2
  exit 1
fi

set --
for t in $TAX_TABLES; do set -- "$@" "--table=public.\"$t\""; done
for t in $EMPTY_TABLES; do set -- "$@" "--table=public.\"$t\"" "--exclude-table-data=public.\"$t\""; done

mkdir -p data
out="data/opentaxrate-$(date -u +%F).dump"
tmp=$(mktemp "$out.XXXXXX")
trap 'rm -f "$tmp"' EXIT HUP INT TERM
docker compose exec -T db pg_dump -U opentaxrate -Fc -Z 6 \
  --no-owner --no-privileges --no-comments --strict-names \
  --extension=postgis \
  --table=drizzle.__drizzle_migrations \
  "$@" \
  opentaxrate > "$tmp"
docker compose exec -T db pg_restore --list < "$tmp" > /dev/null
mv "$tmp" "$out"
ls -lh "$out"
