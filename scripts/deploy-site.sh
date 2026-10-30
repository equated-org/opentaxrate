#!/usr/bin/env sh
# Builds the site (client/) and deploys it to Cloudflare Workers, served at
# opentaxrate.com (client/cloudflare/wrangler.jsonc). The build reads
# client/.env (PUBLIC_*), so a worktree needs it shared; wrangler signs in
# with its own login (wrangler login) or CLOUDFLARE_API_TOKEN.
#
#   scripts/deploy-site.sh
#
# 1. Installs the client's packages if they're missing.
# 2. Stops if `pnpm check` fails.
# 3. Builds with accounts on (sign-in and the dashboard).
# 4. Deploys the build and the Worker.
set -eu
cd "$(dirname "$0")/../client"
[ -f .env ] || { echo "client/.env is missing: the build would leave out the site's settings." >&2; exit 1; }
[ -d node_modules ] || pnpm install --frozen-lockfile --silent
pnpm -s check
PUBLIC_ACCOUNTS=on pnpm -s build
cd cloudflare
CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID:-abaa07da7aaf34fe8dd3d77361e33e46} npx wrangler deploy
