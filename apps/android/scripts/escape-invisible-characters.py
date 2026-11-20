#!/usr/bin/env python3
"""Keeps invisible characters out of the Kotlin sources.

A line separator, a no-break space, a zero-width joiner or a combining accent typed into a source file works, but nobody reading
the file can see it. The Kotlin core is full of them on purpose (it has to treat text as JavaScript does), so they are always
written as escapes, which mean the same in an ordinary string, a character literal and a regular expression.

    apps/android/scripts/escape-invisible-characters.py          rewrites every such character in apps/android as an escape
    apps/android/scripts/escape-invisible-characters.py --check  lists them and fails instead (CI runs this)

An escape in a raw string (triple quotes) is not decoded by Kotlin, so a raw string that is not a regular expression must not hold one;
the check cannot tell those apart, so it is left to review.
"""
import os
import sys
import unicodedata


def invisible(c: str) -> bool:
    """Characters a reader cannot see, or cannot see for what they are: spaces other than U+0020, line and paragraph separators,
    format characters (zero-width joiners, soft hyphens, direction marks, the byte-order mark), control characters other than tab,
    line feed and carriage return, and combining marks, which attach themselves to the character before (a quote mark, often)."""
    if c in "\t\n\r":
        return False
    category = unicodedata.category(c)
    return (category == "Zs" and c != " ") or category in ("Zl", "Zp", "Cf", "Cc", "Mn", "Me")


root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
check = "--check" in sys.argv[1:]
found = 0
for folder, folders, files in os.walk(root):
    folders[:] = [name for name in folders if name not in ("build", ".gradle", ".kotlin")]
    for name in files:
        if not name.endswith((".kt", ".kts")):
            continue
        path = os.path.join(folder, name)
        with open(path, encoding="utf-8") as source:
            text = source.read()
        if not any(invisible(c) for c in text):
            continue
        for number, line in enumerate(text.split("\n"), 1):
            for c in line:
                if invisible(c):
                    found += 1
                    print(f"{os.path.relpath(path, root)}:{number}: U+{ord(c):04X}")
        if not check:
            with open(path, "w", encoding="utf-8") as source:
                source.write("".join(f"\\u{ord(c):04X}" if invisible(c) else c for c in text))
if check and found:
    print(f"{found} invisible characters: run apps/android/scripts/escape-invisible-characters.py", file=sys.stderr)
    sys.exit(1)
