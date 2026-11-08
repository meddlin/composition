#!/usr/bin/env bash
# Build plan Step 4, spike S6 ("no lost keystrokes"): type into a note in the iPad Simulator, end the app in the ways iOS does,
# and look at what is left in the database and in the draft file. Three cases, each from a fresh restore of the same backup:
#
#   A  the app is killed right after typing, inside the pause before the database is written (`simctl terminate`, which gives
#      the app no chance to run anything): the typed text must be in the draft file, and back in the note after a relaunch
#   B  the app is sent to the background right after typing (another app comes forward): the note must already hold the text,
#      and still hold it after a kill and a relaunch
#   C  the app is killed in the middle of a slow burst of typing: after a relaunch the note holds everything typed but, at
#      most, the last character
#
# The typing is the Debug build's `-autotype` launch argument, which inserts the text one character at a time into the editor's
# text view (`UITextView.insertText`, the path the keyboard takes), and writes its progress to a file in the app's tmp folder.
#
# Usage: apps/ios/scripts/autosave-kill-test.sh <simulator UDID or "booted"> <path to Composition.app> <backup.tar.gz> [note id]
# The backup is any desktop backup (conformance.sh makes desktop-backup.tar.gz). The app must be a Debug build.
set -euo pipefail

udid="${1:?simulator UDID, or booted}"
app="${2:?path to the built Composition.app}"
backup="${3:?a backup .tar.gz to restore before each case}"
note="${4:-1}"
bundle="com.rushinglabs.composition.ipad.dev"
failures=0

command -v sqlite3 >/dev/null || { echo "sqlite3 is needed" >&2; exit 1; }
xcrun simctl install "$udid" "$app"

data() { xcrun simctl get_app_container "$udid" "$bundle" data; }
support() { echo "$(data)/Library/Application Support/Composition"; }
content() { sqlite3 "$(support)/composition.db" "SELECT content FROM notes WHERE id = $note"; }
draft() { local file="$(support)/drafts/$note.json"; [ -f "$file" ] && cat "$file" || true; }
launch() { xcrun simctl launch "$udid" "$bundle" "$@" >/dev/null; }
end_app() { xcrun simctl terminate "$udid" "$bundle" >/dev/null 2>&1 || true; }

check() {  # check <description> <command...>
  local description="$1"; shift
  if "$@"; then echo "  ok    $description"; else echo "  FAIL  $description"; failures=$((failures + 1)); fi
}
has() { [[ "$1" == *"$2"* ]]; }

wait_for_file() {  # wait_for_file <path> <seconds>
  local deadline=$((SECONDS + $2))
  while [ ! -f "$1" ]; do
    [ $SECONDS -lt $deadline ] || { echo "  timed out waiting for $1"; return 1; }
    sleep 0.05
  done
}

fresh() {  # a restored copy of the backup, with no draft left over
  end_app
  rm -rf "$(support)" 2>/dev/null || true
  launch -importBackup "$backup"
  local deadline=$((SECONDS + 60))
  until [ -f "$(support)/composition.db" ] && [ "$(sqlite3 "$(support)/composition.db" 'SELECT COUNT(*) FROM notes' 2>/dev/null || echo 0)" -gt 0 ]; do
    [ $SECONDS -lt $deadline ] || { echo "the backup did not restore" >&2; exit 1; }
    sleep 0.5
  done
  sleep 1
  end_app
  rm -f "$(data)/tmp/autotype."* 2>/dev/null || true
}

type_into_note() {  # type_into_note <text> <seconds between characters>
  # A pause of 30 seconds before a save: within each case only leaving the foreground, or the draft file, can save the typing.
  launch -openNote "$note" -openMode Markdown -autotype "$1" -autotypeInterval "$2" -autosaveQuiet 30
}

echo "== A: killed right after typing, inside the pause before the save"
fresh
text="AUTOSAVE-A the quick brown fox jumps over the lazy dog"
type_into_note "$text" 0.01
wait_for_file "$(data)/tmp/autotype.done" 60
end_app
echo "  after the kill: the note holds it: $(has "$(content)" "$text" && echo yes || echo no); the draft holds it: $(has "$(draft)" "$text" && echo yes || echo no)"
check "what was typed survived the kill, in the note or in the draft" bash -c "[[ \"\$(sqlite3 '$(support)/composition.db' 'SELECT content FROM notes WHERE id = $note')\" == *'$text'* || \"\$(cat '$(support)/drafts/$note.json' 2>/dev/null)\" == *'$text'* ]]"
launch
sleep 4
check "after a relaunch the note holds it" has "$(content)" "$text"
check "and no draft is left" test ! -f "$(support)/drafts/$note.json"
end_app

echo "== B: sent to the background right after typing"
fresh
text="AUTOSAVE-B pack my box with five dozen liquor jugs"
type_into_note "$text" 0.01
wait_for_file "$(data)/tmp/autotype.done" 60
xcrun simctl launch "$udid" com.apple.Preferences >/dev/null
sleep 1.5  # inside the pause: only leaving the foreground can have written it
check "leaving the foreground wrote the note" has "$(content)" "$text"
end_app
launch
sleep 4
check "after a kill and a relaunch it is still there" has "$(content)" "$text"
end_app

echo "== C: killed in the middle of a slow burst of typing"
fresh
text="AUTOSAVE-C sphinx of black quartz judge my vow, and keep typing for some time longer"
type_into_note "$text" 0.15
wait_for_file "$(data)/tmp/autotype.progress" 30
until [ "$(cat "$(data)/tmp/autotype.progress" 2>/dev/null || echo 0)" -ge 25 ]; do sleep 0.05; done
end_app
typed="$(cat "$(data)/tmp/autotype.progress")"
launch
sleep 4
after="$(content)"
kept=0
for ((n = ${#text}; n >= 1; n--)); do has "$after" "${text:0:n}" && { kept=$n; break; }; done
echo "  typed at least $typed characters before the kill; the note holds $kept of the first characters"
check "at most the last character was lost" test "$kept" -ge $((typed - 1))
end_app

[ $failures -eq 0 ] && echo "== no keystrokes lost" || { echo "== $failures check(s) failed"; exit 1; }
