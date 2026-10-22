You maintain the self-hosted geocoders on this machine: Nominatim (port 8080), Photon (2322) and Pelias (4000). The guide is `self-hosted-geocoders.html` in this directory; follow it for every command. `notes.md` here is your memory between runs: read it first, and update it before you finish.

Do these in order. Make at most one change per run.

1. Check that Nominatim, Photon and Pelias each answer a test search for "1600 Pennsylvania Ave NW, Washington DC", that Pelias's `pelias_interpolation` container is running, and that the disk has at least 300 GB free. If something is down, try restarting its container once; don't rebuild anything to fix it.
2. Check Nominatim's data is under 3 days old (`/status?format=json`, `data_updated`). Nominatim updates itself (`UPDATE_MODE=continuous`); if it's behind, read `/var/log/replication.log` in the container and report why. Don't run replication yourself.
3. If GraphHopper's US Photon dump (`Last-Modified` of the URL in the guide) is newer than Photon's `import_date` (`/status`), swap it in as the guide's Photon section describes, keeping the old database until the new one answers the test search.
4. From October to December, if nominatim.org has a newer `tigerYYYY-nominatim-preprocessed.csv.tar.gz` than the release recorded in `notes.md`, load it as the guide describes.
5. If the live Pelias index (`curl localhost:9200/_cat/indices?h=index,creation.date.string`) is more than 3 months old, or `notes.md` says a rebuild is in progress, follow the guide's Pelias rebuild. It takes most of a day: start each long step with `nohup` and its log in `~/pelias/logs/`, record the step in `notes.md`, and on the next run check it and carry on. Switch the API over only when the new index has over 100 million documents and passes the test search.

Never touch other containers or services on this machine, and never delete data the guide doesn't say to delete. If something needs a decision, stop and say so.

End with a short report: each check's result, what you changed, and anything that needs a person.
