#!/usr/bin/env sh
# Snapshot the already-loaded Compose database and publish a GitHub Release.
# Usage: scripts/publish.sh [data-YYYY-MM-DD]
# gh must be authenticated with write access to the repository's releases.
# COMPOSE_PROJECT_NAME can select an existing Compose stack.
set -eu
cd "$(dirname "$0")/.."
if [ "$#" -gt 1 ]; then
  echo "Usage: scripts/publish.sh [release-tag]" >&2
  exit 1
fi
day=$(date -u +%F)
tag=${1:-data-$day}
case "$tag" in
  ''|-*) echo "Release tag must be nonempty and cannot start with '-'." >&2; exit 1 ;;
esac
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
gh auth status > /dev/null
if gh release view "$tag" --repo "$repo" > /dev/null 2>&1; then
  echo "Release $tag already exists; choose a new tag. No assets were changed." >&2
  exit 1
fi
scripts/snapshot.sh
dump="opentaxrate-$day.dump"
(cd data && sha256sum "$dump" > "$dump.sha256")
notes=$(mktemp)
trap 'rm -f "$notes"' EXIT HUP INT TERM
cat > "$notes" <<EOF
Sales tax database snapshot exported on $day (UTC).

Includes published tax rates, street and ZIP ranges, geographic boundaries,
source-file metadata, and database migration metadata. Runtime geocoding
cache and provider usage tables are empty. Unrelated tables are excluded.

Verify the download with: sha256sum -c $dump.sha256

Restore from the repository checkout with:
scripts/restore.sh https://github.com/$repo/releases/download/$tag/$dump

Then run: docker compose up -d
EOF
# Stage both assets before making the release visible.
gh release create "$tag" "data/$dump" "data/$dump.sha256" \
  --repo "$repo" --draft --title "Database snapshot $day" --notes-file "$notes"
gh release edit "$tag" --repo "$repo" --draft=false
gh release view "$tag" --repo "$repo" --json url --jq .url
