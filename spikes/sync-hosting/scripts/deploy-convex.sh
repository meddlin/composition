#!/usr/bin/env bash
# Push the Convex functions to the production deployment named by CONVEX_DEPLOY_KEY and set its env vars.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/drills/lib.sh

export CONVEX_DEPLOY_KEY; CONVEX_DEPLOY_KEY=$(need CONVEX_DEPLOY_KEY)
SITE=$(need CONVEX_SITE_URL)

# Tokens first, so the functions never run without them.
tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
{ printf 'SYNC_DEV_TOKENS=%s\n' "$(need SYNC_DEV_TOKENS)"; printf 'SYNC_ADMIN_TOKEN=%s\n' "$(need SYNC_ADMIN_TOKEN)"; } > "$tmp"
pnpm -s exec convex env set --force --from-file "$tmp"
pnpm -s exec convex deploy -y
pnpm -s exec convex run sync:init '{}' >/dev/null

touch .env.candidates.local; grep -v '^SYNC_URL_CONVEX=' .env.candidates.local > .env.candidates.local.tmp || true
echo "SYNC_URL_CONVEX=$SITE" >> .env.candidates.local.tmp; mv .env.candidates.local.tmp .env.candidates.local
wait_ready "$SITE" 120
echo "convex is serving at $SITE"
