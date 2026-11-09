#!/usr/bin/env python3
"""Dumps the accessibility tree a screen reader would see for the running spike: `atspi_dump.py [app-name-substring]`.

Reads through AT-SPI over the session's accessibility bus, which is what Orca uses. It proves what the toolkit exports; it does not
prove how Orca speaks it (no screen reader runs here)."""
import sys
import time

import gi

gi.require_version("Atspi", "2.0")
from gi.repository import Atspi  # noqa: E402

wanted = sys.argv[1] if len(sys.argv) > 1 else "composition"


def find_app():
    desktop = Atspi.get_desktop(0)
    for i in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(i)
        if app and wanted in (app.get_name() or "").lower():
            return app
    return None


app = None
for _ in range(40):
    app = find_app()
    if app:
        break
    time.sleep(0.25)
if not app:
    print("no accessible application named", wanted)
    sys.exit(1)

summary = {"roles": {}}


def walk(node, depth=0, limit=14):
    role = node.get_role_name()
    summary["roles"][role] = summary["roles"].get(role, 0) + 1
    name = (node.get_name() or "").replace("\n", " ")[:50]
    ifaces = Atspi.Accessible.get_interfaces(node)
    extra = ""
    if "Text" in ifaces:
        text = node.get_text_iface()
        n = Atspi.Text.get_character_count(text)
        extra = f"  [Text: {n} chars, caret at {Atspi.Text.get_caret_offset(text)}, first 40: {Atspi.Text.get_text(text, 0, min(n, 40))!r}]"
        if role == "text":
            summary.setdefault("text_nodes", []).append((role, n))
            states = Atspi.Accessible.get_state_set(node)
            print("  " * (depth + 1) + f"states: editable={states.contains(Atspi.StateType.EDITABLE)} multi-line={states.contains(Atspi.StateType.MULTI_LINE)} focusable={states.contains(Atspi.StateType.FOCUSABLE)}")
    if "EditableText" in ifaces:
        extra += " [EditableText]"
    if depth <= limit and (depth < 3 or role in ("text", "entry", "push button", "toggle button", "frame", "list", "scroll pane") or (role == "list item" and summary["roles"][role] <= 2)):
        print("  " * depth + f"{role} {name!r}{extra}")
    for i in range(node.get_child_count()):
        try:
            walk(node.get_child_at_index(i), depth + 1, limit)
        except Exception as e:  # a vanished node
            print("  " * (depth + 1) + f"(error: {e})")


print("application:", app.get_name())
walk(app)
print("role counts:", dict(sorted(summary["roles"].items(), key=lambda kv: -kv[1])[:12]))
print("text nodes:", summary.get("text_nodes", [])[:6])
