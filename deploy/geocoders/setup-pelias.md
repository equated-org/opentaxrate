Set up self-hosted Pelias for the United States and Canada using the latest available data:

- OpenStreetMap: US and Canadian addresses, streets and points of interest.
- OpenAddresses: all four US regions, including state and county sources.
- Who's on First: boundaries, cities, neighbourhoods and postal codes.
- Census TIGER: house-number ranges.
- USDOT National Address Database: government address points.
- Statistics Canada National Address Register: Canadian civic addresses and units.
- Québec RQA: authoritative Québec address points.
- State NG911 feeds: recent US address additions and corrections.
- Overture Maps: US addresses and places.
- USGS GNIS: geographic features and alternate names.
- NYC OTI AddressPoint: official NYC address points.

Follow `docs/self-hosted-geocoders.html`. Include both countries in the administrative hierarchy and search configuration. Enable interpolation using OSM streets, US TIGER and address points. Convert OpenAddresses GeoJSON to interpolation-compatible CSV. Register the extra sources, preserve provenance, coordinate quality and licenses, and deduplicate overlapping records conservatively.

Keep imports running in the background with progress logs. Validate searches before switching an existing service to rebuilt data, and retain rollback data. Schedule fresh downloads and rebuilds for every source. Report what is searchable, what is still importing and the update schedule.
