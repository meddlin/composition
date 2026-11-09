#!/usr/bin/env bash
# M2, the PDFs: what the app does with a PDF's file as the notes around it move, checked in the iPad Simulator on the Debug build.
#
# From a restored desktop backup, the app is made to import a PDF (`-importPdf`, which does what the Import PDF picker does), and then to do what the
# Trash Can screen does with the note that owns it. After each step the database and the `documents/` folder are looked at:
#
#   import                    a note, a `documents` row and one file in `documents/`, named as the desktop names them
#   the same PDF again        nothing new: no second note, no second file (the app would ask)
#   something that is no PDF  nothing left behind: no note, no file, no hidden temporary copy
#   to the Trash Can          the row and the file stay (a restore finds them again)
#   restore                   still there, and the note is back
#   to the Trash Can, delete for good      the row, its marks and its bookmarks, and the file, are gone
#
# Usage: apps/ios/scripts/pdf-flow-test.sh <simulator UDID> <path to the Debug Composition.app> <backup.tar.gz>
# The backup is any desktop backup (conformance.sh makes desktop-backup.tar.gz; ui-test.sh makes an organization one). Needs sqlite3 and python3.
set -euo pipefail

udid="${1:?simulator UDID, or booted}"
app="${2:?path to the built (Debug) Composition.app}"
backup="${3:?a backup .tar.gz to restore first}"
bundle="com.rushinglabs.composition.ipad.dev"
run="$(mktemp -d "${TMPDIR:-/tmp}/composition-pdf-flow.XXXXXX")"
trap 'rm -rf "$run"' EXIT

xcrun simctl install "$udid" "$app"
data() { xcrun simctl get_app_container "$udid" "$bundle" data; }
support() { echo "$(data)/Library/Application Support/Composition"; }
db() { echo "$(support)/composition.db"; }
launch() { xcrun simctl launch "$udid" "$bundle" "$@" >/dev/null; }
end_app() { xcrun simctl terminate "$udid" "$bundle" >/dev/null 2>&1 || true; }
sql() { sqlite3 "$(db)" "$1"; }
files() { ls -A "$(support)/documents" 2>/dev/null | wc -l | tr -d ' '; }
wait_until() {  # wait_until <seconds> '<shell condition>'   (the condition is evaluated again on every try)
  local deadline=$((SECONDS + $1))
  until eval "$2" >/dev/null 2>&1; do [ $SECONDS -lt $deadline ] || { echo "timed out waiting for: $2" >&2; exit 1; }; sleep 0.3; done
}
check() {  # check '<description>' '<shell condition>'
  if eval "$2" >/dev/null 2>&1; then echo "  ok: $1"; else echo "  FAILED: $1" >&2; exit 1; fi
}

# A one-page PDF, made here so that the script needs nothing else.
python3 - "$run/Field Notes.pdf" <<'PY'
import sys
objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    None,
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]
stream = b"BT /F1 24 Tf 72 700 Td (Field notes) Tj ET"
objects[3] = b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
out = bytearray(b"%PDF-1.4\n")
offsets = []
for number, body in enumerate(objects, 1):
    offsets.append(len(out))
    out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
xref = len(out)
out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
for offset in offsets:
    out += b"%010d 00000 n \n" % offset
out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
open(sys.argv[1], "wb").write(out)
PY
printf 'this is not a PDF\n' > "$run/Not A Book.pdf"

echo "== a fresh restore of the backup"
end_app
rm -rf "$(support)"
launch -importBackup "$backup"
wait_until 60 '[ "$(sqlite3 "$(db)" "SELECT COUNT(*) FROM notes" 2>/dev/null || echo 0)" -gt 0 ]'
sleep 1
end_app
notes_before="$(sql "SELECT COUNT(*) FROM notes")"
check "the backup had no PDFs" '[ "$(sql "SELECT COUNT(*) FROM documents")" -eq 0 ]'

echo "== import a PDF"
launch -importPdf "$run/Field Notes.pdf"
wait_until 60 '[ "$(sql "SELECT COUNT(*) FROM documents")" -eq 1 ]'
sleep 1
end_app
note="$(sql "SELECT note_id FROM documents")"
stored="$(sql "SELECT stored_name FROM documents")"
check "a note was made for it" '[ "$(sql "SELECT COUNT(*) FROM notes")" -eq $((notes_before + 1)) ]'
check "the note is named after the file" '[ "$(sql "SELECT title FROM notes WHERE id = $note")" = "Field Notes" ]'
check "one file is in documents/, under the stored name (twelve hex digits, then the name)" '[ "$(files)" -eq 1 ] && [ -f "$(support)/documents/$stored" ] && [[ "$stored" =~ ^[0-9a-f]{12}-Field ]]'
check "the row says what the file holds (hash, size, one page)" '[ "$(sql "SELECT size FROM documents")" -eq "$(stat -f %z "$(support)/documents/$stored")" ] && [ "$(sql "SELECT page_count FROM documents")" -eq 1 ] && [ "$(sql "SELECT length(sha256) FROM documents")" -eq 64 ]'
check "the file is the same bytes (sha256)" '[ "$(shasum -a 256 "$(support)/documents/$stored" | cut -d" " -f1)" = "$(sql "SELECT sha256 FROM documents")" ]'
check "the row has a uuid" '[ "$(sql "SELECT length(uuid) FROM documents")" -eq 32 ]'

echo "== the same PDF again: nothing new"
launch -importPdf "$run/Field Notes.pdf"
sleep 6
end_app
check "no second note, row or file" '[ "$(sql "SELECT COUNT(*) FROM notes")" -eq $((notes_before + 1)) ] && [ "$(sql "SELECT COUNT(*) FROM documents")" -eq 1 ] && [ "$(files)" -eq 1 ]'

echo "== something that is not a PDF: nothing left behind"
launch -importPdf "$run/Not A Book.pdf"
sleep 6
end_app
check "no note, row or file, and no hidden temporary copy" '[ "$(sql "SELECT COUNT(*) FROM notes")" -eq $((notes_before + 1)) ] && [ "$(sql "SELECT COUNT(*) FROM documents")" -eq 1 ] && [ "$(files)" -eq 1 ]'

echo "== move the note to the Trash Can"
launch -trashNote "$note"
wait_until 30 '[ "$(sql "SELECT COUNT(*) FROM trashed_notes WHERE id = $note")" -eq 1 ]'
sleep 1
end_app
check "the row and the file stay while the note is in the Trash Can" '[ "$(sql "SELECT COUNT(*) FROM documents WHERE note_id = $note")" -eq 1 ] && [ -f "$(support)/documents/$stored" ]'

echo "== restore it"
launch -restoreNote "$note"
wait_until 30 '[ "$(sql "SELECT COUNT(*) FROM notes WHERE id = $note")" -eq 1 ]'
sleep 1
end_app
check "the PDF is still the note's" '[ "$(sql "SELECT COUNT(*) FROM documents WHERE note_id = $note")" -eq 1 ] && [ -f "$(support)/documents/$stored" ]'

echo "== bookmark it, move it to the Trash Can, delete it for good"
sql "INSERT INTO pdf_bookmarks (document_id, page, label, created_at) SELECT id, 0, 'first page', '2026-11-09T00:00:00.000Z' FROM documents"
launch -trashNote "$note" -purgeNote "$note"
wait_until 30 '[ "$(sql "SELECT COUNT(*) FROM trashed_notes WHERE id = $note")" -eq 0 ] && [ "$(sql "SELECT COUNT(*) FROM documents")" -eq 0 ]'
sleep 1
end_app
check "the row, its bookmarks and its file are gone" '[ "$(sql "SELECT COUNT(*) FROM documents")" -eq 0 ] && [ "$(sql "SELECT COUNT(*) FROM pdf_bookmarks")" -eq 0 ] && [ "$(files)" -eq 0 ]'
echo "== the PDF's file follows its note, as the desktop's does"
