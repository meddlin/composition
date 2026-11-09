#!/usr/bin/env bash
# Asks a real Meilisearch the queries in fixtures/conformance/search-queries.json over the generated notes, through the
# desktop's own searchIndex.ts, and rewrites fixtures/conformance/search-expected.json (spike S2). Needs a Meilisearch binary:
# `meilisearch` on the PATH, or COMPOSITION_MEILI_BIN. Commit the result with the change to the queries or the notes that needed it.
#
# Usage: apps/ios/scripts/regenerate-search-expected.sh
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
[ -f "$root/apps/web/node_modules/vitest/vitest.mjs" ] || {
  echo "The web dependencies are not installed: cd apps/web && pnpm install --frozen-lockfile" >&2
  exit 1
}
dir="$(mktemp -d "${TMPDIR:-/tmp}/composition-search-expected.XXXXXX")"
trap 'rm -rf "$dir"' EXIT
(cd "$root/apps/web" && COMPOSITION_REGENERATE_SEARCH=1 COMPOSITION_FIXTURE_DIR="$dir" node node_modules/vitest/vitest.mjs run scripts/conformance-fixtures.test.ts -t "regenerates the committed Meilisearch answers")
echo "Rewrote fixtures/conformance/search-expected.json"
