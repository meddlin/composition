#!/usr/bin/env bash
# Deploy the Postgres candidate's API to Fly, pointed at Neon. Idempotent.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/drills/lib.sh

APP=$(fly_app pg); REGION=$(need FLY_REGION); ORG=$(need FLY_ORG)

if ! fly apps list --json | jq -e --arg a "$APP" 'map(select((.Name // .name) == $a)) | length > 0' >/dev/null; then
  fly apps create "$APP" --org "$ORG"
fi
{
  printf 'SYNC_DEV_TOKENS=%s\n'  "$(need SYNC_DEV_TOKENS)"
  printf 'SYNC_ADMIN_TOKEN=%s\n' "$(need SYNC_ADMIN_TOKEN)"
  printf 'DATABASE_URL=%s\n'     "$(need NEON_DATABASE_URL)"
} | fly secrets import -a "$APP" --stage

mkdir -p .local
sed -e "s|^app = .*|app = \"$APP\"|" -e "s|^primary_region = .*|primary_region = \"$REGION\"|" postgres/fly.toml > .local/postgres.fly.toml
fly deploy -a "$APP" -c .local/postgres.fly.toml --dockerfile postgres/Dockerfile --ha=false -y .
URL="https://$APP.fly.dev"
touch .env.candidates.local; grep -v '^SYNC_URL_POSTGRES=' .env.candidates.local > .env.candidates.local.tmp || true
echo "SYNC_URL_POSTGRES=$URL" >> .env.candidates.local.tmp; mv .env.candidates.local.tmp .env.candidates.local
wait_ready "$URL" 300
echo "postgres candidate is serving at $URL"
