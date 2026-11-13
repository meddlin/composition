#!/bin/zsh
# Renders icon.svg to the three PNGs of the iPad app's AppIcon asset (Any, Dark, Tinted), 1024 x 1024 each, into Composition/Assets.xcassets/AppIcon.appiconset.
# Needs rsvg-convert (brew install librsvg) and swiftc (Xcode). Run from anywhere:  apps/ios/icon/build.sh
set -euo pipefail
here=${0:A:h}
out=$here/../Composition/Assets.xcassets/AppIcon.appiconset
command -v rsvg-convert >/dev/null || { echo "rsvg-convert is missing: brew install librsvg" >&2; exit 1; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
swiftc -O -o "$work/finish-icon" "$here/finish-icon.swift"

render() { rsvg-convert -w 1024 -h 1024 "${@:2}" "$here/icon.svg" -o "$work/$1.png"; }
render any
render dark --stylesheet "$here/dark.css"
render tinted --stylesheet "$here/tinted.css"

"$work/finish-icon" opaque "$work/any.png" "$out/AppIcon.png"
"$work/finish-icon" transparent "$work/dark.png" "$out/AppIcon-Dark.png"
"$work/finish-icon" gray "$work/tinted.png" "$out/AppIcon-Tinted.png"
