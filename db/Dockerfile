# Postgres 17 with PostGIS from the PostgreSQL apt repository, which builds
# for amd64 and arm64 alike (postgis/postgis publishes amd64 only).
FROM postgres:17
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-postgis-3 \
 && rm -rf /var/lib/apt/lists/*
