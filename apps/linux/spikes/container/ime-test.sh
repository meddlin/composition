#!/usr/bin/env bash
# Types Korean (IBus + ibus-hangul, X11) into the editor and reads what arrived back over AT-SPI. Run inside the container via
# xvfb-run.sh. Proves GtkSourceView takes IBus pre-edit and commit; says nothing about Wayland's text-input protocol, Fcitx
# or Anthy/Pinyin engines. `ime-test.sh <shell-binary> <data-dir>`
set -uo pipefail
export GTK_IM_MODULE=ibus XMODIFIERS=@im=ibus QT_IM_MODULE=ibus
ibus-daemon -drx >/tmp/ibus.log 2>&1 &
sleep 2.5
ibus engine hangul 2>&1 | head -2
"$1" --no-preview --layout markdown --note 101 --data-dir "$2" --quit-after-ms 25000 >/tmp/app.log 2>&1 &
sleep 3
win=$(xdotool search --sync --onlyvisible --name "Composition" | head -1)
xdotool windowfocus --sync "$win" 2>&1 | head -1
# a click inside the editor (right of the sidebar), then the end of the text; ibus-hangul starts in Latin mode, Shift+Space toggles
xdotool mousemove 800 400 click 1
sleep 0.4
xdotool key ctrl+End
sleep 0.3
xdotool key shift+space
sleep 0.5
python3 - <<'PY'
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi
def editor():
    d = Atspi.get_desktop(0)
    for i in range(d.get_child_count()):
        app = d.get_child_at_index(i)
        if "composition-shell" in (app.get_name() or ""):
            stack = [app]
            while stack:
                n = stack.pop()
                if n.get_role_name() == "text":
                    return n.get_text_iface()
                stack.extend(n.get_child_at_index(i) for i in range(n.get_child_count()))
t = editor()
print("before:", repr(Atspi.Text.get_text(t, Atspi.Text.get_character_count(t) - 12, Atspi.Text.get_character_count(t))))
PY
xdotool type --delay 80 "gksrmf"
sleep 0.4
xdotool key space
sleep 0.8
python3 - <<'PY'
import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi
d = Atspi.get_desktop(0)
for i in range(d.get_child_count()):
    app = d.get_child_at_index(i)
    if "composition-shell" in (app.get_name() or ""):
        stack = [app]
        while stack:
            n = stack.pop()
            if n.get_role_name() == "text":
                t = n.get_text_iface()
                c = Atspi.Text.get_character_count(t)
                print("after: ", repr(Atspi.Text.get_text(t, c - 12, c)), "| caret", Atspi.Text.get_caret_offset(t), "of", c)
                raise SystemExit
            stack.extend(n.get_child_at_index(i) for i in range(n.get_child_count()))
PY
echo "ibus engine now: $(ibus engine 2>&1)"
