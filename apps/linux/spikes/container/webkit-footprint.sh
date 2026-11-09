#!/usr/bin/env bash
# Memory of the whole app with the preview on: the shell and WebKitGTK's own processes, after the showcase note has rendered and
# the app has been idle for 8 s. Run inside the container (sandbox disabled, see README): `webkit-footprint.sh <shell> <data> <preview-dir>`.
set -uo pipefail
for renderer in default cairo; do
  echo "== GSK_RENDERER=$renderer"
  GSK_R=$renderer /spikes/container/xvfb-run.sh bash -c '
    [ "$GSK_R" = cairo ] && export GSK_RENDERER=cairo
    COMPOSITION_PREVIEW_DIR="$3" "$0" --note 101 --layout split --data-dir "$1" --quit-after-ms 30000 >/tmp/app.log 2>&1 &
    sleep 14
    total_rss=0; total_pss=0
    for pid in $(pgrep -f "composition-shell-spike|WebKitWebProcess|WebKitNetworkProcess|WebKitGPUProcess" | sort -u); do
      [ -r /proc/$pid/smaps_rollup ] || continue
      name=$(tr "\0" " " < /proc/$pid/cmdline | awk "{print \$1}" | xargs basename 2>/dev/null)
      rss=$(awk "/^Rss:/ {print \$2}" /proc/$pid/smaps_rollup); pss=$(awk "/^Pss:/ {print \$2}" /proc/$pid/smaps_rollup)
      printf "  %-26s RSS %6d MB   PSS %6d MB\n" "$name" $((rss/1024)) $((pss/1024))
      total_rss=$((total_rss+rss)); total_pss=$((total_pss+pss))
    done
    printf "  %-26s RSS %6d MB   PSS %6d MB\n" "TOTAL (RSS double-counts shared pages)" $((total_rss/1024)) $((total_pss/1024))
  ' "$1" "$2" "$3"
done
