# Range engine (Streamlined states and Missouri)

Sources: `src/rates/ranges.ts`, `src/ingest/sst-files.ts`, `src/address.ts`, `src/ingest/missouri.ts`

The 24 Streamlined Sales Tax (SST) members publish every street's house-number ranges, ZIP+4 ranges and ZIP rows, each tied to an area (county, city, districts). Missouri's DOR publishes the same boundary layout. `RANGE_FIPS` in `sst-files.ts` is `SST_FIPS` plus `MO: "29"`; it decides which states this engine serves.

## Lookup order (`sstRateAt` in `rates/ranges.ts`)

`sstRateAt(input, date)` returns `{ rate, byType, parts, match, locationCode, files }` or throws. `byType` is each part's interstate and food-and-drug rates (`byTypeOf`) added with `sumByType`; across several areas sharing one general rate, `agreedByType` keeps only the types they all agree on.

Up front: 502 if fewer than two release files are loaded for the state; 422 if `date < HISTORY_FROM`.

1. **Street.** `parseStreet` the typed line, then `streetMatch`. If a ZIP+4 was typed, its areas (`zipAreas` with `plus4`) must give the same rate or the address is refused. If no ZIP+4 but the ZIP has more than one rate and `locate` exists, the address is geocoded and `mapAreas` must not give a different rate (street ranges are filed by hundred-block, which can straddle a city line).
2. **ZIP+4.** When the street wasn't found, the ZIP+4 range's areas.
3. **ZIP.** `zipAreas(state, zip5)` (every ZIP row and street range in the ZIP), only when `citiesInZip` names the typed city (or names none), and only if every area has one rate. No ZIP at this point is a 422.
4. **Map.** When the ZIP is split, or its ranges don't name the city, call `locate()` and keep `mapAreas`. A point within `marginOf(point)` of a deciding county or city line is refused.

Anything left is a `refusal(...)`: a 422 listing up to six candidate rates with up to three city names each.

`answer(areaIds, match)` is the core rule: rate every area with `rateAreas`; answer only if they all share one rate. `locationCode` is set only when one area remains.

## Street matching

`streetMatch` tries each of `streetVariantsOf(street)` in order and stops at the first that finds rows:

- rows on `(state, street_key)` live on `date`, with the house inside `[house_low, house_high]` and parity `B` or matching odd/even; lettered numbers match `house_text` (see `letteredHouse`);
- `bestRows` narrows: same ZIP (typed city's rows first), else same city; then type and directions (one side silent is allowed, exact preferred, directions compared as sets); then unit ranges.
- A street type the file never uses for that name in the place is treated as a typo when the file has only one type (`suffixesOf`).
- `CR<n>` with no match retries under each county's name the ZIP reaches (`countyRoadKeys`), keeping every county's match.

## Rates (`rateAreas`)

Loads every rate row for the state FIPS, each area's county, place and districts, on `date`. Parts add up: state (`45`), county (`00`), city (`01`), then each district by its type. A later `starts_on` wins where spans overlap. A city or district not found under its own type is looked up among district types (files sometimes disagree). No `45` row is a 502. A Missouri `99` code with no row on the date is a 422 (missing data, never zero).

## The street key (`address.ts`)

Both sides go through the same reading so a typed street and a file row meet on one key.

| Function | Does |
|---|---|
| `parseStreet(line)` | typed line to `StreetParts` (house, houseText, directions, `streetKey`, suffix, unit, `alternates`); null without a house number; `PO BOX n` becomes key `POBOX` |
| `readFileStreet(pre, name, suffix, post)` | a file row's four street fields, read the same way; drops a type or direction repeated in the name |
| `nameKey(tokens)` (private) | ordinals to numbers, `NAME_WORDS` and direction words abbreviated, highway names folded to `HWY`, county roads to `CR`, interstates to `I`, spaces removed |
| `streetKeysOf(parts)` | the key plus alternates for "Avenue B", lettered routes (`HWYK18`), county-named roads |
| `streetVariantsOf(parts)` | keys, then `alternates` (run-together words, last word kept as name), then a one-letter grid number as direction plus number |
| `letteredHouse(text)` | "W5350" to `{ line: "W#", number: 5350 }` for grid addresses (Wisconsin style) |

Invariant: any change to how keys are built changes what is stored, so it needs a reload of every range state (`refresh --force`).

## File parsing (`sst-files.ts`)

- `parseRateLine(line)`: `RateRow { type, code, rate, startsOn, endsOn }`; type normalised by `jurisdictionType` ("0" and "00" both "00").
- `parseBoundaryLine(line)`: kind `A` is a street row, `4` a ZIP+4 range, `Z` a whole ZIP; a ZIP range spanning several ZIPs becomes one row per ZIP. Districts are read from column 29 on as sorted `type:code` pairs.
- Dates: `isoDate` turns `YYYYMMDD` into ISO; any open end (2999 or later) becomes `9999-12-31`.
- `HISTORY_FROM` (`OPENTAXRATE_HISTORY_FROM`, default `2020-01-01`): rows that ended before it are dropped when parsing, and `sstRateAt` refuses dates before it.

## Missouri (`missouri.ts`)

`missouriFiles(dir?)` returns `StateFiles` for `loadSstState`:

- Rates: the DOR's `dor-jurisdiction-total-rate-q<Q>-<YYYY>.xlsx` for up to `QUARTERS` (8) recent quarters, starting with next quarter (published early). A 404 before any file loads is skipped; a 404 after ends the history. Each jurisdiction code's total minus `STATE_RATE` (4.225%) becomes one rate line of type `WHOLE_CODE_TYPE` ("99"). One state line (`45`) runs from the oldest quarter. The newest quarter's rows run on to `9999-12-31`.
- Boundaries: the newest quarter's `dor-boundary-database-q<Q>-<YYYY>.csv`, streamed by `sstFileLines`.
- `parseBoundary`: the jurisdiction code `PPPPP-CCC-DDD` sets the area: county from the code, place mapped to Census FIPS through `CENSUS_PLACE` where the DOR numbers differ, and the only district `99:<code>`. The place and county exist only so the map can settle a split ZIP; the rate is the code's own total.

Invariant: Missouri parts are never added; the code's total is the local rate.
