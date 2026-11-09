#!/usr/bin/env bash
# Builds the preview bundle from apps/web's source. Needs `pnpm --dir apps/web install` first. Output: dist/ (git-ignored).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
web="$here/../../../web"
cd "$web"
./node_modules/.bin/vite build --config "$here/vite.config.mjs"
cp "$here/index.html" "$here/dist/index.html"
ls -la "$here/dist"
