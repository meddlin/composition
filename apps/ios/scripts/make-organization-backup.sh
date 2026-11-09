#!/usr/bin/env bash
# Makes the backup that the organization checks (build plan Step 7: apps/ios/scripts/ui-test.sh and the manual test) use: the 1,000-note
# test backup (make-test-backup.sh) with a second notebook and groups added, so that there is something to organize:
#
#   Notebook   Projects (notes 1-6)  >  2026 (notes 7-9)  >  Archive (notes 10-11)
#              Reading (notes 12-15)
#              every other note, ungrouped
#   Work       Meetings (notes 16-20), Ideas (notes 21-23), and notes 24-26 ungrouped
#
# Needs what make-test-backup.sh needs (cd apps/web && pnpm install --frozen-lockfile), and python3.
# Usage: apps/ios/scripts/make-organization-backup.sh [output-file]   (composition-test-organization.tar.gz in the current folder by default)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${1:-$PWD/composition-test-organization.tar.gz}"
dir="$(mktemp -d "${TMPDIR:-/tmp}/composition-organization-backup.XXXXXX")"
trap 'rm -rf "$dir"' EXIT

"$here/make-test-backup.sh" "$dir/base.tar.gz" > /dev/null
mkdir "$dir/backup"
tar -xzf "$dir/base.tar.gz" -C "$dir/backup"
python3 - "$dir/backup/composition.db" <<'PY'
import sqlite3, sys
db = sqlite3.connect(sys.argv[1])
stamp = "2026-11-01T00:00:00.000Z"
db.execute("INSERT INTO notebooks (name, created_at, updated_at) VALUES ('Work', ?, ?)", (stamp, stamp))
# (name, parent id, notebook id), in id order
for name, parent, notebook in [("Projects", None, 1), ("Reading", None, 1), ("2026", 1, 1), ("Archive", 3, 1), ("Meetings", None, 2), ("Ideas", None, 2)]:
    db.execute("INSERT INTO groups (name, parent_id, notebook_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", (name, parent, notebook, stamp, stamp))
# (first note, last note, group id, notebook id)
for first, last, group, notebook in [(1, 6, 1, 1), (7, 9, 3, 1), (10, 11, 4, 1), (12, 15, 2, 1), (16, 20, 5, 2), (21, 23, 6, 2), (24, 26, None, 2)]:
    db.execute("UPDATE notes SET group_id = ?, notebook_id = ? WHERE id BETWEEN ? AND ?", (group, notebook, first, last))
db.commit()
db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
db.execute("PRAGMA journal_mode = DELETE")
db.close()
PY
rm -f "$dir/backup/composition.db-wal" "$dir/backup/composition.db-shm"
# A backup without settings leaves the iPad's as they are, so these say outright that nothing is pinned.
printf '{"favorites":[]}\n' > "$dir/backup/settings.json"
COPYFILE_DISABLE=1 tar -czf "$out" -C "$dir/backup" composition-backup.json composition.db settings.json app_data
echo "Wrote $out ($(du -h "$out" | cut -f1)): two notebooks, six groups, 26 notes in them."
