#!/usr/bin/env bash
#
# Guided manual test of backup and restore, for one app at a time.
#
#   scripts/manual-tests/backup-restore.sh cli
#   scripts/manual-tests/backup-restore.sh web
#   scripts/manual-tests/backup-restore.sh desktop
#
# (or `pnpm manual:backup <app>` from the repo root). It builds a scratch home full of known
# data, tells you how to start the app on it, walks you through creating a backup, losing
# everything, restoring, and then checks, from the command line, that every note, image,
# attachment and setting came back. Your real notes are never touched.
# See docs/manual-tests/backup-restore.md.
#
# Everything above the "STAGES" marker is the wizard library: do not hand-edit
# it. The per-step stages are below the marker.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library: delightful, consistent UX, identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

# Author sets this at the top of the stages section.
TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()    # KEYs written to ENV_FILE this run
WRITTEN_SECRET=() # secret NAMEs set this run
SKIPPED=()        # things we couldn't do (e.g. gh missing)

# _clear wipes the terminal so only the current step is on screen. No-op when
# output isn't a terminal, so piped logs stay readable.
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

# banner "Title" shows the opening frame: what this wizard does.
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s stages%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  You drive the browser; this wizard tells you exactly what to do and\n' "$DIM"
  printf '  captures the values you copy back. Stop any time with Ctrl-C and re-run\n'
  printf '  later, since it remembers values already saved.%s\n' "$RESET"
  pause "Ready to start?"
}

# stage "Name" clears the screen, then announces a stage and shows progress.
# Clearing keeps only the current step on screen.
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# say "..." prints a plain instruction line.
say()  { printf '  %s\n' "$1"; }
# step "..." is a numbered-feeling action the human takes in the browser.
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# open_url URL opens it in the human's browser, cross-platform incl. WSL.
open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else warn "couldn't open a browser; visit it manually: $url"; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser, so visit it manually: $url"
}

# pause "msg" waits for the human to confirm they've done the manual part.
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

# confirm "question" is a y/N gate; returns success on yes.
confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

# _existing KEY: current value of KEY in ENV_FILE, if any.
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

# ask KEY "Prompt" reads a value into $KEY. Offers the existing .env value as
# a default on re-runs (Enter keeps it). Visible input (non-secret).
ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# ask_secret KEY "Prompt" is like ask, but input is hidden.
ask_secret() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# write_env KEY VALUE upserts KEY=VALUE into ENV_FILE (creates it; replaces
# any existing line). Idempotent.
write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

# set_secret NAME VALUE sets a GitHub Actions repo secret via gh. Falls back
# to a warning (and records it) if gh is unavailable or unauthenticated.
set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (set it manually: gh secret set $name)")
  warn "skipped GitHub secret $name: gh not ready; set it later"
}

# set_var NAME VALUE sets a GitHub Actions repo variable (non-secret).
set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name, gh not ready; set it later"
}

# finish clears, then shows a closing summary of everything configured.
finish() {
  _clear
  printf '\n%s%s  ✓ Setup complete%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "wrote ${#WRITTEN_ENV[@]} value(s) to $ENV_FILE: ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "set ${#WRITTEN_SECRET[@]} GitHub secret(s): ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "still to do by hand:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# STAGES
# ──────────────────────────────────────────────────────────────────────────

APP="${1:-}"
case "$APP" in
  cli|web|desktop) ;;
  *) printf 'Usage: %s <cli|web|desktop>\n' "$0" >&2; exit 2 ;;
esac

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

SCRATCH="${COMPOSITION_MANUAL_HOME:-${TMPDIR:-/tmp}/composition-manual-backup-$APP}"
SCRATCH="${SCRATCH%/}"
ENV_FILE="$SCRATCH.env" # only remembers answers between runs; nothing is written to the repo
TOOL=(node "$REPO/apps/cli/dist/backup-manual.mjs")
BACKUPS_DEFAULT="$SCRATCH/Composition Backups"

TOTAL_STAGES=9

# tool ARGS... runs the helper; its output is shown as it is.
tool() { "${TOOL[@]}" "$@"; }

# newest_backup prints the most recently written backup file under the scratch home, if any.
newest_backup() {
  # shellcheck disable=SC2012
  ls -t "$SCRATCH"/Composition\ Backups/composition-backup-*.tar.gz "$SCRATCH"/backups/*.tar.gz 2>/dev/null | head -n1 || true
}

# launch_hint prints the command that starts this app on the scratch home.
launch_hint() {
  printf '\n    %s%s%s\n\n' "$BOLD" "$(tool launch --app "$APP" --home "$SCRATCH")" "$RESET"
  note "(run it from the repo root: $REPO)"
}

# verify_expecting pass|fail runs verify and says whether the outcome is what we hoped for.
verify_expecting() {
  local want="$1" status=0
  tool verify --home "$SCRATCH" || status=$?
  printf '\n'
  if [[ "$want" == pass && $status -eq 0 ]]; then
    printf '  %s✓ Everything matches what was there before.%s\n' "$GREEN" "$RESET"
  elif [[ "$want" == fail && $status -ne 0 ]]; then
    printf '  %s✓ As expected: the data is gone.%s\n' "$GREEN" "$RESET"
  else
    FAILURES+=("stage $_STAGE_INDEX: verify gave ${status} (wanted $want)")
    printf '  %s✗ Not what was expected here. This is a bug, or a step was missed.%s\n' "$RED" "$RESET"
  fi
}

FAILURES=()

banner "Backup and restore · $APP app"

# ── 1 ─────────────────────────────────────────────────────────────────────
stage "Check the tools"
say "The checks run from the command line on Node 26 or newer (the terminal app's Node)."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if (( NODE_MAJOR < 26 )); then
  warn "You are on Node $(node -v). Run  nvm use 26  and start this again."
  exit 1
fi
for dir in apps/cli apps/web; do
  [[ -d "$dir/node_modules" ]] || { warn "$dir has no node_modules. Run  (cd $dir && pnpm install)  first."; exit 1; }
done
[[ "$APP" != desktop || -d apps/desktop/node_modules ]] || { warn "apps/desktop has no node_modules. Run  (cd apps/desktop && pnpm install)  first."; exit 1; }
say "Building the check tool…"
pnpm --dir apps/cli exec node scripts/build.mjs >/dev/null
say "Running its self-test (the whole backup → wipe → restore → verify loop, no app involved)…"
printf '\n'
tool selftest | tail -n 3 || { warn "the self-test failed; fix that before testing by hand"; exit 1; }
pause "Press Enter to build the test data."

# ── 2 ─────────────────────────────────────────────────────────────────────
stage "Create known test data"
say "A scratch home at:  $SCRATCH"
if [[ -e "$SCRATCH" ]]; then
  warn "It already exists from an earlier run."
  confirm "Delete it and start fresh?" || { warn "Can't build the test data on top of the old one."; exit 1; }
  rm -rf "$SCRATCH"
fi
printf '\n'
tool setup --app "$APP" --home "$SCRATCH"
printf '\n'
note "Notes, groups, a trashed note, one image, one attached file, and settings (Forest scheme, Austin, a pinned note)."
pause "Press Enter to start the app."

# ── 3 ─────────────────────────────────────────────────────────────────────
stage "Start the $APP app on that data"
say "Open a SECOND terminal, go to the repo root, and run:"
launch_hint
case "$APP" in
  cli)
    step "Wait for the tree. You should see the groups Projects (with Alpha inside) and the notes Welcome and Report note, plus ★ Favorites with Alpha plan."
    step "Open Picture note (Enter): the blue picture with an orange band is drawn in the preview."
    step "The color scheme is Forest (dark green)."
    note "If meilisearch isn't installed the tree still works; only search says it is off."
    ;;
  web)
    open_url "http://localhost:3000"
    step "Wait for http://localhost:3000. The sidebar shows Projects (with Alpha inside), Welcome and Report note, and Alpha plan under Favorites."
    step "Open Picture note: the blue picture with an orange band is in the preview. The scheme is Forest."
    note "The web app has no attachments UI; the attached file is checked on disk later."
    ;;
  desktop)
    step "An Electron window opens. The sidebar shows Projects (with Alpha inside), Welcome and Report note, and Alpha plan under Favorites."
    step "Open Report note: an Attachments table at the bottom lists Quarterly report.txt."
    step "Open Picture note: the blue picture with an orange band is in the preview. The scheme is Forest."
    ;;
esac
printf '\n'
pause "Press Enter once the app is up and the data looks right."

# ── 4 ─────────────────────────────────────────────────────────────────────
stage "Create a backup"
case "$APP" in
  cli)
    step "Select Settings (the last row of the tree) and press Enter."
    step "Press Tab three times, to the box \"Create a backup, in this folder\"."
    step "It already holds  $BACKUPS_DEFAULT  . Press Enter."
    step "The bottom line says: Backed up 4 notes, 2 groups, 1 image and 1 attached file (plus 1 item in the Trash Can) to …"
    ;;
  web)
    open_url "http://localhost:3000/settings"
    step "Scroll to the Backup card. The folder is already  $BACKUPS_DEFAULT"
    step "Click Create backup."
    step "A green message says: Backed up 4 notes, 2 groups, 1 image and 1 attached file (plus 1 item in the Trash Can) to …"
    ;;
  desktop)
    step "Click Settings in the sidebar, find the Backup card, and click \"Create backup…\"."
    step "In the save dialog, type this as the file name, then Save:"
    say "    $SCRATCH/backups/manual.tar.gz"
    step "A green message says: Backed up 4 notes, 2 groups, 1 image and 1 attached file (plus 1 item in the Trash Can) to …"
    ;;
esac
printf '\n'
pause "Press Enter when you see the message."
FOUND_BACKUP=$(newest_backup)
BACKUP_FILE=""
if [[ -n "$FOUND_BACKUP" ]]; then
  say "Found:  $FOUND_BACKUP"
  ask BACKUP_FILE "Press Enter to use it, or type another path:"
else
  ask BACKUP_FILE "Where did it go? Path of the backup file:"
fi
BACKUP_FILE="${BACKUP_FILE:-$FOUND_BACKUP}"
[[ -f "$BACKUP_FILE" ]] || { warn "No such file: $BACKUP_FILE"; exit 1; }
printf '\n'
if ! tool inspect --file "$BACKUP_FILE" --home "$SCRATCH"; then FAILURES+=("stage 4: the backup file is missing something"); fi
printf '\n'
note "Also readable by plain tar:  tar -tzf \"$BACKUP_FILE\""
pause "Press Enter to continue."

# ── 5 ─────────────────────────────────────────────────────────────────────
stage "Lose everything"
say "Now simulate a disaster: delete all the data. The app must be closed first."
step "In the second terminal, quit the app (CLI: q, then Enter if asked; web/desktop: Ctrl-C)."
pause "Press Enter once it has quit."
tool wipe --home "$SCRATCH" || { warn "Quit the app first (or re-run wipe with --force)."; exit 1; }
printf '\n'
verify_expecting fail
printf '\n'
step "Start the app again with the same command:"
launch_hint
step "It comes up empty: no notes, no groups, and the plain dark scheme."
pause "Press Enter once you have seen the empty app."

# ── 6 ─────────────────────────────────────────────────────────────────────
stage "Restore the backup"
say "Backup file:  $BACKUP_FILE"
case "$APP" in
  cli)
    step "Open Settings → Tab four times, to \"Restore from this backup file\"."
    step "Paste or type the path above, and press Enter."
    step "The bottom line asks you to press y to replace EVERYTHING. Press y."
    ;;
  web)
    open_url "http://localhost:3000/settings"
    step "In the Restore card, paste the path above into \"Backup file\"."
    step "Click Restore…, read the warning, and click Restore."
    ;;
  desktop)
    step "Settings → Restore card → \"Restore from backup…\" → read the warning → Restore."
    step "In the open dialog press Cmd+Shift+G, paste the path above, press Return, then Open."
    ;;
esac
step "It says: Restored 4 notes, 2 groups, 1 image and 1 attached file (plus 1 item in the Trash Can). What it replaced is saved in …"
case "$APP" in
  cli) step "Press Esc: the tree shows the notes again, and the scheme is Forest." ;;
  *)   step "The page reloads with the Forest scheme. Go back to the notes: Projects, Welcome, Report note and the favorite are back." ;;
esac
printf '\n'
pause "Press Enter when the restore has finished."

# ── 7 ─────────────────────────────────────────────────────────────────────
stage "Check what came back"
say "From the command line, with the app still running:"
printf '\n'
verify_expecting pass
printf '\n'
say "What the restore saved first (the way back from a restore):"
ls -1 "$BACKUPS_DEFAULT" 2>/dev/null | grep pre-restore | sed 's/^/    /' || note "  (none: there was nothing in the app to save)"
printf '\n'
case "$APP" in
  cli)     step "In the app: open Picture note and Alpha plan; the Trash (t) holds Deleted note." ;;
  web)     step "In the app: open Picture note (the picture shows) and Alpha plan; Settings → Trash Can holds Deleted note." ;;
  desktop) step "In the app: Picture note shows its picture, Report note lists Quarterly report.txt (try \"Save a copy…\" and compare it), and Settings → Trash Can holds Deleted note." ;;
esac
confirm "Does everything look right in the app too?" || FAILURES+=("stage 7: the app does not show the restored data")

# ── 8 ─────────────────────────────────────────────────────────────────────
stage "Try to restore something that is not a backup"
JUNK="$SCRATCH/not-a-backup.tar.gz"
printf 'this is not a backup\n' > "$JUNK"
say "A file that is not a backup must be refused and change nothing."
case "$APP" in
  cli)     step "Settings → Tab four times → paste  $JUNK  → Enter → y." ;;
  web)     step "Restore card → paste  $JUNK  → Restore… → Restore." ;;
  desktop) step "Restore from backup… → Restore → choose  $JUNK  in the open dialog (Cmd+Shift+G)." ;;
esac
step "A red message says this is not a Composition backup (or it is damaged)."
pause "Press Enter once you have seen it."
printf '\n'
verify_expecting pass

# ── 9 ─────────────────────────────────────────────────────────────────────
stage "Clean up"
step "Quit the app in the second terminal."
if (( ${#FAILURES[@]} )); then
  printf '\n'; warn "Problems found:"
  for f in "${FAILURES[@]}"; do note "  - $f"; done
else
  printf '\n  %s✓ Backup and restore work in the %s app.%s\n' "$GREEN" "$APP" "$RESET"
fi
printf '\n'
if confirm "Delete the scratch home ($SCRATCH)?"; then rm -rf "$SCRATCH" "$ENV_FILE"; say "Deleted."; else note "Kept: $SCRATCH"; fi
printf '\n'
(( ${#FAILURES[@]} == 0 ))
