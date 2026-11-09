#!/usr/bin/env python3
"""Drives the S8 Live-tab prototype with real key events (xdotool) and an input method (IBus), and reports what happened.
Run inside the container under xvfb-run.sh: `xvfb-run.sh python3 live_drive.py [scenario ...]`; no argument runs them all."""
import json
import os
import queue
import subprocess
import sys
import threading
import time

BIN = os.environ.get("LIVE_BIN", "/target/release/composition-live-spike")
DATA = os.environ.get("LIVE_DATA", "/data")
SHOTS = os.environ.get("LIVE_SHOTS", "/shots")


def sh(*cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


class App:
    def __init__(self, *args, env=None):
        self.p = subprocess.Popen([BIN, "--data-dir", DATA, *args], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=(None if os.environ.get('LIVE_STDERR') else subprocess.DEVNULL), text=True, bufsize=1, env={**os.environ, **(env or {})})
        # A thread moves the app's lines into a queue: waiting on the pipe itself misses lines a buffered reader already holds.
        self.lines = queue.Queue()
        threading.Thread(target=lambda: [self.lines.put(l) for l in self.p.stdout], daemon=True).start()
        self.ready = self.read("READY", 60)
        self.win = sh("xdotool", "search", "--sync", "--onlyvisible", "--name", "Live spike").stdout.split()[0]
        sh("xdotool", "windowfocus", "--sync", self.win)
        sh("xdotool", "mousemove", "400", "300", "click", "1")
        time.sleep(0.3)

    def read(self, prefix, timeout=20):
        end = time.time() + timeout
        while time.time() < end:
            try:
                line = self.lines.get(timeout=0.2)
            except queue.Empty:
                continue
            if line.startswith(prefix):
                return line.strip()
        raise TimeoutError(f"no {prefix} line")

    def cmd(self, text, until):
        self.p.stdin.write(text + "\n")
        self.p.stdin.flush()
        return self.read(until)

    def state(self):
        return json.loads(self.cmd("dump", "STATE")[6:])

    def goto(self, line, col):
        self.cmd(f"goto {line} {col}", "OK goto")
        time.sleep(0.15)

    def key(self, *keys, repeat=1, delay=40, settle=0.12):
        for _ in range(repeat):
            sh("xdotool", "key", "--delay", str(delay), *keys)
        time.sleep(settle)

    def type(self, text, delay=60, settle=0.4):
        sh("xdotool", "type", "--delay", str(delay), text)
        time.sleep(settle)

    def text(self, a, b):
        return json.loads(self.cmd(f"text {a} {b}", "TEXT ")[5:])

    def clip(self):
        r = self.cmd("clip", "CLIP ")[5:]
        return json.loads(r) if r.startswith('"') else r

    def shot(self, name):
        self.cmd(f"snapshot {SHOTS}/{name}.png", "OK snapshot")

    def rss_mb(self):
        for l in open(f"/proc/{self.p.pid}/status"):
            if l.startswith("VmRSS:"):
                return int(l.split()[1]) / 1024

    def close(self):
        try:
            self.p.stdin.write("quit\n")
            self.p.stdin.flush()
        except Exception:
            pass
        self.p.kill()


def show(title):
    print(f"\n== {title}")


def arrows():
    show("A. Arrow keys across hidden marks (line 7: 'Plain text, then **bold words**, ...', marks at columns 17-18 and 29-30)")
    a = App()
    a.goto(7, 14)
    s = a.state()
    print(f"start col {s['col']}, revealed {s['revealed']}, hidden mark chars {s['hidden_mark_chars']}")
    cols = [s["col"]]
    for i in range(8):
        a.key("Right")
        s = a.state()
        cols.append(s["col"])
        print(f"  Right #{i+1}: col {s['col']:>2}  constructs showing marks: {s['revealed']}  visible: {s['visible_line'][:48]!r}")
    steps = [b - a_ for a_, b in zip(cols, cols[1:])]
    print(f"columns visited going right: {cols}; step sizes {steps}")
    a.goto(7, 33)
    cols = [a.state()["col"]]
    for i in range(8):
        a.key("Left")
        cols.append(a.state()["col"])
    print(f"columns visited going left from 33: {cols}")
    a.goto(7, 10)
    a.key("Down", repeat=2)
    s = a.state()
    print(f"Down twice from line 7 col 10 -> line {s['line']} col {s['col']}")
    a.key("Up")
    s = a.state()
    print(f"Up once -> line {s['line']} col {s['col']}")
    a.close()


def selection():
    show("B. Selection and copy across hidden marks")
    a = App()
    a.goto(7, 14)
    a.key("shift+Right", repeat=6)
    s = a.state()
    lo, hi = s["sel"]
    print(f"Shift+Right x6 from col 14: selection {s['sel']} (caret col {s['col']})")
    a.key("ctrl+c")
    clip = a.clip()
    expected = a.text(lo, hi)
    print(f"copied {clip!r}; the buffer holds {expected!r} there; equal: {clip == expected}")
    a.goto(7, 3)
    a.key("shift+Down", repeat=4)
    s = a.state()
    lo, hi = s["sel"]
    a.key("ctrl+c")
    clip = a.clip()
    expected = a.text(lo, hi)
    print(f"Shift+Down x4 from line 7: selection {s['sel']}; {len(expected)} chars in the buffer, {len(clip) if isinstance(clip, str) else clip} copied; equal: {clip == expected}; revealed {s['revealed']} constructs")
    print(f"  hidden marks inside the copied text: {'**' in clip}, the picture's Markdown: {'![' in clip}")
    a.key("ctrl+a")
    s = a.state()
    print(f"Select all: selection {s['sel']} of {s['chars']} chars; constructs showing marks: {s['revealed']} of {s['constructs']}")
    a.close()


def edits():
    show("C. Deleting hidden marks, undo")
    a = App()
    a.goto(7, 17)
    before = a.state()["line_text"]
    a.key("Delete", repeat=2)
    after = a.state()
    print(f"Delete x2 at the opening '**': {after['line_text'][:60]!r}; constructs {after['constructs']}")
    a.key("ctrl+z", repeat=2)
    undone = a.state()["line_text"]
    print(f"Ctrl+Z x2: text restored exactly: {undone == before}")
    a.goto(7, 14)
    a.key("Right", repeat=4)
    a.key("BackSpace")
    s = a.state()
    print(f"Backspace after walking Right x4 from col 14: caret col {s['col']}, line {s['line_text'][:40]!r}")
    a.key("ctrl+z")
    a.goto(17, 0)
    a.key("End")
    a.type("x" * 3, delay=30)
    s = a.state()
    print(f"typing at the end of a line that ends with a bold construct: {s['line_text'][-30:]!r}; constructs {s['constructs']}")
    a.close()


def ime():
    show("D. Input method (IBus + ibus-hangul, X11) in and around constructs")
    daemon = subprocess.Popen(["ibus-daemon", "-drx"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    sh("ibus", "engine", "hangul")
    a = App(env={"GTK_IM_MODULE": "ibus", "XMODIFIERS": "@im=ibus"})
    a.key("shift+space")
    a.goto(7, 22)
    s0 = a.state()
    a.type("gksrmf", delay=90)
    a.key("space")
    s = a.state()
    print(f"inside **bold words** at col 22: line now {s['line_text'][:56]!r}; constructs {s0['constructs']} -> {s['constructs']}; showing marks {s['revealed']}")
    print(f"  Hangul composed: {'한글' in s['line_text']}")
    a.goto(5, 25)
    a.type("gksrmf", delay=90)
    a.key("space")
    s = a.state()
    print(f"at the end of the heading: {s['line_text']!r}; composed: {'한글' in s['line_text']}")
    a.goto(11, 10)
    a.key("Down", repeat=2)
    a.type("gksrmf", delay=90)
    s = a.state()
    print(f"after Down x2 into the picture's line: caret line {s['line']}, line text {s['line_text'][:60]!r}")
    a.shot("live-ime")
    a.close()
    daemon.terminate()


def visuals():
    show("E. Screenshots: marks away from the caret, in a construct, on the picture")
    for scheme in ("dark", "light"):
        a = App("--scheme", scheme)
        a.goto(11, 3)
        time.sleep(0.8)
        a.shot(f"live-{scheme}-away")
        if scheme == "dark":
            a.goto(7, 22)
            time.sleep(0.5)
            a.shot("live-dark-in-bold")
            a.goto(13, 5)
            time.sleep(0.6)
            a.shot("live-dark-on-picture")
            a.goto(5, 4)
            time.sleep(0.5)
            a.shot("live-dark-on-heading")
        a.close()
    print(f"wrote screenshots to {SHOTS}")


def big():
    show("F. A 5,000-line note: cost of the Live logic")
    results = {}
    for label, extra in (("live", []), ("live, no overlays", ["--no-overlays"]), ("no live logic", ["--no-live"])):
        a = App("--generate", "5000", *extra)
        live = "--no-live" not in extra
        print(f"-- {label}: {a.ready}")
        time.sleep(1.5)
        rss_idle = a.rss_mb()
        a.goto(2500, 0)
        time.sleep(0.8)
        base = a.state()["chars"]
        a.cmd(f"expect_len {base + 200}", "OK expect_len")
        t0 = time.time()
        sh("xdotool", "type", "--delay", "0", "a" * 200)
        wall = (time.time() - t0) * 1000
        try:
            reached = float(a.read("LEN_REACHED", 30).split()[1])
        except TimeoutError:
            reached = None
        print(f"   typed 200 characters in the middle of the note: the buffer had them after {reached} ms (xdotool itself {wall:.0f} ms)")
        a.goto(2500, 0)
        t0 = time.time()
        sh("xdotool", "key", "--delay", "0", *(["Down"] * 60))
        down = (time.time() - t0) * 1000
        time.sleep(0.4)
        print(f"   60 Down presses: {down:.0f} ms ({down/60:.1f} ms each); caret now line {a.state()['line']}")
        if live:
            print("   " + a.cmd("bench scan", "BENCH"))
            print("   " + a.cmd("bench caret 400", "BENCH"))
            print("   " + a.cmd("bench caretfull 5", "BENCH") + "   <- retagging everything on each move, for contrast")
            a.goto(2500, 0)
            time.sleep(1.0)
            print("   " + a.cmd("bench reposition", "BENCH") + "   <- a frame with nothing moved")
            if not extra:
                a.shot("live-5000-lines")
            # Enter in the middle: the number of lines changes, so everything is read again
            a.goto(2500, 0)
            a.cmd("expect_len %d" % (a.state()["chars"] + 20), "OK expect_len")
            t0 = time.time()
            sh("xdotool", "key", "--delay", "0", *(["Return"] * 20))
            a.read("LEN_REACHED", 30)
            print(f"   20 Enter presses (each changes the line count): {(time.time()-t0)*1000:.0f} ms ({(time.time()-t0)*1000/20:.0f} ms each)")
        print(f"   resident memory: {rss_idle:.0f} MB after start, {a.rss_mb():.0f} MB after the above")
        results[label] = (reached, down, a.rss_mb())
        if live and not extra:
            try:
                import gi
                gi.require_version("Atspi", "2.0")
                from gi.repository import Atspi
                d = Atspi.get_desktop(0)
                for i in range(d.get_child_count()):
                    app = d.get_child_at_index(i)
                    if "live" in (app.get_name() or "").lower():
                        stack = [app]
                        while stack:
                            n = stack.pop()
                            if n.get_role_name() == "text":
                                t = n.get_text_iface()
                                c = Atspi.Text.get_character_count(t)
                                t0 = time.time()
                                txt = Atspi.Text.get_text(t, 0, c)
                                print(f"   AT-SPI sees {c} characters (the buffer has {a.state()['chars']}); reading them took {(time.time()-t0)*1000:.0f} ms; '**' in what a screen reader gets: {'**' in txt}")
                                stack = []
                                break
                            stack.extend(n.get_child_at_index(k) for k in range(n.get_child_count()))
            except Exception as e:
                print(f"   AT-SPI read failed: {e}")
        a.close()
    live, base = results["live"], results["no live logic"]
    if live[0] and base[0]:
        print(f"-- typing 200 characters: {live[0]:.0f} ms with the Live logic vs {base[0]:.0f} ms without")


def bigshot():
    show("G. The 5,000-line note, looked at without benchmarking it first")
    a = App("--generate", "5000")
    for name, line in (("top", 0), ("middle", 2500), ("far", 4900)):
        a.goto(line, 0)
        time.sleep(2.0)
        a.shot(f"live-5000-{name}")
        print(f"   {name}: caret line {a.state()['line']}, {a.cmd('bench reposition', 'BENCH')}")
    a.goto(2425, 0)  # the picture of block 300
    time.sleep(2.0)
    a.shot("live-5000-picture")
    a.goto(2500, 0)
    time.sleep(2.0)
    a.p.stdin.write("overlayinfo\n")
    a.p.stdin.flush()
    for _ in range(6):  # one line of view numbers, one count, four overlays (a text-mode pipe reader has them all buffered, so ask for each)
        print("   " + a.read("INFO", 5))
    a.key("ctrl+End")
    time.sleep(1.5)
    a.shot("live-5000-after-ctrl-end")
    a.key("ctrl+Home")
    time.sleep(1.5)
    a.shot("live-5000-after-ctrl-home")
    print("   caret at the end and the start of the note; screenshots written")
    a.close()


def s11():
    show("S11. Pictures and rules in a 5,000-line note, three ways")
    configs = (
        ("overlay", ["--rules", "overlay"], "pictures and rules as overlay widgets (S8)"),
        ("tag-layer", ["--rules", "tag", "--pictures", "layer"], "rules by a text tag, pictures by the draw-time layer"),
        ("layer", ["--rules", "layer", "--pictures", "layer"], "rules and pictures by the draw-time layer"),
    )
    for name, flags, what in configs:
        a = App("--generate", "5000", *flags)
        print(f"-- {name}: {what}\n   {a.ready}")
        time.sleep(1.5)
        rss0 = a.rss_mb()
        for label, line in (("top", 0), ("picture", 2425), ("middle", 2500), ("far", 4900)):
            a.goto(line, 0)
            time.sleep(1.8)
            a.shot(f"s11-{name}-{label}")
        a.goto(2425, 0)
        time.sleep(1.0)
        a.key("Next", repeat=3)  # Page Down three times, then back
        a.key("Prior", repeat=3)
        time.sleep(1.0)
        a.shot(f"s11-{name}-after-paging")
        sh("xdotool", "windowsize", a.win, "560", "700")
        time.sleep(1.5)
        a.goto(2425, 0)
        time.sleep(1.5)
        a.shot(f"s11-{name}-narrow")
        sh("xdotool", "windowsize", a.win, "900", "700")
        time.sleep(1.0)
        if flags:
            try:
                print("   " + a.cmd("bench layer", "BENCH"))
            except TimeoutError:
                pass
        a.goto(2500, 0)
        rss1 = a.rss_mb()
        time.sleep(10)
        rss2 = a.rss_mb()
        t0 = time.time()
        a.cmd("expect_len %d" % (a.state()["chars"] + 20), "OK expect_len")
        sh("xdotool", "key", "--delay", "0", *(["Return"] * 20))
        a.read("LEN_REACHED", 30)
        enter_ms = (time.time() - t0) * 1000
        time.sleep(1.0)
        print(f"   memory: {rss0:.0f} MB after start, {rss1:.0f} MB after the screenshots, {rss2:.0f} MB after 10 s idle, {a.rss_mb():.0f} MB after 20 Enter presses ({enter_ms/20:.0f} ms each)")
        a.close()
    print(f"   screenshots in {SHOTS}")


SCENARIOS = {"s11": s11, "bigshot": bigshot, "arrows": arrows, "selection": selection, "edits": edits, "ime": ime, "visuals": visuals, "big": big}

if __name__ == "__main__":
    os.makedirs(SHOTS, exist_ok=True)
    for name in sys.argv[1:] or list(SCENARIOS):
        SCENARIOS[name]()
