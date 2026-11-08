#!/usr/bin/env bash
# The whole S1 and S2 check, end to end:
#   1. the desktop's own code (db.ts, the repos, createBackup, a real Meilisearch's committed answers) makes the reference files;
#   2. the Rust core is tested against them (cargo test);
#   3. the desktop's own code opens and restores what Rust wrote (tools/rust-fixtures.test.ts).
#
# The shared corpus and the generator are not on `main` yet: they are `apps/ios/conformance/` and
# `apps/web/scripts/ios-conformance-fixtures.test.ts` on branch claude/ipad-app-design-build-683ed8 (PR #247). Point IPAD_TREE at a
# checkout of that branch (a `git archive` unpacked in a scratch folder is enough; nothing in it is modified):
#
#   IPAD_TREE=/path/to/checkout ./run.sh [--system-sqlite]
#
# The generator's last two cases ("reads what the Swift core wrote") fail in step 1 because no Swift core ran; that is expected.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tree="${IPAD_TREE:?set IPAD_TREE to a checkout of claude/ipad-app-design-build-683ed8}"
out="${OUT:-$(mktemp -d)}"
features=()
[ "${1:-}" = "--system-sqlite" ] && features=(--no-default-features --features system-sqlite)

echo "== 1. desktop-side reference files -> $out"
(cd "$tree/apps/web" && pnpm install --frozen-lockfile >/dev/null && \
  IOS_FIXTURE_DIR="$out" IOS_FIXTURE_LARGE_MB="${IOS_FIXTURE_LARGE_MB:-20}" pnpm exec vitest run scripts/ios-conformance-fixtures.test.ts 2>&1 | tail -6)
test -f "$out/desktop-empty.db" || { echo "the generator wrote nothing"; exit 1; }

echo "== 2. Rust core against them"
(cd "$here" && COMPOSITION_CONFORMANCE_DIR="$out" cargo test --release ${features[@]+"${features[@]}"} -- --test-threads=1 --nocapture 2>&1 | grep -E "^(test |test result)|sqlite_version|built in|speed,|first search|  A  |  B  |  ALL|parser:|restored the large|rust-backup|panicked|FAILED")

echo "== 3. the desktop opens and restores what Rust wrote"
cp "$here/tools/rust-fixtures.test.ts" "$tree/apps/web/scripts/rust-fixtures.test.ts"
(cd "$tree/apps/web" && COMPOSITION_CONFORMANCE_DIR="$out" pnpm exec vitest run scripts/rust-fixtures.test.ts 2>&1 | tail -8)
rm -f "$tree/apps/web/scripts/rust-fixtures.test.ts"
