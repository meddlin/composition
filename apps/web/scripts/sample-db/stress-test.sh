#!/usr/bin/env bash
# The stress test in one command: build the web app, make the sample databases, run the browser suite on each, and print
# what it found. The weekly workflow (.github/workflows/stress-test.yml) runs exactly this, so a run here is a run there.
#
#   pnpm manual:stress                         1,000 and 10,000 notes (a few minutes each)
#   pnpm manual:stress --quick                 1,000 notes, load/open/typing only (about 2 minutes): a smoke test
#   pnpm manual:stress --sizes 1k,10k,50k      add the 50,000-note run (needs about 4 GB for the server and more for the browser)
#   pnpm manual:stress --skip-build            reuse the last build (it will not notice code changes since)
#
# Exit status: 0 when every step completed, 1 when a step timed out, a tab crashed or a run stopped early, 2 on a usage or
# set-up problem. How slow things are is reported, never failed on: that moves with the machine.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
APP=$(cd "$HERE/../.." && pwd)
REPO=$(cd "$APP/../.." && pwd)

usage() {
  cat <<'EOF'
Usage: stress-test.sh [options]

  --sizes LIST          databases to run, comma separated: 1k, 10k, 50k or a note count (default 1k,10k)
  --sections LIST       what to measure: load,sidebar,open,typing,autosave,pages,linkpicker (default: all but heavy;
                        50k defaults to load,open,typing,autosave,pages, see below)
  --quick               1k, load/open/typing only: about two minutes
  --lean                leave out the giant edge-case notes (--no-huge), to see what the note count alone costs
  --seed N              random seed for the databases (default 1)
  --results DIR         where the JSON, summary.md and build.log go (default: stress-results/<time> at the repo root)
  --skip-build          do not rebuild the app first (the default builds, so the numbers match the code)
  --install-playwright  install the pinned Playwright and its Chromium if it is not found (into ~/.cache, not the repo)
  --keep-databases      keep the generated databases (about 20, 60 and 230 MB) instead of deleting them
  -h, --help            this text

Needs: node, pnpm, `pnpm --dir apps/web install`, and Playwright (or --install-playwright).

The 50,000-note run holds every group closed from the start and works in an ungrouped note: with the groups open the
browser tab runs out of memory (see docs/stress-test-findings.md). It also gets longer step timeouts.
EOF
}

fail() {
  echo "stress-test: $*" >&2
  exit 2
}

SIZES=""
SECTIONS=""
RESULTS=""
SEED=1
BUILD=1
LEAN=0
QUICK=0
INSTALL_PLAYWRIGHT=0
KEEP=0

while [ $# -gt 0 ]; do
  case $1 in
    --sizes | --sections | --results | --seed)
      [ $# -ge 2 ] || fail "$1 needs a value"
      case $1 in
        --sizes) SIZES=$2 ;;
        --sections) SECTIONS=$2 ;;
        --results) RESULTS=$2 ;;
        --seed) SEED=$2 ;;
      esac
      shift 2
      ;;
    --quick) QUICK=1; shift ;;
    --lean) LEAN=1; shift ;;
    --skip-build) BUILD=0; shift ;;
    --install-playwright) INSTALL_PLAYWRIGHT=1; shift ;;
    --keep-databases) KEEP=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) echo "stress-test: unknown option $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$QUICK" = 1 ]; then
  : "${SIZES:=1k}"
  : "${SECTIONS:=load,open,typing}"
fi
: "${SIZES:=1k,10k}"
case $SEED in '' | *[!0-9]*) fail "--seed must be a whole number" ;; esac

notes_for() {
  case $1 in
    1k) echo 1000 ;;
    10k) echo 10000 ;;
    50k) echo 50000 ;;
    '' | *[!0-9]*) return 1 ;;
    *) echo "$1" ;;
  esac
}

IFS=',' read -r -a SIZE_LIST <<< "$SIZES"
for size in "${SIZE_LIST[@]}"; do
  notes_for "$size" > /dev/null || fail "unknown size '$size' (use 1k, 10k, 50k or a number of notes)"
done

# ---- prerequisites -----------------------------------------------------------------------------------------------------
command -v node > /dev/null || fail "node was not found"
[ "$BUILD" = 0 ] || command -v pnpm > /dev/null || fail "pnpm was not found (it builds the app; --skip-build avoids it)"
[ -d "$APP/node_modules" ] || fail "the web dependencies are not installed: run  pnpm --dir apps/web install"

PLAYWRIGHT_VERSION=$(tr -d '[:space:]' < "$HERE/measure/PLAYWRIGHT_VERSION")
playwright_found() { (cd "$HERE/measure" && node -e 'require.resolve("playwright/package.json")' > /dev/null 2>&1); }

if [ "$INSTALL_PLAYWRIGHT" = 1 ]; then
  if ! playwright_found; then
    cache="${COMPOSITION_STRESS_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/composition-stress}/playwright-$PLAYWRIGHT_VERSION"
    mkdir -p "$cache" || fail "could not create $cache"
    echo "Installing Playwright $PLAYWRIGHT_VERSION into $cache"
    npm install --prefix "$cache" --no-save --no-audit --no-fund "playwright@$PLAYWRIGHT_VERSION" > /dev/null || fail "npm could not install playwright@$PLAYWRIGHT_VERSION"
    export NODE_PATH="$cache/node_modules${NODE_PATH:+:$NODE_PATH}"
    playwright_found || fail "Playwright was installed into $cache but cannot be loaded from here"
  fi
  # The package is there, so make sure its browser is too (a no-op when it is). PLAYWRIGHT_WITH_DEPS=1 also installs the
  # system libraries it needs, which a fresh Linux machine or CI runner may lack.
  playwright_cli="$(cd "$HERE/measure" && node -p 'require("path").dirname(require.resolve("playwright/package.json"))')/cli.js"
  install_args=(install chromium)
  [ -z "${PLAYWRIGHT_WITH_DEPS:-}" ] || install_args+=(--with-deps)
  echo "Making sure Chromium is installed for Playwright"
  node "$playwright_cli" "${install_args[@]}" > /dev/null || fail "Playwright could not install Chromium"
elif ! playwright_found; then
  fail "Playwright is not installed. Run this again with --install-playwright, or:
    npm install --global playwright@$PLAYWRIGHT_VERSION && npx playwright install chromium
  and, if it still is not found, set NODE_PATH to the global node_modules (npm root -g)."
fi

# ---- where things go ---------------------------------------------------------------------------------------------------
[ -n "$RESULTS" ] || RESULTS="$REPO/stress-results/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RESULTS" || fail "could not create $RESULTS"
RESULTS=$(cd "$RESULTS" && pwd)

WORK=$(mktemp -d "${TMPDIR:-/tmp}/composition-stress.XXXXXX") || fail "could not make a temporary folder"
cleanup() {
  if [ "$KEEP" = 1 ]; then
    echo "Databases kept in $WORK"
  elif [ -n "${WORK:-}" ] && [ -d "$WORK" ]; then
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

# ---- build -------------------------------------------------------------------------------------------------------------
if [ "$BUILD" = 1 ]; then
  echo "Building the web app (log: $RESULTS/build.log)"
  # A throwaway settings file, so building can never touch the data folder of the app you actually use.
  printf '{ "appDataDir": "%s" }\n' "$WORK/build-data" > "$WORK/build-settings.json"
  if ! COMPOSITION_SETTINGS_PATH="$WORK/build-settings.json" pnpm --dir "$APP" build > "$RESULTS/build.log" 2>&1; then
    tail -30 "$RESULTS/build.log" >&2
    fail "the build failed (full log: $RESULTS/build.log)"
  fi
elif [ ! -d "$APP/.next" ]; then
  fail "--skip-build, but there is no build yet: run  pnpm --dir apps/web build"
fi

# ---- run each size -----------------------------------------------------------------------------------------------------
status=0
result_files=()
for size in "${SIZE_LIST[@]}"; do
  notes=$(notes_for "$size")
  label=$size
  [ "$LEAN" = 0 ] || label="$size-lean"
  db="$WORK/$label"

  generate=(node "$HERE/generate.mjs" --notes "$notes" --out "$db" --seed "$SEED" --force)
  [ "$LEAN" = 0 ] || generate+=(--no-huge)
  echo
  echo "== $label: making $notes notes"
  "${generate[@]}" > "$WORK/generate-$label.log" 2>&1 || { cat "$WORK/generate-$label.log" >&2; fail "could not generate the $label database"; }

  sections=$SECTIONS
  run_env=()
  if [ "$notes" -ge 50000 ]; then
    echo "   (50,000 notes: groups held closed from the start, longer timeouts; see --help)"
    [ -n "$sections" ] || sections="load,open,typing,autosave,pages"
    run_env=(COLLAPSE_FIRST=1 REGULAR_UNGROUPED=1 "STEP_TIMEOUT_MS=${STEP_TIMEOUT_MS:-600000}")
  fi

  echo "== $label: measuring"
  suite=("$HERE/measure/run-suite.sh" "$db")
  [ -z "$sections" ] || suite+=("$sections")
  env "${run_env[@]}" RESULTS_DIR="$RESULTS" "${suite[@]}" || status=1
  # Listed even if the run left no file, so the summary reports it as a failure instead of leaving it out.
  result_files+=("$RESULTS/$label.json")
done

# ---- summary -----------------------------------------------------------------------------------------------------------
echo
node "$HERE/measure/summarize.mjs" "${result_files[@]}" | tee "$RESULTS/summary.md"
[ "${PIPESTATUS[0]}" = 0 ] || status=1

echo
echo "Results: $RESULTS"
exit "$status"
