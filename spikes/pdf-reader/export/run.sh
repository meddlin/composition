#!/bin/sh
# Spike D: write the marks into a fixture with one adapter, render the result with PDFKit, and check it in both viewers.
# usage (from spikes/pdf-reader): export/run.sh <pdf-lib|@cantoo/pdf-lib|@pdfme/pdf-lib|pdfjs> geometry.pdf outdir [native|flatten] [noap]
# MARK_PAGES=0,5 marks and checks only those pages (0-based); the default is every page. DIFF=1: see check.mjs.
# needs the PDFKit renderer built once:  swiftc -O export/pdfkit-render.swift -o /tmp/pdfkit-render   (set PDFKIT_RENDER to its path)
set -e
adapter=$1; fixture=$2; outdir=$3; mode=${4:-native}; flag=$5
render=${PDFKIT_RENDER:-/tmp/pdfkit-render}
name=$(echo "$adapter" | tr '/@' '__')-$mode${flag:+-$flag}
mkdir -p "$outdir"
node export/write.mjs "$adapter" "$fixture" "$outdir/$name.pdf" "$mode" $flag
# DIFF=1 compares against the unmarked file instead of looking for the marks' colours (for a real PDF with colour on its pages)
if [ -n "$DIFF" ]; then
  [ -d "$outdir/r-orig" ] || "$render" "$fixture" "$outdir/r-orig" "$MARK_PAGES" > /dev/null
  export ORIGINAL="$fixture" ORIGINAL_DIR="$outdir/r-orig"
fi
"$render" "$outdir/$name.pdf" "$outdir/r-$name" "$MARK_PAGES" > "$outdir/$name.kit.json"
node export/check.mjs "$outdir/$name.pdf" "$outdir/$name.kit.json" "$outdir/r-$name" $( [ "$mode" = flatten ] && echo flatten )
