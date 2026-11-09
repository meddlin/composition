# S8: the Live tab on GTK

Run 2026-11-08, in the Ubuntu 24.04 arm64 container (see `../container/`): Xvfb with software GL, real key events from `xdotool`, IBus with
`ibus-hangul`, AT-SPI read back through `pyatspi`. Code: `src/parse.rs` (a small line scanner), `src/main.rs` (the widget, and a stdin command
channel the driver uses), `../container/live_drive.py` (the driver and the scenarios). Builds with the same GTK 4.14.5, libadwaita 1.5.0 and
GtkSourceView 5.12.0 as the other spikes.

**Question.** [S4b](../s3-shell/RESULT.md) showed that hiding Markdown marks with `invisible` text tags works. The Live tab needs more:
the web editor's rule (a construct shows its marks while the selection touches it, ends included), headings drawn large, pictures and rules
drawn in place, and all of it surviving arrow keys, selection, copy, delete, undo, an input method and a 5,000-line note. Is the Live tab
viable on GTK, and does it belong in v1?

> **Decided 2026-11-09 (the user): the Live tab is in v1 on Linux, as on the iPad**, over the recommendation below. The six items under "For the decision" are now build step 5 and spike S11 in the design.

**Answer: the mechanism is viable and cheap, the keyboard, copy, undo and input-method behaviour is mostly right, and a 5,000-line note is
no problem for the text. Two things are not solved: pictures and rules drawn as overlay widgets were wrong or missing in the middle of the
long note, and three cursor movements differ from the web editor. Recommendation: the Live tab stays out of v1 (D18); the work left is
behaviour parity, not a question of whether GTK can do it.**

## What the prototype does

A `GtkSourceView` with no language. Per line, a scanner finds headings, rules, bold, italic, strikethrough, code, `<Mark>` highlights and
`![alt](src)` pictures, with the characters that are their marks. Style is a `GtkTextTag` on the content (`weight`, `style`,
`strikethrough`, `family`, a background; headings with `scale` 1.7 down to 1.0); marks carry `invisible` while hidden and a dim colour while
shown. A construct's marks are shown while the selection touches it, ends included; **only the constructs whose state changes are re-tagged**,
and after an edit only the caret's line and its neighbours are read again (a change in the number of lines reads everything). Frontmatter is
set in a small monospaced face. Pictures and rules are `GtkTextView::add_overlay` widgets, with `pixels-below-lines` reserving the
picture's room; the buffer text is never touched, so it is the Markdown, character for character.

Not built: nesting, escapes, code fences, lists, tables, `<Image>`, links, the `<Mark>`'s colour, any colouring of the other constructs.

## Results

Screenshots are drawn by GTK with `GtkSnapshot`, in `screenshots/`.

| Check | Result |
|---|---|
| Marks hidden away from the caret, shown (dim) while it touches a construct | **Works.** `marks-hidden-away-from-caret-dark.png`, `caret-in-bold-dark.png`, `caret-on-picture-dark.png` (on the picture's text the Markdown shows and the picture is drawn after it, as the spec says) |
| Headings drawn large with `# ` hidden; bold, italic, strikethrough, code, highlight | **Works**, in dark and light |
| **Right arrow** across a construct | One buffer character per press (columns 14, 15, 16, 17, 18, ...). The marks appear as the caret reaches the construct's start, so it never jumps over an opening mark |
| **Left arrow** into a construct from its right | **Differs.** From just after the closing marks the caret went 33, 32, **29**, 28: it lands *before* the hidden closing `**` (which then appear), skipping two positions. GTK treats hidden characters as zero width, so the position after them is not a stop going left. The web editor can put the caret after the closing marks by arrow key |
| **End** on a line that ends with a bold construct | **Differs.** It went to before the hidden closing `**`; the typed `xxx` landed inside the bold (`very endxxx**`). Continuing after the bold needs a Right press |
| Down and Up across lines with hidden marks | Fine in the cases tried; a heading reveals its `## ` when the caret arrives, so the text shifts right under the caret (as it does on the web) |
| **Selection and copy** | A selection reveals every construct it touches (select all showed all 13 of 13), and **the copied text equals the buffer's text for the selected range, marks included**: the Markdown source, as the web Live tab promises. Checked for 6 characters across a mark and 127 across five lines |
| Delete and Backspace over marks, then **undo** | Two `Delete`s removed an opening `**`; two `Ctrl+Z`s restored the line exactly. Tags are not part of the undo history and are rebuilt by the edit handler |
| **Input method** (IBus, `ibus-hangul`, X11) | `gksrmf` composed to `한글` **inside a revealed `**bold**`** (the construct count did not change and its style stayed), **at the end of a heading**, and **on a picture's line**. Wayland text-input, Fcitx 5 and other engines: **unverified** |
| **A screen reader's text** | AT-SPI gave the visible text only: 133,185 of the 162,264 characters of the 5,000-line note, with no `**` in it; reading it took 17 ms. (Orca itself: **unverified**) |

### A 5,000-line note

5,006 lines, 4,357 constructs, 643 overlays (619 rules, 24 pictures; the note is `--generate 5000`):

| | Live logic | Live logic without overlays | No Live logic (plain GtkSourceView) |
|---|---:|---:|---:|
| First read of the whole note | 59 to 87 ms | 34 to 67 ms | n/a |
| **A caret move** (re-tag only what changed) | **0.05 ms** | 0.06 ms | n/a |
| The same move re-tagging everything | 71 ms | 40 ms | n/a |
| 200 characters typed in the middle (until the buffer has them) | 55 ms | 67 ms | 75 ms |
| 60 `Down` presses | 19 ms | 24 ms | 24 ms |
| One `Enter` (the line count changes, so everything is read again) | **75 ms** | 40 ms | n/a |
| Resident memory after start | 288 MB | 200 MB | 192 MB |
| Resident memory after 20 `Enter`s | **662 MB** | 201 MB | n/a |
| Per-frame cost of repositioning the overlays (none moved) | 3 ms | 0 | n/a |

What this says: **the tags and the incremental update cost almost nothing** (about 8 MB; typing is not measurably slower than plain
GtkSourceView; a caret move 0.05 ms against 40 to 71 ms for retagging all). **The overlay widgets are the expensive part**: about 90 MB for 643 of
them, 3 ms of every frame to keep them placed, and **memory grew from 288 MB to 662 MB over 20 re-reads** because each one destroys and
recreates all of them. They would have to be pooled and made only for what is on screen. Typing speed here is event handling, not drawing;
layout and drawing under software GL were not measured.

### Where the overlays went wrong

In a short note, and at the top of the long one, the pictures and rules were drawn where their lines are
(`caret-on-picture-dark.png`, `5000-lines-top-light.png`). **In the middle of the 5,000-line note they were not**: the rules were drawn 70 to 90 px
from their lines, and the picture was missing (`5000-lines-middle-picture-missing-light.png`: the room for it is there, the picture is not).
The numbers the app can read agree with each other (the line's `iter_location`, the position it set, the widget's allocation, 12 px apart for the
view's top margin), and the caret's window position matched what was drawn, so **the cause was not found**. The layout of lines above the
viewport is estimated until it is validated, which is the usual suspect; per-frame repositioning did not fix it. **Treat `add_overlay` as
unreliable for the Live tab's pictures and rules in a long note.** Untried alternatives: a thin line drawn by a tag (a tiny font with a
paragraph background) for rules; drawing pictures at draw time in a `GtkTextView` subclass's `snapshot_layer`, where the coordinates are
the layout's own; or inline widgets through `GtkTextChildAnchor`, which put a U+FFFC character in the buffer and so break "the buffer is the
Markdown".

## For the decision (Live tab in v1?)

**Recommendation at the time: no, keep it Later.** (The user then chose v1: D24.) The mechanism is sound and cheaper than the iPad's TextKit 2 route, but a Live tab that
matches the web one still needs:

1. **Cursor movement fixed:** `End`, `Home` and Left at a construct's right edge go through the `move-cursor` signal (or a key controller)
   to land where the web editor does. Not tried.
2. **Range-based re-reading** on insert and delete, so `Enter` and multi-line paste cost what typing costs, not 40 to 75 ms.
3. **Pictures and rules that stay put in a long note**, by one of the alternatives above, with pooled widgets for what is visible.
4. **A real parser:** nesting, escapes, code fences and frontmatter edge cases, lists, tables, links, the `<Mark>` colours, the other MDX tags as text.
5. **The mouse:** click and drag selection with the layout shifting as constructs reveal. Not tried.
6. **The VM:** Orca, Wayland text input and Fcitx on real GNOME, and drawing speed on a real GPU.

R7 drops from "unproven" to "known work": keys, copy, undo and an input method were shown to work; the open part is layout and parity.

## Not covered

Mouse input; `Home`, `PageUp` and `PageDown`; `Up` and `Down` across a wrapped line; paste; drag and drop; `<Image src>`; a very long single
paragraph; smooth scrolling and frame times (software GL); Wayland, Fcitx and other engines; Orca.
