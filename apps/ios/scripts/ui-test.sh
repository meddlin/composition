#!/usr/bin/env bash
# Runs the iPad app's UI tests (apps/ios/CompositionUITests) in a booted Simulator: makes the backup they start from
# (make-organization-backup.sh), then `xcodebuild test`. Needs Xcode, python3 and the web dependencies (cd apps/web && pnpm install --frozen-lockfile).
# Usage: apps/ios/scripts/ui-test.sh [simulator-udid]   (the booted iPad by default)
#        IOS_UI_ONLY=CompositionUITests/OrganizationUITests/testBackAndForwardRetraceTheSidebar apps/ios/scripts/ui-test.sh   (one test)
#        IOS_DERIVED_DATA=<folder> apps/ios/scripts/ui-test.sh   (keeps the build between runs; a cold build takes about ten minutes)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
udid="${1:-$(xcrun simctl list devices booted | grep -m1 -i ipad | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')}"
[ -n "$udid" ] || { echo "No iPad Simulator is booted: boot one, or pass a UDID." >&2; exit 1; }
work="$(mktemp -d "${TMPDIR:-/tmp}/composition-ui-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT

"$here/make-organization-backup.sh" "$work/organization.tar.gz"
cd "$here/.."
TEST_RUNNER_COMPOSITION_UI_BACKUP="$work/organization.tar.gz" TEST_RUNNER_COMPOSITION_UI_IMAGE="$here/../conformance/preview-showcase/demo-photo-0123456789ab.png" \
  TEST_RUNNER_COMPOSITION_UI_SHOWCASE="$here/../conformance/preview-showcase/note.md" xcodebuild test \
  -project Composition.xcodeproj -scheme Composition -destination "platform=iOS Simulator,id=$udid" \
  -derivedDataPath "${IOS_DERIVED_DATA:-$work/dd}" -only-testing:"${IOS_UI_ONLY:-CompositionUITests}" \
  -test-timeouts-enabled YES -default-test-execution-time-allowance 240
