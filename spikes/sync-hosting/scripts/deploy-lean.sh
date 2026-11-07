#!/usr/bin/env bash
# Deploy the lean candidate to Fly (needs `fly auth login` and the wizard's env files). Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/drills/lib.sh

APP=$(fly_app lean); REGION=$(need FLY_REGION); ORG=$(need FLY_ORG)
ACCOUNT=$(need R2_ACCOUNT_ID)

if ! fly apps list --json | jq -e --arg a "$APP" '.[] | select(.Name==$a)' >/dev/null; then
  fly apps create "$APP" --org "$ORG"
fi
if ! fly volumes list -a "$APP" --json | jq -e 'length > 0' >/dev/null; then
  fly volumes create data --region "$REGION" --size 1 -y -a "$APP"
fi

# Secrets go through stdin (never the command line or this script's output).
{
  printf 'SYNC_DEV_TOKENS=%s\n'            "$(need SYNC_DEV_TOKENS)"
  printf 'SYNC_ADMIN_TOKEN=%s\n'           "$(need SYNC_ADMIN_TOKEN)"
  printf 'LITESTREAM_BUCKET=%s\n'          "$(need R2_BUCKET)"
  printf 'LITESTREAM_ENDPOINT=https://%s.r2.cloudflarestorage.com\n' "$ACCOUNT"
  printf 'LITESTREAM_REGION=auto\n'
  printf 'LITESTREAM_ACCESS_KEY_ID=%s\n'   "$(need R2_ACCESS_KEY_ID)"
  printf 'LITESTREAM_SECRET_ACCESS_KEY=%s\n' "$(need R2_SECRET_ACCESS_KEY)"
} | fly secrets import -a "$APP" --stage

fly deploy -a "$APP" -c lean/fly.toml --dockerfile lean/Dockerfile --primary-region "$REGION" --ha=false -y .
URL="https://$APP.fly.dev"
echo "SYNC_URL_LEAN=$URL" > /dev/null
# Record where it lives for the scenario runner.
touch .env.candidates.local; grep -v '^SYNC_URL_LEAN=' .env.candidates.local > .env.candidates.local.tmp || true
echo "SYNC_URL_LEAN=$URL" >> .env.candidates.local.tmp; mv .env.candidates.local.tmp .env.candidates.local
wait_ready "$URL" 300
echo "lean is serving at $URL"
