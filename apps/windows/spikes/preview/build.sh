#!/usr/bin/env bash
# Builds the standalone preview page into ./dist with apps/web's own Vite, and prints what it weighs.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web="$here/../../../web"
[ -x "$web/node_modules/.bin/vite" ] || { echo "Install the web dependencies first: cd apps/web && pnpm install --frozen-lockfile" >&2; exit 1; }
# Tailwind resolves the @plugin in globals.css from the folder of the stylesheet that imports it, so this folder needs apps/web's modules in reach.
ln -sfn "$web/node_modules" "$here/node_modules"
"$web/node_modules/.bin/vite" build --config "$here/vite.config.mts"
echo; echo "== dist"; ls -l "$here/dist" "$here/dist/assets" | grep -v "^total"
echo "== gzip sizes"; for f in "$here"/dist/assets/*; do printf '%10d  %s\n' "$(gzip -9 -c "$f" | wc -c)" "$(basename "$f")"; done
