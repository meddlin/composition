#!/usr/bin/env bash
# Measures the web app on one sample database.
#
#   scripts/sample-db/measure/run-suite.sh <database-dir> [sections]
#
# <database-dir> holds a composition.db from generate.mjs. It is copied first, so the run's edits (autosave rewrites the notes
# it types into) never touch the original. The app must be built (`pnpm --dir apps/web build`): a development server renders
# several times slower and says little about a real install. Sections and the other knobs are described in measure.mjs.
#
# Environment: RESULTS_DIR (where <name>.json goes; default: the temporary run folder, printed at the end), plus
# STEP_TIMEOUT_MS, TYPE_BUDGET_MS, COLLAPSE_FIRST and REGULAR_UNGROUPED (see measure.mjs).
#
# It picks a free port, starts `next start` on the copy, checks the process it started is the one that is ready (never
# a leftover server on the same port), runs the measurements, and stops that server. It does not touch any other process.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
APP=$(cd "$HERE/../../.." && pwd)
SRC=$(cd "${1:?usage: run-suite.sh <database-dir> [sections]}" && pwd) || exit 2
SECTIONS=${2:-load,sidebar,open,typing,autosave,pages,linkpicker}
NAME=$(basename "$SRC")

[ -f "$SRC/composition.db" ] || { echo "no composition.db in $SRC"; exit 2; }
[ -d "$APP/.next" ] || { echo "build the app first: pnpm --dir apps/web build"; exit 2; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/composition-stress-run.XXXXXX")
RESULTS=${RESULTS_DIR:-$WORK}
mkdir -p "$RESULTS"
SERVER_PID=""

# `npx` starts `sh`, which starts the server: stopping only the first would leave the server running.
kill_tree() {
  local pid=$1 child
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null
}
cleanup() {
  [ -z "$SERVER_PID" ] || kill_tree "$SERVER_PID"
  # With RESULTS_DIR set the run folder (a copy of the database, 20 to 230 MB) is no longer needed once the server's log,
  # which is where an error behind a failed step shows up, has been kept next to the results. Without it, the results are
  # in the run folder itself, so it stays.
  if [ "$RESULTS" != "$WORK" ] && [ -n "$WORK" ] && [ -d "$WORK" ]; then
    [ ! -f "$WORK/server.log" ] || cp "$WORK/server.log" "$RESULTS/$NAME.server.log" 2> /dev/null
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

cp "$SRC/composition.db" "$WORK/composition.db"
printf '{ "appDataDir": "%s" }\n' "$WORK" > "$WORK/settings.json"

# A port nothing is listening on, so whatever answers on it later is ours.
PORT=$(node -e 'const s = require("net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });')

(cd "$APP" && COMPOSITION_SETTINGS_PATH="$WORK/settings.json" exec npx next start -p "$PORT" > "$WORK/server.log" 2>&1) &
SERVER_PID=$!

for _ in $(seq 1 120); do
  grep -q "Ready in" "$WORK/server.log" 2>/dev/null && break
  grep -q "Failed to start\|EADDRINUSE" "$WORK/server.log" 2>/dev/null && { echo "server failed to start:"; head -5 "$WORK/server.log"; exit 4; }
  sleep 0.5
done
grep -q "Ready in" "$WORK/server.log" || { echo "server did not become ready:"; head -5 "$WORK/server.log"; exit 4; }
grep -q "localhost:$PORT" "$WORK/server.log" || { echo "the server that is ready is not on port $PORT"; exit 5; }
echo "serving a copy of $NAME on port $PORT (run folder $WORK)"

REGULAR_TITLE=$(node "$HERE/pick-regular.mjs" "$WORK") || exit 3
export REGULAR_TITLE
echo "regular note: $REGULAR_TITLE"

node "$HERE/measure.mjs" "$NAME" "$PORT" "$RESULTS/$NAME.json" "$SECTIONS"
STATUS=$?
echo "results: $RESULTS/$NAME.json"
exit "$STATUS"
