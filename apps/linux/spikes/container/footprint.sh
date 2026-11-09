#!/usr/bin/env bash
# Memory of the native shell (preview off: WebKitGTK's own processes cannot start in an unprivileged container) and the size
# of what an AppImage or .deb would have to carry. Run inside the container: `footprint.sh <shell-binary> <data-dir>`.
set -uo pipefail
bin="$1"; data="$2"
for renderer in default cairo; do
  echo "== memory of the shell with the preview off (101 notes, a search index, GtkSourceView, libadwaita), after 6 s, GSK_RENDERER=$renderer"
  GSK_R=$renderer /spikes/container/xvfb-run.sh bash -c '
    [ "$GSK_R" = cairo ] && export GSK_RENDERER=cairo
    "$0" --no-preview --layout markdown --note 101 --data-dir "$1" --quit-after-ms 20000 >/tmp/app.log 2>&1 &
    pid=$!; sleep 6
    grep -E "^(Rss|Pss|Pss_Anon|Pss_File)" /proc/$pid/smaps_rollup | tr -s " " | paste -sd" "
    echo "threads: $(ls /proc/$pid/task | wc -l)"
    kill $pid 2>/dev/null
  ' "$bin" "$data"
done

echo; echo "== what the binary links (ldd closure)"
libs=$(ldd "$bin" | awk '/=>/ && $3 ~ /^\// {print $3}' | sort -u)
size_of() { for f in "$@"; do readlink -f "$f"; done | sort -u | xargs du -cb 2>/dev/null | tail -1 | cut -f1; }
mb() { awk -v b="$1" 'BEGIN{printf "%.1f MB", b/1048576}'; }
echo "libraries: $(echo "$libs" | wc -l), $(mb "$(size_of $libs)")"
web=$(echo "$libs" | grep -Ei "webkit|javascriptcore" || true)
echo "  of which WebKitGTK + JavaScriptCore: $(mb "$(size_of $web)")"
echo "  GTK4 + libadwaita + GtkSourceView: $(mb "$(size_of $(echo "$libs" | grep -Ei "libgtk-4|libadwaita|libgtksourceview"))")"
echo "binary itself: $(mb "$(stat -c %s "$bin")")"

echo; echo "== WebKitGTK's helper processes and what they add"
helpers=$(ls /usr/lib/*/webkitgtk-6.0/WebKit*Process 2>/dev/null)
echo "$helpers"
allextra=$( (for h in $helpers; do ldd "$h" | awk '/=>/ && $3 ~ /^\// {print $3}'; done) | sort -u)
echo "helper-process libraries not already linked by the shell: $(comm -13 <(echo "$libs") <(echo "$allextra") | wc -l), $(mb "$(size_of $(comm -13 <(echo "$libs") <(echo "$allextra")))")"
echo "helper binaries: $(mb "$(du -cb $helpers | tail -1 | cut -f1)")"

echo; echo "== data a bundle must carry"
for d in /usr/share/gtksourceview-5 /usr/share/icons/Adwaita /usr/share/glib-2.0/schemas /usr/lib/*/gdk-pixbuf-2.0 /usr/lib/*/gio/modules /usr/share/locale; do
  [ -e "$d" ] && printf "%-45s %s\n" "$d" "$(du -sh "$d" | cut -f1)"
done

echo; echo "== the .deb Depends this implies on Ubuntu 24.04 (packages that own the linked libraries)"
(echo "$libs"; echo "$allextra") | sort -u | while read -r f; do readlink -f "$f"; done | sort -u | xargs dpkg -S 2>/dev/null | cut -d: -f1 | sort -u | tr '\n' ' '; echo
