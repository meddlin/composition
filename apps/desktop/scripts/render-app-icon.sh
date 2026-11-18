#!/bin/zsh
# Renders the Benchnote icon (apps/ios/icon/icon.svg, the iPad app's source) to build/app-icon-1024.png, the desktop app's icon
# for macOS and Linux (electron-builder.yml). Needs rsvg-convert (brew install librsvg). Run from anywhere:
#   apps/desktop/scripts/render-app-icon.sh
#
# iPadOS rounds a square icon itself; macOS doesn't, so the art goes on Apple's macOS icon grid: an 824 px tile with 185.4 px
# rounded corners, centred on a transparent 1024 px canvas (the 100 px margin is where macOS leaves room around every icon).
# Linux launchers show the same PNG as it is.
set -euo pipefail
here=${0:A:h}
source_svg=$here/../../ios/icon/icon.svg
out=$here/../build/app-icon-1024.png
command -v rsvg-convert >/dev/null || { echo "rsvg-convert is missing: brew install librsvg" >&2; exit 1; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The iPad art, scaled from 1024 to 824 (0.8046875) and clipped to the tile. The source's <svg> element is inlined whole, so its
# own <style> still applies.
{
  print '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">'
  print '<defs><clipPath id="tile"><rect x="100" y="100" width="824" height="824" rx="185.4"/></clipPath></defs>'
  print '<g clip-path="url(#tile)"><g transform="translate(100 100) scale(0.8046875)">'
  cat "$source_svg"
  print '</g></g></svg>'
} > "$work/mac.svg"

rsvg-convert -w 1024 -h 1024 "$work/mac.svg" -o "$out"
echo "wrote $out"
