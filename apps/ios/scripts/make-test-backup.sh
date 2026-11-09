#!/usr/bin/env bash
# Makes a backup of 1,000 generated notes (the notes the search was judged on), in the desktop's backup format, to try the
# iPad app with (or the desktop's Restore) without using real notes. They are the `pnpm search:playground` notes: technology
# titles and lorem ipsum, so they will not look like yours. A 1,001st note, "Preview showcase", uses every component the preview
# draws (fixtures/conformance/preview-showcase/), with its two pictures stored as the desktop stores them, in `app_data/`.
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

(cd "$root/apps/web" && COMPOSITION_FIXTURE_DIR="$dir" node node_modules/vitest/vitest.mjs run scripts/conformance-fixtures.test.ts -t "writes the search corpora" > /dev/null)
cp "$dir/search-corpus-1000.db" "$dir/composition.db"
showcase="$root/fixtures/conformance/preview-showcase"
python3 - "$dir/composition.db" "$showcase/note.md" <<'PY'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
content = open(sys.argv[2]).read()
db.execute(
    "INSERT INTO notes (title, content, tags, description, created_at, updated_at, notebook_id) VALUES (?, ?, 'demo', 'Every component the preview draws', '2026-11-06T09:00:00.000Z', '2026-11-06T09:00:00.000Z', 1)",
    ("Preview showcase", content),
)
db.commit()
db.close()
PY
mkdir -p "$dir/app_data"
cp "$showcase"/*.png "$dir/app_data/"
printf '{"format":"composition-backup","version":1,"createdAt":"%s","counts":{}}\n' "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" > "$dir/composition-backup.json"
COPYFILE_DISABLE=1 tar -czf "$out" -C "$dir" composition-backup.json composition.db app_data
echo "Wrote $out ($(du -h "$out" | cut -f1)): 1,001 notes, the last a showcase of the preview with two pictures."
