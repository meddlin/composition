#!/usr/bin/env bash
# Drills for Convex.   usage: convex.sh <local|prod> <backup|restore>
# There is no API to kill and no machine to lose: Convex runs those. The restore path under test is the CLI's
# export and `import --replace-all` (Starter keeps two dashboard backups; periodic backups need Pro).
# Importing does not change the epoch (the restored meta table carries the old one), so the scenario rotates it.
set -euo pipefail
cd "$(dirname "$0")/../.."
source scripts/drills/lib.sh

mode="${1:?local|prod}"; action="${2:?backup|restore}"
mkdir -p .local
convex() {
  if [[ "$mode" == prod ]]; then CONVEX_DEPLOY_KEY=$(need CONVEX_DEPLOY_KEY) pnpm -s exec convex "$@"; else pnpm -s exec convex "$@"; fi
}
if [[ "$mode" == prod ]]; then URL=$(need CONVEX_SITE_URL); else URL=http://127.0.0.1:3211; fi

case "$action" in
  backup)  rm -f .local/convex-backup.zip; convex export --path .local/convex-backup.zip >&2; date -u +%Y-%m-%dT%H:%M:%SZ ;;
  restore) convex import --replace-all -y .local/convex-backup.zip >&2; wait_ready "$URL" ;;
  *) echo "usage: convex.sh <local|prod> <backup|restore>" >&2; exit 2 ;;
esac
