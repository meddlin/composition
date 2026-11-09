#!/usr/bin/env bash
# `verify.sh <note.md>` after build.sh: renders the note through dist/preview.js in jsdom.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
node "$here/verify-bundle.mjs" "$1"
