#!/usr/bin/env bash
# Runs the Kotlin core's suites on an Android emulator (or the one device adb sees), through Android's test runner, against the
# same corpus and desktop-made fixtures as the JVM run, then has the desktop restore the backups the core wrote on the device.
#
#   AVD=Pixel_10   the emulator to boot headless when no device is connected (shut down again at the end if this script booted it)
#
# Usage: apps/android/scripts/test-on-device.sh [directory with the desktop's fixtures]   (made fresh when not given)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
android="$root/apps/android"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
adb="$ANDROID_HOME/platform-tools/adb"
AVD="${AVD:-Pixel_10}"
package=com.rushinglabs.composition.devicetests.test
staging=/data/local/tmp/composition-a1
# The test app's own files folder: it cannot read what adb pushes to shared storage, so `run-as` copies the fixtures in.
remote="/data/user/0/$package/files"

fixtures="${1:-}"
if [ -z "$fixtures" ]; then
    fixtures="$(mktemp -d "${TMPDIR:-/tmp}/composition-conformance.XXXXXX")"
    echo "== the desktop writes its fixtures into $fixtures"
    (cd "$root/apps/web" && COMPOSITION_FIXTURE_DIR="$fixtures" node node_modules/vitest/vitest.mjs run scripts/conformance-fixtures.test.ts -t "writes " | tail -3)
fi

# One run at a time on this Mac: several sessions may port slices at once, and two runs would install the same test package on the same
# emulator. The lock is a folder holding the owner's process id; one whose owner is gone is taken over.
lock="$HOME/.android/composition-device-tests.lock"
mkdir -p "$HOME/.android"
until mkdir "$lock" 2>/dev/null; do
    owner="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
        rm -rf "$lock"
        continue
    fi
    echo "== another run has the emulator (process ${owner:-?}); waiting"
    sleep 20
done
echo $$ > "$lock/pid"

booted_here=0
if [ "$("$adb" devices | grep -cw device)" = 0 ]; then
    echo "== booting $AVD (headless)"
    "$ANDROID_HOME/emulator/emulator" -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot-save >/dev/null 2>&1 &
    booted_here=1
    "$adb" wait-for-device
    until [ "$("$adb" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 1; done
fi
cleanup() {
    "$adb" uninstall "$package" >/dev/null 2>&1 || true
    if [ "$booted_here" = 1 ]; then
        "$adb" emu kill >/dev/null 2>&1 || true
        # The next run must not find this emulator still shutting down and take it for a device.
        for _ in $(seq 30); do [ "$("$adb" devices | grep -cw device)" = 0 ] && break; sleep 1; done
    fi
    rm -rf "$lock"
}
trap cleanup EXIT
echo "== device: Android $("$adb" shell getprop ro.build.version.release | tr -d '\r') (API $("$adb" shell getprop ro.build.version.sdk | tr -d '\r')), $("$adb" shell getprop ro.product.cpu.abi | tr -d '\r'), page size $("$adb" shell getconf PAGE_SIZE | tr -d '\r')"

echo "== build and install the suites"
(cd "$android" && ./gradlew :core-device-tests:assembleDebugAndroidTest --console=plain -q)
"$adb" install -r -t "$android/core-device-tests/build/outputs/apk/androidTest/debug/core-device-tests-debug-androidTest.apk" >/dev/null

echo "== push the corpus and the desktop's fixtures (not what an earlier run wrote)"
"$adb" shell "rm -rf $staging && mkdir -p $staging/conformance $staging/corpus"
"$adb" push "$root/fixtures/conformance/." "$staging/corpus/" >/dev/null 2>&1
for file in "$fixtures"/*; do
    case "$(basename "$file")" in swift-*) continue ;; esac
    "$adb" push "$file" "$staging/conformance/" >/dev/null 2>&1
done
"$adb" shell "chmod -R a+rX $staging"
"$adb" shell "run-as $package sh -c 'rm -rf files && mkdir -p files && cp -r $staging/conformance $staging/corpus files/'"
"$adb" shell "rm -rf $staging"

echo "== run the suites"
"$adb" logcat -c
set +e
"$adb" shell am instrument -w -e conformanceDir "$remote/conformance" -e corpusDir "$remote/corpus" \
    "$package/androidx.test.runner.AndroidJUnitRunner" | tee "$android/build/device-tests.txt"
set -e
"$adb" logcat -d -s System.out:I | sed -n 's/.*System.out: //p' | grep -E 'SQLite|ENABLE_FTS5|Timings|Search|agree with the desktop|of [0-9]+ (steps|blocks|edits|queries|notes|inputs)|restored' || true
grep -q '^OK (' "$android/build/device-tests.txt" || { echo "== the suites failed on the device" >&2; exit 1; }

echo "== the desktop restores what the Kotlin core wrote on the device"
back="$(mktemp -d "${TMPDIR:-/tmp}/composition-device-backups.XXXXXX")"
for file in "$fixtures"/*; do case "$(basename "$file")" in swift-*) ;; *) ln -s "$file" "$back/" ;; esac; done
for name in swift-backup swift-backup-large; do
    "$adb" exec-out run-as "$package" cat "files/conformance/$name.tar.gz" > "$back/$name.tar.gz"
    "$adb" exec-out run-as "$package" cat "files/conformance/$name.expected.json" > "$back/$name.expected.json"
done
(cd "$root/apps/web" && COMPOSITION_FIXTURE_DIR="$back" node node_modules/vitest/vitest.mjs run scripts/conformance-fixtures.test.ts -t "reads what the Swift core wrote" | tail -4)
rm -rf "$back"
echo "== device conformance passed"
