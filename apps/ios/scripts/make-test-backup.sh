#!/usr/bin/env bash
# Makes a backup of 1,000 generated notes (the notes the search was judged on), in the desktop's backup format, to try the
# iPad app with (or the desktop's Restore) without using real notes. They are the `pnpm search:playground` notes: technology
# titles and lorem ipsum, so they will not look like yours.
#
# Needs the web dependencies (cd apps/web && pnpm install --frozen-lockfile).
# Usage: apps/ios/scripts/make-test-backup.sh [output-file]   (composition-test-1000-notes.tar.gz in the current folder by default)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
out="${1:-$PWD/composition-test-1000-notes.tar.gz}"
[ -f "$root/apps/web/node_modules/vitest/vitest.mjs" ] || {
  echo "The web dependencies are not installed: cd apps/web && pnpm install --frozen-lockfile" >&2
  exit 1
}
dir="$(mktemp -d "${TMPDIR:-/tmp}/composition-test-backup.XXXXXX")"
trap 'rm -rf "$dir"' EXIT

(cd "$root/apps/web" && IOS_FIXTURE_DIR="$dir" node node_modules/vitest/vitest.mjs run scripts/ios-conformance-fixtures.test.ts -t "writes the search corpora" > /dev/null)
cp "$dir/search-corpus-1000.db" "$dir/composition.db"
printf '{"format":"composition-backup","version":1,"createdAt":"%s","counts":{}}\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" > "$dir/composition-backup.json"
COPYFILE_DISABLE=1 tar -czf "$out" -C "$dir" composition-backup.json composition.db
echo "Wrote $out ($(du -h "$out" | cut -f1)): 1,000 notes."
