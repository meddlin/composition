#!/usr/bin/env bash
# Drills for the Postgres candidate.   usage: postgres.sh <local|fly> <down|up|db-down|db-up|backup|restore>
#   down / up        kill the API process / bring it back
#   db-down / db-up  take the database away (local: stop the container; Neon: suspend the compute, which wakes on
#                    the next connection, so db-up only waits)
#   backup           print a restore point (local: pg_dump to .local/; Neon: just the time, since its history is continuous)
#   restore          put the database back to that point (local: pg_restore; Neon: restore the branch to the timestamp)
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/drills/lib.sh

mode="${1:?local|fly}"; action="${2:?action}"
mkdir -p .local
if [[ "$mode" == local ]]; then
  URL=http://127.0.0.1:8788
  compose="docker compose -f postgres/compose.yaml"
  dbc=sync-spike-pg-db-1
else
  APP=$(fly_app pg); URL="https://$APP.fly.dev"
  machine_id() { fly machines list -a "$APP" --json | jq -r '.[0] | (.id // .ID)'; }
  PROJECT=$(need NEON_PROJECT_ID)
fi

case "$mode/$action" in
  local/down) pkill -9 -f "postgres/main.ts" || true ;;
  local/up)   (LOG=0 nohup pnpm -s postgres >> .local/pg-api.log 2>&1 &); wait_ready "$URL" ;;
  local/db-down) $compose stop db ;;
  local/db-up)   $compose start db; until docker exec "$dbc" pg_isready -U sync -d sync >/dev/null 2>&1; do sleep 0.5; done; wait_ready "$URL" ;;
  local/backup)  docker exec "$dbc" pg_dump -U sync -Fc sync > .local/pg-backup.dump; date -u +%Y-%m-%dT%H:%M:%SZ ;;
  local/restore) docker exec -i "$dbc" pg_restore -U sync -d sync --clean --if-exists < .local/pg-backup.dump; wait_ready "$URL" ;;

  fly/down) fly machine kill "$(machine_id)" -a "$APP" ;;
  fly/up)
    state=$(fly machines list -a "$APP" --json | jq -r '.[0] | (.state // .State)')
    [[ "$state" == started ]] || fly machine start "$(machine_id)" -a "$APP"
    wait_ready "$URL" ;;
  fly/db-down)
    endpoint=$(neon_api GET "/projects/$PROJECT/endpoints" | jq -r '.endpoints[0].id')
    neon_api POST "/projects/$PROJECT/endpoints/$endpoint/suspend" >/dev/null ;;
  fly/db-up) wait_ready "$URL" ;;
  fly/backup) date -u +%Y-%m-%dT%H:%M:%SZ ;;
  fly/restore)
    : "${RESTORE_POINT:?set by the restore scenario}"
    branch=$(neon_api GET "/projects/$PROJECT/branches" | jq -r '.branches[] | select(.default) | .id')
    neon_api POST "/projects/$PROJECT/branches/$branch/restore" \
      "{\"source_branch_id\":\"$branch\",\"source_timestamp\":\"$RESTORE_POINT\",\"preserve_under_name\":\"before-restore-$(date +%s)\"}" >/dev/null
    sleep 3
    wait_ready "$URL" ;;
  *) echo "usage: postgres.sh <local|fly> <down|up|db-down|db-up|backup|restore>" >&2; exit 2 ;;
esac
