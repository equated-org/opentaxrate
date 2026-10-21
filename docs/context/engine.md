# Engine dispatch, statewide states and California

Sources: `src/rates/index.ts`, `src/rates/statewide.ts`, `src/rates/california.ts`

`addressRates` in `src/rates/index.ts` is the engine's one entry point. It picks a method by state, calls that method, and shapes the result as an `AddressRate`. The range and map engines have their own notes ([range-engine.md](range-engine.md), [map-engine.md](map-engine.md)).

## Dispatch

`addressRates.at(query, date)` checks in this order:

| Order | Test | Method | Calls |
|---|---|---|---|
| 1 | `statewideRate(state, date, city)` returns non-null | `statewide` | nothing else |
| 2 | `state === "CA"` | `authority` | `california(query, date)` |
| 3 | `geoStateOf(state)` | `map` | `geoRateAt(state, await query.locate(), date, street, query.trace)` |
| 4 | `RANGE_FIPS[state]` | `ranges` | `sstRateAt({ ...query, state }, date)` |
| 5 | none | | `RateError(..., 422, undefined, "UNSUPPORTED_STATE")` |

`addressRates.method(state)` returns the same names for `/v1/coverage`, or null. `addressRates.covers(state)` checks `ADDRESS_RATE_STATES`, which is `STATEWIDE_STATES` + `Object.keys(RANGE_FIPS)` + `GEO_STATES` + `"CA"`, sorted.

Note the map method always calls `query.locate()` up front; the range method passes `locate` down and calls it only when needed.

`AddressRateQuery.trace` is an optional `Trace` (`types.ts`) the map and range engines push into (see [api.md](api.md) for its fields). Statewide and California answers leave it empty. It never changes the `AddressRate` returned.

## `AddressRate`

| Field | Meaning |
|---|---|
| `state` | upper-cased two-letter code |
| `rate` | combined decimal rate (0.0725 is 7.25%) |
| `stateRate` | the `kind: "state"` part's rate |
| `localRate` | `rate - stateRate`, rounded to 6 decimals |
| `byType` | `RatesByType`: `general`, `generalInterstate`, `foodDrug`, `foodDrugInterstate` (`types.ts`). Filled from the Streamlined files by `sstRateAt`; every other method gives `generalOnly(rate)`, the others null. A food rate is the rate where the state taxes food at that rate, not whether it does |
| `parts` | `RatePart[]`: `{ kind: "state" \| "county" \| "city" \| "district", code, rate, byType? }` (`types.ts`) |
| `match` | `statewide`, `street`, `zip4`, `zip5`, `map` or `authority` |
| `locationCode` | statewide: the state code; ranges: `fips-county-place[-districts]` or null when several areas share the rate; map: state code then each part's code; CA: the CDTFA tax area code |
| `source` | a sentence naming the files and match, e.g. `Streamlined Sales Tax files OHR... + OHB..., street match on 2026-10-21` (`Missouri DOR files ...` for MO) |

The `source` match phrases come from `MATCH_NAMES`.

## Statewide (`src/rates/statewide.ts`)

`RATES` holds a newest-first list of `{ rate, from }` per state: DE, NH, OR, MT at 0; CT 6.35%; ME 5.5%; MD 6%; MA 6.25%; DC 6%. `STATEWIDE_STATES = Object.keys(RATES)`.

`statewideRate(state, date, city)` returns:

- null for a state not in `RATES`;
- `{ refused }` for Montana when the upper-cased city (dots removed) is in `MONTANA_RESORT_AREAS`;
- `{ refused }` when `date` is before the oldest `from`;
- else the first entry with `from <= date`.

Invariants: rates are dated and a sale before the first date is refused, not given today's rate. Rates on particular goods (meals, IT services) are not the general rate and are not here. Streamlined members with one rate (IN, KY, MI, NJ, RI) come from their own files, not this table. Alaska is a map state, not statewide.

## California (`src/rates/california.ts`, `california()` in `index.ts`)

California publishes no files to load, so it is read live from CDTFA's `GetRateByAddress` service, today's rate only.

`california(query, date)` in `index.ts`:

- refuses with 422 when there is no ZIP;
- calls `californiaSalesTaxService.lookup({ street, city, zip })`;
- splits the answer into a state part at `CA_STATE_RATE` (0.0725) and one district part `tac:<code>` for the rest;
- says in `source` when the date asked is not today ("today's rate, not dated to ...").

`californiaSalesTaxService.lookup` rules:

| Case | Result |
|---|---|
| HTTP 400 | 422, address rejected |
| other non-OK | 502 |
| timeout (10 s) | 504 |
| network error or bad JSON | 502 |
| response fails the zod schema | 502 |
| not exactly one `taxRateInfo`, or geocode not `confidence: "High"`, `calcMethod: "Rooftop"`, and one match code `"Good"` | 422 with a reason |
| otherwise | `{ rate, locationCode: tac, lookedUpAt, ... }` |

Only five digits of the ZIP are sent.
