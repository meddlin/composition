#!/usr/bin/env bash
# The Windows app's .NET core (apps/windows/Composition.Core) against the desktop's real TypeScript data layer, both ways,
# in the order that needs (docs/windows-native-app-design.md, "Keeping implementations honest"):
#   1. the desktop's real db.ts and backup.ts write databases and a backup                   (oracle/*.oracle.ts, phase "write")
#   2. the .NET core opens and restores them, runs the same schema pass, and writes its own    (Composition.Core.Tests)
#   3. the desktop's real db.ts, stageBackup and applyStagedBackup read what .NET wrote        (oracle/*.oracle.ts, phase "reverse")
# Needs: apps/web's dependencies (`pnpm install --frozen-lockfile` in apps/web; on Windows `npx pnpm@12.8.1 install --frozen-lockfile`)
# and the .NET SDK pinned in apps/windows/global.json. Runs on macOS, Linux and Windows (Git Bash). Nothing under apps/web is changed.
# Optional: COMPOSITION_MEILI_BIN=<path to a meilisearch binary> also runs the search sidecar tests.
# Usage: apps/windows/scripts/conformance.sh [directory-for-the-oracle-files]   (a temporary one by default)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
windows="$here/.."
web="$windows/../web"
dir="${1:-$(mktemp -d "${TMPDIR:-/tmp}/composition-windows-oracle.XXXXXX")}"
mkdir -p "$dir"
# Node and .NET on Windows want a Windows path, not Git Bash's /c/...
if command -v cygpath >/dev/null 2>&1; then dir="$(cygpath -w "$dir")"; fi
export COMPOSITION_ORACLE_DIR="$dir"

[ -f "$web/node_modules/vitest/vitest.mjs" ] || {
  echo "The web dependencies are not installed: cd apps/web && pnpm install --frozen-lockfile" >&2
  exit 1
}
oracle() { (cd "$web" && COMPOSITION_ORACLE_PHASE="$1" node node_modules/vitest/vitest.mjs run --config ../windows/oracle/vitest.config.mts); }

echo "== files in $dir"
echo "== 1/3 the desktop's real TypeScript writes databases and a backup"
oracle write
echo "== 2/3 the .NET core reads them, restores the backup, and writes its own"
(cd "$windows" && dotnet test Composition.slnx --nologo)
echo "== 3/3 the desktop's real TypeScript reads what .NET wrote"
oracle reverse
echo "== conformance passed"
