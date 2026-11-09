#!/usr/bin/env bash
# Checks the iPad app's Swift core against the desktop's real TypeScript code, both ways, in the order that needs:
#
#   1. the desktop writes databases, real backups, the result of running apps/ios/conformance/trash-script.json
#      through its real trashRepo and store-script.json through its real service, the notes and parser answers for the
#      search queries, and what its settings, frontmatter, navigation-history, drop-edge and group-listing code make of the committed cases   (apps/web/scripts/ios-conformance-fixtures.test.ts)
#   2. Swift reads them, restores the backups, runs the same two scripts and compares every step, reads the same settings
#      and frontmatter cases, and writes backups of its own (after about a hundred store operations), and compares its
#      search with the committed Meilisearch answers   (apps/ios/CompositionCore tests)
#      (those answers are regenerated, with a real Meilisearch, by regenerate-search-expected.sh; this script needs none)
#   3. the desktop restores the Swift backups with its real stageBackup/applyStagedBackup and opens them with db.ts
#
# The PDF corpus (fixtures/conformance/pdf) is committed, not generated: step 1 also checks that the desktop still writes it
# (pdfConformance.test.ts, pdfMarkup.test.ts), and step 2 replays it (PdfConformanceTests).
#
# Needs the web dependencies (cd apps/web && pnpm install --frozen-lockfile) and Xcode's Swift.
# Usage: apps/ios/scripts/conformance.sh [directory-for-the-fixtures]   (a temporary one by default)
#        IOS_FIXTURE_LARGE_MB=20 apps/ios/scripts/conformance.sh        (a smaller large backup, for a quicker run)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
dir="${1:-$(mktemp -d "${TMPDIR:-/tmp}/composition-conformance.XXXXXX")}"
mkdir -p "$dir"
export IOS_FIXTURE_DIR="$dir" COMPOSITION_CONFORMANCE_DIR="$dir"

[ -f "$root/apps/web/node_modules/vitest/vitest.mjs" ] || {
  echo "The web dependencies are not installed: cd apps/web && pnpm install --frozen-lockfile" >&2
  exit 1
}
vitest() { (cd "$root/apps/web" && node node_modules/vitest/vitest.mjs run scripts/ios-conformance-fixtures.test.ts "$@"); }
pdf_corpus() { (cd "$root/apps/web" && node node_modules/vitest/vitest.mjs run src/lib/composition/pdfConformance.test.ts src/lib/composition/pdfMarkup.test.ts); }

echo "== fixtures in $dir"
echo "== 1/3 desktop writes databases, backups, the Trash Can script and the search notes"
vitest -t "writes "
echo "== 1/3 desktop still makes the committed PDF corpus (fixtures/conformance/pdf)"
pdf_corpus
echo "== 2/3 Swift restores them, runs the Trash Can script, searches, replays the PDF corpus, and writes its own backups"
(cd "$root/apps/ios/CompositionCore" && swift test)
echo "== 3/3 desktop restores what Swift wrote"
vitest -t "reads what the Swift core wrote"
echo "== conformance passed"
