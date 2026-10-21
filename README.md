# OpenTaxRate

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue?style=for-the-badge" alt="License: Apache 2.0"></a>
  <img src="https://img.shields.io/badge/States-50%20%2B%20DC-2ea44f?style=for-the-badge" alt="50 states + DC">
  <img src="https://img.shields.io/badge/Node-22-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 22">
  <img src="https://img.shields.io/badge/Postgres-17-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="Postgres 17">
  <img src="https://img.shields.io/badge/docker%20compose-up-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="docker compose">
</p>

**US sales tax rates by street address, from the states' own data.** Give it an address and a date; it returns the combined general sales tax rate, every jurisdiction in it, how the address was placed, and the published file each rate came from. When the data can't settle one rate, it says so and names the rates it could be. No API keys, no per-call fees, no guessing.

It reads what states already publish for free: the Streamlined Sales Tax rate and boundary files, each tax office's own rate tables and GIS layers, and Census county and city outlines. A refresh job loads them into Postgres; the API answers from there in milliseconds.

<table>
<tr><td><b>Address-level, not ZIP-level</b></td><td>Street house-number ranges for the 24 Streamlined states and Missouri; county, city and district outlines for the rest. A ZIP that crosses a city line isn't averaged or rounded down; the street decides.</td></tr>
<tr><td><b>Dated</b></td><td>Every rate carries its effective span. Ask for a sale's date and get the rate in force that day, back to 2020 for most states.</td></tr>
<tr><td><b>Refuses instead of guessing</b></td><td>Near a city line, in a district no one publishes an outline for, or when geocoders disagree, it returns <code>422</code> with the candidate rates. Missing data is never read as zero.</td></tr>
<tr><td><b>Explains itself</b></td><td>Each answer lists the state, county, city and district parts, the match type (<code>street</code>, <code>zip4</code>, <code>zip5</code>, <code>map</code>, <code>statewide</code>, <code>authority</code>) and the source files.</td></tr>
<tr><td><b>Checked against the states</b></td><td>40/40 Washington addresses match WA DOR; 289/291 Texas points match the Comptroller; 211/213 Illinois addresses match IDOR's address file.</td></tr>
<tr><td><b>Runs anywhere</b></td><td><code>docker compose up</code>: one Postgres, one API container, one refresh job. About 5 GB of data with every state, or 570 MB as a compressed snapshot.</td></tr>
</table>

---

## Quick start

```bash
git clone https://github.com/opentaxrate/opentaxrate && cd opentaxrate
cp .env.example .env              # optional: MAPBOX_ACCESS_TOKEN, contact for Nominatim
docker compose up -d              # Postgres, migrations, API on :8080
docker compose run --rm refresh   # download and load every state (~45 min the first time)
```

Or load a few states to try it:

```bash
docker compose run --rm refresh OH TX WA
```

Or skip the first load with a snapshot:

```bash
scripts/restore.sh https://github.com/opentaxrate/opentaxrate/releases/download/2026-10/opentaxrate-2026-10-21.dump
```

Then:

```bash
curl -G localhost:8080/v1/rate \
  --data-urlencode state=OH --data-urlencode "street=90 W Broad St" \
  --data-urlencode city=Columbus --data-urlencode zip=43215
```

```json
{
  "state": "OH",
  "rate": 0.08,
  "stateRate": 0.0575,
  "localRate": 0.0225,
  "parts": [
    { "kind": "state", "code": "45:39", "rate": 0.0575 },
    { "kind": "county", "code": "00:049", "rate": 0.0125 },
    { "kind": "district", "code": "63:25000", "rate": 0.01 }
  ],
  "match": "street",
  "locationCode": "39-049-00000-25000",
  "source": "Streamlined Sales Tax files OHR2026Q4SEP17 + OHB2026Q4SEP17, street match on 2026-10-21"
}
```

A refusal:

```json
{
  "error": "Lafayette is 9%, or 10% in one of its districts, which have no published outlines. Confirm which applies.",
  "code": "ADDRESS_NEEDS_CONFIRMATION"
}
```

---

## Commands

```bash
opentaxrate serve                          # HTTP API on $PORT (8080)
opentaxrate migrate                        # create or update the tables
opentaxrate refresh [STATE...] [--force]   # download and load each state's newest data
opentaxrate rate OH "90 W Broad St" Columbus 43215 [2025-06-01]
opentaxrate check --cases cases.csv        # state,street,city,zip,date,expected
```

In Docker, each runs as `docker compose run --rm api <command>`; `refresh` has its own service.

| Endpoint | Returns |
|---|---|
| `GET /v1/rate?state=&street=&city=&zip=&date=` | the rate, its parts, match type and sources; `422` with candidates when it can't settle one; `502` when the state isn't loaded |
| `GET /v1/coverage` | every state, how it's placed, and the files loaded for it |
| `GET /health` | `{ "ok": true }` once the database answers |

---

## How it works

```mermaid
flowchart LR
  app([your app]) -->|GET /v1/rate| api[api]
  api --> sw[statewide tables<br/>DE NH OR MT CT ME MD MA DC]
  api --> rg[range engine<br/>24 SST states + MO]
  api --> mp[map engine<br/>TX FL NY PA IL VA AZ NM CO AK AL LA SC MS ID HI]
  api -. CA .-> cdtfa[[CDTFA live]]
  rg --> db[(Postgres)]
  mp --> db
  mp -. place the address .-> geo[[Census · OSM · Mapbox]]
  refresh[refresh job] -->|quarterly| db
  refresh -. downloads .-> src[[tax offices · SST · Census TIGER]]
```

1. **Statewide.** States with no sales tax or one rate everywhere are a dated table; no lookup needed.
2. **Ranges.** In Streamlined states and Missouri the street is matched to its house-number range, then its ZIP+4, then its ZIP if the whole ZIP has one rate, then its point on the map.
3. **Map.** Elsewhere the address is geocoded by every configured geocoder at once (kept only where they agree), tested against county, city and district outlines, and each outline's dated rate is stacked by that state's rules: a city in place of its county, a parish only outside towns, a Texas combined area that keeps only some districts, an Illinois business district at listed addresses.
4. **Edges.** Near a line, the rate a few metres across is computed too; only if it differs is the address refused.

The full design, with the stacking rules and tables: **[docs/architecture.md](docs/architecture.md)**.

---

## Coverage

| Method | States | Placed by | Rates since |
|---|---|---|---|
| Statewide | DE, NH, OR, MT, CT, ME, MD, MA, DC | nothing needed (Montana resort towns refused) | 2008–2013 |
| Address ranges | AR, GA, IN, IA, KS, KY, MI, MN, NE, NV, NJ, NC, ND, OH, OK, RI, SD, TN, UT, VT, WA, WV, WI, WY, MO | street, ZIP+4, ZIP, map | 2020 |
| Map | TX, FL, NY, PA, IL, VA, AZ, NM, CO, AK, AL, LA, SC, MS, ID, HI | geocoded point in outlines | 2022–2026, by state |
| Authority | CA | CDTFA's live lookup | today only |

**Known gaps, refused with candidates:** Alabama police jurisdictions and 13 split counties, Louisiana economic development districts, Illinois business districts off IDOR's address list, Missouri transportation districts in split ZIPs. **Not covered at all:** taxability, exemptions, single-item caps (Florida's $5,000, Tennessee's), sourcing rules, and tribal taxes. This is the general rate.

---

## The data

The 5 GB is almost all one thing: **15.4 million street house-number ranges** from the Streamlined states and Missouri (3.65 GB), plus 5.3 million ZIP+4 ranges (0.7 GB) and county, city and district outlines (0.6 GB). Rates themselves are 116 thousand rows.

| | Downloaded | In Postgres |
|---|---:|---:|
| Streamlined rate + boundary files (24 states) | 350 MB zipped, 3.3 GB unzipped | 4.3 GB |
| Census TIGER counties, places, county subdivisions | ~250 MB | 0.5 GB |
| State GIS layers (TX, IL, AZ, NM, CO, AK) | ~150 MB | 0.1 GB |
| State rate files and forms | under 20 MB | 20 MB |

**Nothing is committed to this repo.** The data changes every quarter, several files are over GitHub's 100 MB limit, and each state should be fetched from its source so you know where every rate came from. `refresh` downloads straight from the publishers; `scripts/snapshot.sh` writes a compressed dump (about 570 MB) for a release download, and `scripts/restore.sh` loads one.

Set `OPENTAXRATE_HISTORY_FROM=2024-01-01` to keep less history and roughly halve the street ranges.

---

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://opentaxrate:opentaxrate@localhost:5432/opentaxrate` | Postgres |
| `PORT` | `8080` | API port |
| `MAPBOX_ACCESS_TOKEN` | unset | a third geocoder beside Census and OpenStreetMap; places more addresses |
| `OPENTAXRATE_USER_AGENT` | `opentaxrate (+https://github.com/opentaxrate/opentaxrate)` | sent to tax offices and Nominatim; put your contact here |
| `OPENTAXRATE_HISTORY_FROM` | `2020-01-01` | oldest rows kept when loading |

---

## Development

```bash
pnpm install
docker compose up -d db
DATABASE_URL=postgres://opentaxrate:opentaxrate@localhost:5433/opentaxrate pnpm migrate
DATABASE_URL=... pnpm refresh WY PA
DATABASE_URL=... pnpm test
pnpm dev
```

Adding a state means writing an adapter in `src/engine/geo-states/` that returns dated rate rows and, if the state publishes them, its own outlines; see `virginia.ts` (a workbook keyed by FIPS) or `texas.ts` (rates plus the Comptroller's GIS layers).

---

## Sources and terms

Rates and boundaries come from public sources: [Streamlined Sales Tax](https://www.streamlinedsalestax.org/ratesandboundry/), the [Census Bureau's TIGER/Line](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html), and each state's tax office (Texas Comptroller, Illinois IDOR, Arizona ADOR, New Mexico TRD, Virginia Tax, Missouri DOR, Alabama DOR, Florida DOR, New York DTF, Louisiana Remote Sellers Commission, Colorado DOR, the Alaska Remote Seller Sales Tax Commission). Colorado and Alaska are read from their official lookups' services, which aren't documented as bulk APIs; ask them before running it at scale.

Geocoding uses the Census Bureau's free geocoder and OpenStreetMap's [Nominatim](https://operations.osmfoundation.org/policies/nominatim/), whose usage policy limits the public server to light use; run your own for volume. Mapbox is optional and under your own account's terms.

**Not tax advice.** Rates are as published by the states and can be wrong or late; every answer names its source so you can check it.

## License

[Apache 2.0](LICENSE).
