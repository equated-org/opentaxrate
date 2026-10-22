You maintain the self-hosted geocoders on this machine: Nominatim (port 8080), Photon (2322) and Pelias (4000). The guide is `self-hosted-geocoders.html` in this directory; follow it for every command. `notes.md` here is your memory between runs: read it first, and update it before you finish.

The US supplement pipeline lives in `~/geocoders/extra`. Read its `status.txt`, `*.done.json`, and the supplement section of the guide. While `extra-run.sh`, `extra-interpolation.sh`, or `wikipedia.sh` is running, report progress and do read-only health checks only; don't start competing imports or restart their containers. A FAILED status needs investigation, not a blind restart. Preserve the supplement CSVs and provenance archives. Future Pelias index rebuilds must also import the verified supplements with the guide's `next csv ./bin/start` step.

The US/Canada additions live in `~/geocoders/strongest`; also check its `status.txt` and logs. Don't compete with those imports. Once complete, test a Canadian address as well as the US search, and preserve both countries in future rebuilds.

Pelias fresh-data cycles are owned by `refresh.md`, scheduled daily. Read `refresh-state.json`; while a refresh is active, limit this run to read-only checks. Do not start a second Pelias rebuild.

Do these in order. Make at most one change per run.

1. Check that Nominatim, Photon and Pelias each answer a test search for "1600 Pennsylvania Ave NW, Washington DC", that Pelias's `pelias_interpolation` container is running, and that the disk has at least 300 GB free. If something is down, try restarting its container once; don't rebuild anything to fix it.
2. Check Nominatim's data is under 3 days old (`/status?format=json`, `data_updated`). Nominatim updates itself (`UPDATE_MODE=continuous`); if it's behind, read `/var/log/replication.log` in the container and report why. Don't run replication yourself.
3. If the `Last-Modified` of GraphHopper's US Photon dump differs from the one recorded in `notes.md`, swap it in as the guide's Photon section describes, keeping the old database until the new one answers the test search, then record the new value. (Photon's `import_date` is GraphHopper's data date, not the dump's, so don't compare against it.)
4. From October to December, if nominatim.org has a newer `tigerYYYY-nominatim-preprocessed.csv.tar.gz` than the release recorded in `notes.md`, load it as the guide describes.
5. Check `refresh-state.json` and `logs/refresh.log`: monthly Pelias refreshes must cover every US/Canada source, and unfinished cycles should advance through the daily refresh job. Report overdue dates, FAILED/BLOCKED stages, or a missing daily cron entry. Leave rebuilds and cutovers to `refresh.md`.

Never touch other containers or services on this machine, and never delete data the guide doesn't say to delete. If something needs a decision, stop and say so.

End with a short report: each check's result, what you changed, and anything that needs a person.
