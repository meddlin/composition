#!/bin/sh
# Reads the synthetic drawings, and any drawing PNGs you name, with Vision and with PencilKit's reader, from a foreground Mac app (handwritingd will not read for a
# command-line tool or a test host), and prints the table it writes.
#   ./run.sh [out-folder] [drawing.png ...]
# A drawing PNG is one the iPad app stored (app_data/…-drawing-….png): it carries its strokes. Needs macOS 27 and Xcode 27. Nothing leaves the Mac.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-"$here/.build/comparison"}
[ $# -gt 0 ] && shift
swift build --package-path "$here" -c debug
app="$here/.build/InkReaders.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$here/.build/debug/InkReaders" "$app/Contents/MacOS/InkReaders"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.rushinglabs.spike.ink-readers</string>
<key>CFBundleName</key><string>InkReaders</string>
<key>CFBundleExecutable</key><string>InkReaders</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>27.0</string>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
codesign -s - --force "$app" >/dev/null 2>&1
mkdir -p "$out"
out=$(cd "$out" && pwd)
pngs=""
for png in "$@"; do pngs="$pngs $(cd "$(dirname "$png")" && pwd)/$(basename "$png")"; done
# shellcheck disable=SC2086
open -W -n "$app" --args "$out" $pngs
cat "$out/comparison.md"
