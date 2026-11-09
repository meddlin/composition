# S11: pictures and rules in a long Live-tab note

Run 2026-11-09, in the Ubuntu 24.04 arm64 container (Xvfb, software GL, `xdotool`; see [`../container/`](../container/)), GTK 4.14.5 and
GtkSourceView 5.12.0. Code: `src/main.rs` in this folder (`--rules overlay|tag|layer`, `--pictures overlay|layer`, `bench layer`; the `layer` module
and `draw_layer`), the scenario in `../container/live_drive.py s11`. Screenshots in `screenshots/s11-*.png`.

**What a container can and cannot show is in [`../README.md`](../README.md#what-a-container-can-and-cannot-show). Nothing here ran on a GPU, on
GNOME Shell or on Wayland. Every "works" means "in that container".**

**Question.** [S8](RESULT.md) drew a picture or a rule for a Live-tab note as a `GtkTextView::add_overlay` widget. In the middle of a 5,000-line
note they were drawn 70 to 90 px from their lines or not at all, and 643 of them cost about 90 MB and grew memory from 288 to 662 MB over 20
`Enter` presses. The Live tab is in v1 ([D24](../../../../docs/linux-native-app-design.md#decisions)). What draws them correctly, in a long note, through
scrolling, paging, a resize and a re-read, at a cost that does not grow?

**Answer: a draw-time layer does.** A small `gtk::Widget` over the text view draws pictures and rules from where the layout puts their lines at
that moment, and remembers nothing between frames. In the 5,000-line note it drew both in the right place in every screenshot (top, middle,
far end, after paging, at a narrow width), took **0.07 ms of closure time per frame** (3 ms for the overlays), and held memory flat at about
**210 MB** (the overlays: 308 MB, then 567 MB after 20 `Enter`s). **Recommendation: build step 5 uses the layer, for both.** Pooled
overlays were not built; the question they were for is answered. A rule drawn by a text tag was tried and is not good enough.

## The three ways

| | Overlay (S8) | Tag rule + layer pictures | **Layer, rules and pictures** |
|---|---|---|---|
| How a rule is drawn | a `GtkSeparator` overlay per rule | the rule's line gets `paragraph-background-rgba` and a small font | a 1.5 px line, appended to the layer's `GtkSnapshot` |
| How a picture is drawn | a `GtkPicture` overlay per picture | the layer's `append_scaled_texture` | the layer's `append_scaled_texture` |
| Widgets for 643 constructs | 643 | 0 | **0** |
| Right place in the middle of the note | **no** (`s11-overlay-middle.png`: rules sit on the heading below, the picture missing in `s11-overlay-after-paging.png`) | rules and pictures yes; the rule is a **thick grey bar** (`s11-tag-layer-middle.png`) | **yes** (`s11-layer-middle.png`, `s11-layer-picture.png`) |
| At a 560 px window, picture line at section 300 | picture drawn over section 301's text, a line off (`s11-overlay-narrow.png`) | right | **right** (`s11-layer-narrow.png`) |
| Full read of the 5,006 lines | 105 to 146 ms | 36 to 40 ms | **37 to 60 ms** |
| Resident memory: start, idle after the screenshots, after 20 `Enter`s | 296 to 312, 308 to 320, **567 to 569 MB** | 200, 215 to 216, 215 to 216 MB | **192 to 196, 209 to 212, 209 to 212 MB** |
| One `Enter` (a whole-note re-read) | 89 to 109 ms | 39 to 78 ms | **42 to 61 ms** |
| Layer closure per frame (600 frames, ms) | n/a (3 ms in S8 to keep the overlays placed) | avg 0.068, max 0.7 to 2.5 | **avg 0.069 to 0.081, max 1.3 to 3.6** |
| GTK complaints in the log | `GtkPicture` and `GtkSeparator` "is not a child of GtkSourceView", hundreds (480 for `GtkPicture` alone in the second run) | none | **none** |

The ranges are the two full runs of the scenario after the layer was rewritten (the second, with a defensive guard added, is the one the
screenshots come from). Numbers moved by tens of per cent between runs under software GL, so read them as magnitudes. "Closure per frame" is the
time inside `draw_layer`, not the frame's raster time.

## How the layer works

`DrawLayer` is a `gtk::Widget` subclass whose `snapshot` calls a closure. It sits in a `gtk::Overlay` above the `GtkSourceView`, takes no input
(`set_can_target(false)`) and is clipped to the view. The text view draws its text; the layer draws the pictures and rules on top, into room the
text view already reserved:

- A picture's line has `pixels-below-lines` set to the picture's height (as in S8); the layer draws the texture at the bottom of that line's box.
- A rule is a `---` line whose marks are hidden; the layer draws a thin grey line across the middle of its box. While the caret
  touches the rule the marks show, and the layer skips it (coded; **no screenshot of a revealed rule was taken**).
- Per frame it lists nothing it saved from the last one. It keeps one thing, `special`: the numbers of the lines that hold a picture or a rule,
  rebuilt by the scan. It finds the first visible one by bisection (`partition_point` on `line_yrange`) and walks down until a line starts below
  the viewport, so the cost is a few lookups, not the 643 constructs. `GtkTextView::line_yrange` (the line's top and height, wrapped lines and
  the spacing below included) is the **only** thing it asks of the layout.
- Textures are decoded on first draw and cached by path (one 300 px PNG here, used by all 24 pictures).
- The layer queues a redraw on every frame tick, which is simple and cheap (0.07 ms). It could be narrowed to scroll, resize, edit and reveal
  changes; that was not tried.

## What went wrong on the way

- **An earlier version of the layer crashed the app** with `Gtk-ERROR: Byte index 111 is off the end of the line` (GTK's own abort, in the
  text btree) during the screenshots, after an `Enter` press. It built a text iterator from the columns the scan had remembered for each
  construct, and asked the layout for each one's rectangle: 70 to 109 ms per frame and 1.7 to 2.2 GB after the `Enter`s. Skipping every construct
  but pictures and rules fixed the cost, not the crash. **I did not pin which call aborted**; a stale column after an edit is my suspicion, not a
  finding. The rewrite remembers only line numbers, asks the layout only for a line's top and height, and has a guard (it draws nothing if the
  scan's line count differs from the buffer's; the scan runs inside the buffer's `changed` signal, so that should never happen). Both full runs
  after the rewrite finished with no error or critical in the log. That is two runs, not proof.
- **Why the overlays were misplaced is still not known.** Everything the app could read agreed with itself. A `line_yrange` call returns the
  layout's own numbers, and the layer is right where the overlays were wrong, so the cause is in how `add_overlay` children are positioned in
  a view whose far lines are estimates (the usual suspect), or in how S8 removed and re-added them (the "is not a child" warnings are a
  symptom of something; unverified as the cause). It no longer matters for the design, because nothing is placed as a child.
- The rule drawn by a tag (`paragraph-background-rgba` on the `---` line) is placed exactly right because it is part of the text, but it can
  only fill the line's whole box, so it is a bar about 22 px tall. A smaller font shrinks the box and the bar with it; it never becomes a hairline
  without making the line's height wrong for the caret. Not used.

## What this does not show

- **Frame time and GPU:** software GL only; `BENCH` is the closure, not raster. A rule per section and one picture in 25 is the note's shape; a
  note with hundreds of large, distinct images (decode time, texture memory, eviction) was **not tried**.
- **The mouse:** clicking on or beside a picture, a drag selection across one, and where the caret lands in the picture's reserved room. The
  layer takes no input, so a click goes to the text view; whether that feels right is **unverified**.
- **Selection highlight and the layer's order:** the layer draws above the text view. A selection across a picture's room is not shown.
- **Scrolling in motion:** screenshots after `goto` and paging, not a recording of a drag. Kinetic scrolling and smooth scroll are unverified.
- **Wrapping at a very narrow width, right-to-left text, a 2x scale, Wayland:** not tried for the layer (the S3 shell was drawn at scale 2 on Weston).
- **Pooled overlays:** not built. If the layer ever proves wrong (a GTK change, a theme that clips), they are the fallback, with the S8
  numbers as the reason to prefer the layer.
- **Accessibility:** a picture drawn by the layer is not an accessible object; the text of its Markdown line is (AT-SPI gave the visible text in
  S8). What a screen reader should say about a picture is undecided and belongs to step 5.

## What to do with this

Build step 5 draws pictures and rules with the layer (about 100 lines of Rust here, of which 45 are the widget). The remaining S8 items are unchanged: cursor keys at a
construct's edge, range-based re-reading (an `Enter` still re-reads the note, about 36 ms of the 42), the mouse, a real parser, then Gate L on the
VM. The S8 scenario driver now has an `s11` scenario that is worth keeping as a regression test of the layer.
