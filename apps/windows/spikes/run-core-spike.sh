#!/usr/bin/env bash
# Spike S1 (core library) against the desktop's real TypeScript data layer, both ways, in the order that needs:
#   1. the desktop's real db.ts and backup.ts write databases and a backup            (oracle/*.oracle.ts, phase "write")
#   2. the .NET core opens and restores them, runs the same schema pass, and writes its own  (core/tests)
#   3. the desktop's real db.ts, stageBackup and applyStagedBackup read what .NET wrote  (oracle/*.oracle.ts, phase "reverse")
# Needs: apps/web dependencies (cd apps/web && pnpm install --frozen-lockfile) and the .NET SDK (9.0 here).
# Runs on macOS and Linux; it proves the core library, not any Windows behaviour. Nothing under apps/web is changed.
# Optional: COMPOSITION_MEILI_BIN=<path to a meilisearch binary> also runs the sidecar tests (S4);
#           COMPOSITION_CORPUS_DIR=<directory with the shared corpus's frontmatter-cases.json> also runs the YAML probe (S2).
# Usage: apps/windows/spikes/run-core-spike.sh [directory-for-the-oracle-files]   (a temporary one by default)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dir="${1:-$(mktemp -d "${TMPDIR:-/tmp}/composition-winspike.XXXXXX")}"
mkdir -p "$dir"
export COMPOSITION_ORACLE_DIR="$dir"

[ -f "$here/../../web/node_modules/vitest/vitest.mjs" ] || {
  echo "The web dependencies are not installed: cd apps/web && pnpm install --frozen-lockfile" >&2
  exit 1
}
oracle() { (cd "$here/../../web" && COMPOSITION_ORACLE_PHASE="$1" node node_modules/vitest/vitest.mjs run --config ../windows/spikes/oracle/vitest.config.mts); }

echo "== files in $dir"
echo "== 1/3 the desktop's real TypeScript writes databases and a backup"
oracle write
if [ -n "${COMPOSITION_CORPUS_DIR:-}" ]; then
  echo "== (S2) the desktop's real frontmatter.ts answers the shared corpus in $COMPOSITION_CORPUS_DIR"
  oracle frontmatter
fi
echo "== 2/3 the .NET core reads them, restores the backup, and writes its own"
(cd "$here/core" && dotnet test --nologo)
echo "== 3/3 the desktop's real TypeScript reads what .NET wrote"
oracle reverse
echo "== core spike passed"
