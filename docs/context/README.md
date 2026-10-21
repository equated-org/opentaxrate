# Design notes by subsystem

Sources: this folder only; each note names its own.

One short note per subsystem. Each says what the subsystem does, the rules it keeps, its key functions, and the exact source files it describes, so a reader can check the note against the code. The wider picture is in [../architecture.md](../architecture.md); this folder is the close-up.

## The rule

**Update the matching note in the same PR that changes the cited files.** If you change a file listed on a note's `Sources:` line, read that note and fix anything it now gets wrong. If you add a file to a subsystem, add it to the note's `Sources:` line and to the index below. A note that disagrees with the code is a bug.

Notes describe the code as it is. Plans for future work go in ../plans/ (maintained privately) and are linked from a "Planned" section, never mixed into the description.

## Index

| Note | Subsystem | Source files |
|---|---|---|
| [api.md](api.md) | HTTP API, CLI, the shared lookup, errors | `src/server.ts`, `src/cli.ts`, `src/lookup.ts`, `src/errors.ts` |
| [engine.md](engine.md) | Dispatch by state, the `AddressRate` answer, statewide states, California | `src/rates/index.ts`, `src/rates/statewide.ts`, `src/rates/california.ts` |
| [range-engine.md](range-engine.md) | Streamlined states and Missouri: street, ZIP+4, ZIP, map | `src/rates/ranges.ts`, `src/ingest/sst-files.ts`, `src/address.ts`, `src/ingest/missouri.ts` |
| [map-engine.md](map-engine.md) | Map-read states: outlines, levy types, edges, state adapters | `src/rates/map.ts`, `src/rates/shapes.ts`, `src/rates/types.ts`, `src/ingest/states/*` |
| [geocoding.md](geocoding.md) | Placing an address on the map | `src/geocoding/index.ts`, `src/geocoding/mapbox.ts`, `src/geocoding/index.ts` |
| [refresh.md](refresh.md) | Downloading and loading data, the tables | `src/ingest/refresh.ts`, `src/ingest/load.ts`, `src/ingest/downloads.ts`, `src/ingest/tiger.ts`, `src/db/schema.ts` |

## Writing a note

- Start with a `Sources:` line listing every file the note describes.
- Name real functions, tables and environment variables, in backticks.
- Plain words, short paragraphs, tables where they help. Keep it under about 120 lines.
- Say what must stay true (invariants) as well as what the code does.
