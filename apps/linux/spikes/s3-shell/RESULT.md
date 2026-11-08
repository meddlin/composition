# S3, S4 and S4b: the GTK shell, the editor widget, and hidden marks

Run 2026-11-07, in the Ubuntu 24.04 arm64 container (see `../container/`), against the libraries Ubuntu ships: GTK 4.14.5, libadwaita 1.5.0,
GtkSourceView 5.12.0, WebKitGTK 2.52.6 (`cargo run --bin probe` prints them). Crates: gtk4 0.11, libadwaita 0.9, sourceview5 0.11,
webkit6 0.6. Code: `src/main.rs` (the shell), `src/bin/probe.rs`, `src/bin/live_marks.rs`.

**What the container can and cannot show is in [`../README.md`](../README.md#what-a-container-can-and-cannot-show). Nothing here was run
on GNOME Shell, on a GPU, or with a screen reader. Every "works" below means "in that container".**

## S3: does a libadwaita app over the Rust core build and run?

**Yes.** The shell is 480 lines: an `AdwNavigationSplitView` (note list and search entry in the sidebar, the note in the content),
`AdwToolbarView` and `AdwHeaderBar`, an `AdwActionRow` per note, an `AdwAboutDialog`, a Markdown / Preview / Split toggle, a
GtkSourceView editor, and a WebKitGTK preview ([S5](../s5-preview/RESULT.md)). It opens the **S1 core** as a library
(`composition-core-spike`, a path dependency) and lists 101 notes from a copy of the search corpus; typing in the search entry calls the
core's search. The core has no GTK in it and the shell has no SQL, which is the layering the design proposes.

| Result | |
|---|---|
| Builds on Ubuntu 24.04 with `libadwaita` feature `v1_5` | Yes. Nothing newer than libadwaita 1.5 was used. Checked in the installed headers: 1.5.0 has `AdwDialog`, `AdwAboutDialog`, `AdwPreferencesDialog`, `AdwBreakpoint`, `AdwTabOverview`; it lacks `AdwSpinner`, `AdwToggleGroup`, `AdwBottomSheet`, `AdwShortcutsDialog` and the accent-colour API |
| Light and dark | `AdwStyleManager` forced either; the GtkSourceView scheme follows (`Adwaita` / `Adwaita-dark`), and the preview page is told (`data-theme`) |
| X11 | `GdkX11Display`, renderer **`GskGLRenderer` on Mesa llvmpipe** in Xvfb; window scale 1 and, with `GDK_SCALE=2`, 2 |
| Wayland | `GdkWaylandDisplay` on a headless **Weston** (pixman), compositor scale 2 honoured; GTK fell back to `GskCairoRenderer` because there is no EGL there. Client-side decorations present |
| Adaptive width | **Not exercised.** The spike set no `AdwBreakpoint`, so at 720 px the sidebar stayed beside the content |
| Frame times, input latency, GPU | Not measured: llvmpipe is software rendering |

Screenshots (drawn by GTK itself with `GtkSnapshot`; they are not compositor captures): `screenshots/xvfb-editor-dark.png` (X11, dark),
`screenshots/weston-wayland-scale2-editor-light.png` (Wayland, scale 2, light).

## S4: the editor widget

**GtkSourceView 5, over `GtkTextView`.** It is a `GtkTextView` (same text model, same input-method and accessibility code) with undo and
redo, a Markdown language definition, style schemes including Adwaita's two, and a completion framework. What was checked:

| Question | Result |
|---|---|
| Does the text widget implement `GtkAccessibleText` (the toolkit's AT-SPI text interface)? | **Yes** for `GtkTextView` and for `GtkSourceView` (`GType` check, `src/bin/probe.rs`); also `GtkLabel` and `GtkText` |
| What does AT-SPI actually export? (`../container/atspi_dump.py`, the bus Orca uses) | The window as a `frame`; the search box as an `entry` with the `EditableText` interface; the note list as a `list` of 101 named `list item`s; the editor as one `text` node, **editable, multi-line, focusable**, whose `Text` interface reported all 1,429 characters of the note |
| Does an input method reach the editor? | **Yes, on X11 with IBus.** `ibus-hangul` was started in the container, the editor focused, and `gksrmf` typed with `xdotool`; the committed text was `한글 ` (read back through AT-SPI, caret and count correct). The first attempt typed Latin letters because the engine starts in Latin mode and the window had no focus; `Shift+Space` and a visible window fixed both (`../container/ime-test.sh`) |
| IME on **Wayland** (text-input-v3), **Fcitx 5**, other engines (Pinyin, Anthy) | **Unverified** |
| Orca reading it, caret and selection events, braille | **Unverified** (no screen reader ran). What was verified is what the toolkit exports |
| Spell check | Not tried. Ubuntu 24.04 ships `libspelling` 0.2.0 and `gspell` 1.12; neither was linked |
| A 5,000-line note | Not tried (the iPad design's N7 target) |

## S4b: the Live tab's hidden marks

The Live tab shows a note as it will read, with the Markdown marks visible only in the paragraph that holds the caret. On the iPad that is
the riskiest part of the editor (TextKit 2, R1). On GTK the obvious mechanism is a `GtkTextTag` with `invisible = true`, applied to every
mark outside the caret's paragraph and re-applied when the `insert` mark moves. `src/bin/live_marks.rs` is that, in 60 lines:

| Check | Result |
|---|---|
| The buffer text is untouched by hiding | **Yes** (the marks stay in the text, so copy of the file, save, search and backup are unaffected) |
| Marks away from the caret hidden, the caret's paragraph shows its own | **Yes**: `screenshots/live-marks-caret-in.png` and `live-marks-caret-out.png` |
| Undo | Typing then undo restores the text; tags are not part of the undo history and need not be |
| What a screen reader is given | AT-SPI reported **120 characters** for a 138-character buffer: the hidden marks are left out, so what is read matches what is seen |
| Cursor movement across a hidden mark | Only `forward_visible_cursor_position` was exercised, on one line; **arrow keys, selection and copy over hidden text were not tried** (whether a copy takes the hidden marks is unverified) |
| Headings drawn large, images inline, tables | Not tried. `GtkTextTag` has `scale` and `GtkTextChildAnchor` holds widgets, so none looks blocked; not shown |

A caution from writing it: `GtkTextIter::forward_to_line_end` on an **empty** line goes on to the end of the *next* line. The first run
hid the wrong paragraph's marks because of that (fixed: `ends_line()` first). A real Live editor needs a test for it.

**Reading.** On this evidence the GTK mechanism is cheaper and lower-risk than the iPad's, but the part that was easy (hiding) is not the
part that was hard on the iPad (caret, selection and IME while characters come and go). Treat the Live tab as **Later**, with a spike
(S8) before it is promised.

## Things the spike got wrong or left rough

- Split position: the first run computed it from a widget that had no width yet (an unreadable 30-pixel editor); fixed from the window's
  default size.
- A screenshot taken 900 ms after a scripted scroll was a blank frame; at 3 s it was right. A timing artefact of the harness, not
  investigated.
- No autosave, no frontmatter parsing, no `[[` or `<` completion, no menus beyond About: it is not an app.
