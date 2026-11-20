#!/usr/bin/env bash
# Checks the Kotlin core against the desktop's real TypeScript code, both ways, on the Mac's JVM (as apps/ios/scripts/conformance.sh
# does for the iPad's Swift core):
#
#   1. the desktop writes databases, real backups and its record of the store and Trash Can scripts (conformance-fixtures.test.ts)
#   2. the Kotlin core reads them, replays the scripts, restores the backups and writes its own   (./gradlew :core:test)
#   3. the desktop restores what the Kotlin core wrote, with its real stageBackup/applyStagedBackup
#
# Needs the web dependencies (cd apps/web && pnpm install --frozen-lockfile) and a JDK 21 (Android Studio's will do).
# Usage: apps/android/scripts/conformance.sh [directory-for-the-fixtures]   (a temporary one by default)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
dir="${1:-$(mktemp -d "${TMPDIR:-/tmp}/composition-conformance.XXXXXX")}"
mkdir -p "$dir"
export COMPOSITION_FIXTURE_DIR="$dir" COMPOSITION_CONFORMANCE_DIR="$dir"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"

[ -f "$root/apps/web/node_modules/vitest/vitest.mjs" ] || {
  echo "The web dependencies are not installed: cd apps/web && pnpm install --frozen-lockfile" >&2
  exit 1
}
vitest() { (cd "$root/apps/web" && node node_modules/vitest/vitest.mjs run scripts/conformance-fixtures.test.ts "$@"); }

echo "== fixtures in $dir"
echo "== 1/3 desktop writes databases, backups and its record of the scripts"
vitest -t "writes "
echo "== 2/3 the Kotlin core replays them, restores the backups and writes its own"
(cd "$root/apps/android" && ./gradlew :core:test --console=plain)
echo "== 3/3 desktop restores what the Kotlin core wrote"
# The desktop's test was written for the iPad core, so it reads swift-backup*.tar.gz; the Kotlin suite writes under those names.
vitest -t "reads what the Swift core wrote"
echo "== conformance passed"
