#!/usr/bin/env bash
# `harness.sh <note.md> <app_data dir>` after build.sh: writes dist/harness/ (the bundle, one note rendered through it, and the
# images), which any static server shows in a browser: `python3 -m http.server --directory dist/harness`. A Chromium or Safari view
# of the same bundle WebKitGTK loads; the native shell serves the same files at app://composition/ instead.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/dist/harness"
rm -rf "$out" && mkdir -p "$out/app_data"
cp "$here/dist/preview.js" "$here/dist/preview.css" "$out/"
cp "$2"/*.png "$out/app_data/" 2>/dev/null || true
python3 - "$1" "$out" <<'PY'
import json, re, sys
note = re.sub(r'^---\n.*?\n---\n', '', open(sys.argv[1]).read(), flags=re.S)
html = '''<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><title>Preview harness</title>
<link rel="stylesheet" href="preview.css"></head><body><div id="root"></div>
<script>
// Stands in for the native shell's app://composition/ handler: stored images come from ./app_data here.
new MutationObserver(()=>document.querySelectorAll('img[src^="app://composition/"]').forEach(i=>{i.src=i.src.replace("app://composition/","./")})).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:["src"]});
</script>
<script src="preview.js"></script>
<script>window.composition.render(%s)</script></body></html>''' % json.dumps(note)
open(sys.argv[2] + '/harness.html', 'w').write(html)
PY
echo "wrote $out/harness.html"
