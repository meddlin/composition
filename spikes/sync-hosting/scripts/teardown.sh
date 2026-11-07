#!/usr/bin/env bash
# Stops all spend from this spike. Deletes only what the spike created: the two Fly apps (machines, volumes and
# secrets go with them), the R2 replica bucket's contents, the Neon project, and the local containers.
#   bash scripts/teardown.sh           asks before deleting the real hosts
#   bash scripts/teardown.sh --yes     no questions
#   bash scripts/teardown.sh --local   only the local containers and processes (no accounts needed)
# Convex has no standing cost on the Starter plan (it bills usage), and deleting a project is a dashboard action,
# so this script tells you where instead of doing it.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/drills/lib.sh

yes=0; local_only=0
for a in "$@"; do [[ "$a" == --yes ]] && yes=1; [[ "$a" == --local ]] && local_only=1; done
ok() { (( yes )) && return 0; read -r -p "  ? $1 [y/N] " reply; [[ "$reply" =~ ^[Yy] ]]; }

echo "== local containers and processes"
docker compose -f lean/compose.yaml down -v 2>/dev/null || true
docker compose -f postgres/compose.yaml down -v 2>/dev/null || true
pkill -f "lean/main.ts|postgres/main.ts|harness/server.ts" 2>/dev/null || true
echo "  (a local 'convex dev' you started stays running: stop it with Ctrl-C in its terminal)"

if (( local_only )); then echo "done (local only)"; exit 0; fi

echo "== Fly.io apps"
if command -v fly >/dev/null 2>&1 && [[ -n "$(get FLY_APP_SUFFIX)" ]]; then
  for kind in lean pg; do
    app=$(fly_app "$kind")
    if fly apps list --json 2>/dev/null | jq -e --arg a "$app" 'map(select((.Name // .name) == $a)) | length > 0' >/dev/null; then
      if ok "Delete Fly app $app (machine, volume, secrets)?"; then fly apps destroy "$app" -y; fi
    else
      echo "  $app: not found (already gone)"
    fi
  done
else
  echo "  skipped: flyctl or FLY_APP_SUFFIX missing"
fi

echo "== Cloudflare R2"
if [[ -n "$(get R2_BUCKET)" ]]; then
  if ok "Empty (and try to delete) R2 bucket $(get R2_BUCKET)?"; then node scripts/teardown-r2.ts; fi
else
  echo "  skipped: no R2 settings"
fi

echo "== Neon"
if [[ -n "$(get NEON_PROJECT_ID)" && -n "$(get NEON_API_KEY)" ]]; then
  if ok "Delete the Neon project $(get NEON_PROJECT_ID) and everything in it?"; then
    neon_api DELETE "/projects/$(get NEON_PROJECT_ID)" >/dev/null && echo "  Neon project deleted"
  fi
else
  echo "  skipped: no Neon settings"
fi

echo "== Convex"
echo "  Not deleted by this script. In https://dashboard.convex.dev open the project > Settings > Delete Project."
echo "  Until then it costs nothing at rest on Starter; it bills usage only."

echo "== what is left in your accounts (should show none of this spike's resources)"
if command -v fly >/dev/null 2>&1; then fly apps list 2>/dev/null | grep -E "comp-sync-" || echo "  fly: no comp-sync-* apps"; fi
echo "done. The .env.*.local files still hold your keys: delete them (rm .env.*local) when you are finished."
