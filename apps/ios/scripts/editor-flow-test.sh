#!/usr/bin/env bash
# Build plan Step 6: the rows the app writes when a person uses it are the rows the desktop writes for the same operations.
#
# In the iPad Simulator, from a restored desktop backup, the Debug build is made to do what the buttons do: make a note (the + button), type into
# the editor (`-autotype`, the keyboard's `insertText` path), go to the background (which saves), move the note to the Trash Can, restore it. Then
# the desktop's real `service.ts` is given the same operations on a copy of the starting database, with the clock set to the moments the app's rows
# record, and every row of notes, groups, notebooks, trashed_notes and trashed_groups must be equal (apps/web/scripts/ios-conformance-fixtures.test.ts,
# "replays the operations the iPad's editor made").
#
# Usage: apps/ios/scripts/editor-flow-test.sh <simulator UDID> <path to the Debug Composition.app> <backup.tar.gz>
# The backup is any desktop backup (conformance.sh makes desktop-backup.tar.gz). Needs the web dependencies and sqlite3.
set -euo pipefail

udid="${1:?simulator UDID, or booted}"
app="${2:?path to the built (Debug) Composition.app}"
backup="${3:?a backup .tar.gz to restore first}"
bundle="com.rushinglabs.composition.ipad.dev"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
run="$(mktemp -d "${TMPDIR:-/tmp}/composition-editor-flow.XXXXXX")"
typed=$'Typed in the editor: **bold**, `code` and a [link](https://example.com).\n\n- one\n- two\n'

xcrun simctl install "$udid" "$app"
data() { xcrun simctl get_app_container "$udid" "$bundle" data; }
support() { echo "$(data)/Library/Application Support/Composition"; }
db() { echo "$(support)/composition.db"; }
launch() { xcrun simctl launch "$udid" "$bundle" "$@" >/dev/null; }
end_app() { xcrun simctl terminate "$udid" "$bundle" >/dev/null 2>&1 || true; }
sql() { sqlite3 "$(db)" "$1"; }
wait_until() {  # wait_until <seconds> '<shell condition>'   (the condition is evaluated again on every try)
  local deadline=$((SECONDS + $1))
  until eval "$2" >/dev/null 2>&1; do [ $SECONDS -lt $deadline ] || { echo "timed out waiting for: $2" >&2; exit 1; }; sleep 0.3; done
}

echo "== a fresh restore of the backup"
end_app
rm -rf "$(support)"
launch -importBackup "$backup"
wait_until 60 '[ "$(sqlite3 "$(db)" "SELECT COUNT(*) FROM notes" 2>/dev/null || echo 0)" -gt 0 ]'
sleep 1
end_app
sql "PRAGMA wal_checkpoint(TRUNCATE)" >/dev/null
cp "$(db)" "$run/start.db"

echo "== make a note, type into it, go to the background"
rm -f "$(data)/tmp/autotype."*
launch -newNote 1 -openMode Markdown -autotype "$typed" -autotypeInterval 0.02 -autosaveQuiet 30
wait_until 60 '[ -f "$(data)/tmp/autotype.done" ]'
xcrun simctl launch "$udid" com.apple.Preferences >/dev/null
sleep 2
end_app
note="$(sql "SELECT MAX(id) FROM notes")"
echo "  the note is $note: $(sql "SELECT title FROM notes WHERE id = $note")"

echo "== move it to the Trash Can, as the button does"
launch -trashNote "$note"
wait_until 30 '[ "$(sql "SELECT COUNT(*) FROM trashed_notes WHERE id = $note")" -eq 1 ]'
sleep 1
deleted_at="$(sql "SELECT deleted_at FROM trashed_notes WHERE id = $note")"
end_app

echo "== restore it"
launch -restoreNote "$note"
wait_until 30 '[ "$(sql "SELECT COUNT(*) FROM notes WHERE id = $note")" -eq 1 ]'
sleep 1
end_app
sql "PRAGMA wal_checkpoint(TRUNCATE)" >/dev/null
cp "$(db)" "$run/end.db"

python3 - "$run" "$note" "$deleted_at" "$typed" <<'PY'
import json, sqlite3, sys
run, note, deleted_at, typed = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
row = sqlite3.connect(f"{run}/end.db").execute("SELECT title, created_at, updated_at FROM notes WHERE id = ?", (note,)).fetchone()
json.dump({"noteId": note, "title": row[0], "createdAt": row[1], "updatedAt": row[2], "deletedAt": deleted_at, "typed": typed}, open(f"{run}/ui-run.json", "w"), indent=2)
PY
echo "  recorded in $run"

echo "== the desktop's service does the same operations on the starting database"
(cd "$root/apps/web" && IOS_UI_RUN_DIR="$run" node node_modules/vitest/vitest.mjs run scripts/ios-conformance-fixtures.test.ts -t "replays the operations")
echo "== the rows match the desktop's"
