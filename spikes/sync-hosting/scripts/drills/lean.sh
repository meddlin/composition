#!/usr/bin/env bash
# Drills for the lean candidate.   usage: lean.sh <local|fly> <down|up|restore>
#   down     kill the API process (SIGKILL: a crash; the SQLite file and its WAL survive on disk)
#   up       bring it back and wait until it serves
#   restore  lose the database: destroy the disk, start empty, and let the entrypoint restore from the replica
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/drills/lib.sh

mode="${1:?local|fly}"; action="${2:?down|up|restore}"
if [[ "$mode" == local ]]; then
  URL=http://127.0.0.1:8787
  compose="docker compose -f lean/compose.yaml"
else
  APP=$(fly_app lean); URL="https://$APP.fly.dev"
  machine_id() { fly machines list -a "$APP" --json | jq -r '.[0] | (.id // .ID)'; }
fi

case "$mode/$action" in
  local/down)    $compose kill lean ;;
  local/up)      $compose start lean; wait_ready "$URL" ;;
  # SIGKILL, not a graceful stop: Litestream flushes on SIGTERM, which would hide the replication-lag loss window.
  local/restore) $compose kill lean || true; $compose rm -f lean; docker volume rm -f sync-spike-lean_leandata >/dev/null; $compose up -d lean; wait_ready "$URL" ;;

  fly/down)      fly machine kill "$(machine_id)" -a "$APP" ;;
  fly/up)
    state=$(fly machines list -a "$APP" --json | jq -r '.[0] | (.state // .State)')
    [[ "$state" == started ]] || fly machine start "$(machine_id)" -a "$APP"
    wait_ready "$URL" ;;
  fly/restore)
    image=$(fly machines list -a "$APP" --json | jq -r '.[0] | (.config.image // .Config.image)')
    fly machine destroy "$(machine_id)" --force -a "$APP"
    fly volumes destroy "$(fly volumes list -a "$APP" --json | jq -r '.[0] | (.id // .ID)')" -y -a "$APP"
    fly volumes create data --region "$(need FLY_REGION)" --size 1 -y -a "$APP"
    [[ -f .local/lean.fly.toml ]] || { echo "run scripts/deploy-lean.sh first (it writes .local/lean.fly.toml)" >&2; exit 1; }
    fly deploy -a "$APP" -c .local/lean.fly.toml --image "$image" --ha=false -y
    wait_ready "$URL" ;;
  *) echo "usage: lean.sh <local|fly> <down|up|restore>" >&2; exit 2 ;;
esac
