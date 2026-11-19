# iPad: Live as the default view

The iPad's Live tab ([ipad-live-view-plan.md](ipad-live-view-plan.md), Gate L passed 2026-11-09) draws headings, bold,
italic, strikethrough, code spans, rules, pictures, `<Mark>` tints and a muted frontmatter, and hides their marks away
from the caret. Everything else it still shows as Markdown source: links, lists, quotes, code blocks, tables,
footnotes and the components. This plan covers drawing them, then making Live the view a note opens in. Markdown,
Preview and Split stay.

It is the iPad's counterpart of the desktop's [live-default-plan.md](live-default-plan.md) (decision D8 there: a
separate iPad plan that copies the owner's decisions and adapts only what touch or UIKit needs). That page is on the desktop's own branch, so the link to
it leads nowhere on `main` until that branch merges. Status: **drafted
2026-11-17; the iPad questions I1 to I7 were decided by the owner the same day, all as recommended** (see
[Decisions](#decisions)). Steps 0 to 8 are built (each step's status is under it); Step 8 made Live the default.

## Goal and rule

The desktop's, unchanged:

- **Live reads like Preview.** Away from the caret, a note in Live looks as it does in the iPad's Preview, close
  enough that the Preview is opened only to read a note top to bottom.
- **The text stays the source.** The text view holds the Markdown character for character; only attributes and
  drawings change, as in every Live step so far (no text attachments, no `U+FFFC`). Switching to Markdown shows
  exactly what was typed. Undo, find, autosave and the typing aids keep working because the characters never change.
- **No regression.** `LiveUITests` (the caret, delete, tap and composition tests of L3 to L6), the core's
  `LiveModel` tests and the oracle keep passing at every step.
- **One renderer.** Where Live draws a block, it draws it with the Preview's own SwiftUI views, not a copy.

## How the iPad differs from the desktop, and why it matters

| | Desktop | iPad |
|---|---|---|
| Preview | React (`NoteMarkdown`) in the web view | **Native SwiftUI**: `CompositionCore`'s `NotePreview` turns the note into `PreviewBlock`s; `NotePreviewView` and `MarkdownView` draw them |
| Live | CodeMirror decorations; block widgets mount React | **UITextView on TextKit 2**: `LiveModel` (core) says what is hidden and styled; `LiveOverlay` puts it on as attributes; `LiveDrawing` (a custom `NSTextLayoutFragment`) draws rules and pictures in a paragraph made tall enough for them |
| Long notes | 100,000-character limit (desktop Step 1 lifts it) | **No limit** (V5, 2026-11-09): the desktop's Step 1 has no iPad counterpart |
| Fences | Shown (desktop Step 3 hides them outside the block) | Hidden outside the block since V2: after desktop Step 3 the two agree |
| Tabs | Panes and panels, each with its tab | One note per window; the tab is `@SceneStorage("noteMode")`, remembered per window, **Preview** the first time; a new note forces Markdown |
| Markdown ↔ Live | Two editors | **One text view**: both tabs are one branch of `NoteDetailView`, so switching keeps caret, keyboard, scroll and undo |
| Preview ↔ editor | Live stays mounted (D7) | The editor is torn down when Preview shows, and rebuilt (a different branch) for Split: undo is lost |

**"Draw a block with Preview's own code" carries over, but as a picture.** CodeMirror can mount a live React root in
a widget. TextKit 2 cannot host a view inside the text without an attachment character (`NSTextAttachmentViewProvider`
needs `U+FFFC` in the string, which breaks "the text stays the source"). What Live already does for pictures can:
make the block's paragraph tall, hide its characters with the half-point clear font, and draw in a custom layout
fragment. So a block is drawn by rendering the Preview's own `PreviewBlockView` / `MdBlockView` for that block into
an image (`ImageRenderer`) and drawing that image in the fragment. Same views, same `Look`, same component decisions
from `NotePreview`; nothing per component. The alternative, live SwiftUI views laid over the text and moved with the
layout, is decision I6.

## What is left

What the iPad's Preview draws and its Live tab does not, as of `10542f8` (read from `NotePreview.swift`,
`NotePreviewView.swift`, `MarkdownView.swift`, `LiveModel.swift`, `LiveScan.swift`):

| Construct | Live today | iPad Preview | Step |
|---|---|---|---|
| `<Ink src … />` (what the iPad's own *Drawing…* inserts) | **Source** (`LiveScan` reads only `<Image … />`) | The drawing, from its strokes in the scheme's colours; a tap opens it on the canvas | 1 |
| `<Drawio src … />` | Source (L4 left it) | Its stored PNG at half size (no Edit on the iPad) | 1 |
| Links `[text](url)`, `note:`, `pdf:` | Coloured; brackets and URL show; a tap edits | Link colour; a tap follows `note:` and `pdf:` (and opens web links); a `pdf:` link to a PDF not here is struck through with "(PDF not on this device)". `#heading` links are not followed | 2 |
| Fenced and indented code blocks | Code colour; fences hidden outside the block (V2) | Monospaced on a rounded `surface` fill, scrolls sideways; **no language colours** | 3 |
| Bullet and ordered lists | Marker coloured | `•` or the number, muted; items in a column beside it | 4 |
| Task lists `- [ ]` | Text | `square` / `checkmark.square.fill`, read-only | 4 |
| Blockquotes | `>` coloured | A 3-point bar, the quote muted | 4 |
| Tables | Pipes | A SwiftUI `Grid`, header bold, a rule under it, scrolls sideways | 5 |
| `<Info>`, `<Warning>` | Source | Panels with an icon, a tint and a bar, children drawn inside | 6 |
| `<Chart>` | Source | Swift Charts (bar, line, area, pie), in the scheme's series colours | 6 |
| `<YouTube>`, `<Repo>` | Source | Cards that open the address (nothing embedded or fetched) | 6 |
| Block `<Mark>` (around paragraphs) | Tinted words | The blocks on a tinted rounded fill | 6 |
| A component with bad props, or a note that is not valid MDX | Source | A notice ("YouTube video: add a url"; "Couldn't render this note's components …") | 6 |
| `<Toc />` | Source | "Contents", entries that scroll the Preview to the heading | 7 |
| `[^1]` and `<Footnotes />` | Source | Superscript digits; a numbered list (also at the end when there is no tag) | 7 |
| Setext headings (`Title` / `===`) | Text (the model draws ATX only, as the desktop's does) | Headings (swift-markdown reads them) | 7 |
| Frontmatter | Small, muted, monospaced YAML | Not in the body: the **header above it** (header image, title, date, tags) | 7 |
| `<Sheet>` | Source | **Nothing** (the iPad has no Sheet yet; `NotePreview` returns no block) | out of scope |
| Raw HTML | Coloured | Monospaced, muted | stays |

Already drawn and left alone: ATX headings, bold, italic, strikethrough, inline code, rules, `![…](…)` and
`<Image />` pictures on a line of their own, inline `<Mark>` tints, the frontmatter's lines.

## Approach

### Two kinds of drawing, as on the desktop

1. **Inline and line drawing** stays where it is: `LiveModel` gains the constructs (links, list markers, task boxes,
   quote lines, code-block lines, setext underlines, footnote refs), `LiveOverlay` puts attributes on (hidden runs,
   colours, paragraph indents), and `LiveDrawing` draws what attributes cannot (a bullet where a hidden `-` is, a
   checkbox, a quote bar, a code block's fill). It follows the selection by construct (V1), as now.
2. **Blocks** (tables, components, `<Toc />`, `<Footnotes />`, the frontmatter header) are new: `LiveBlocks`
   (app side) keeps, for each top-level block, its source range and a picture of it. The block's first paragraph is
   made as tall as the picture, every character of the block is hidden, and the fragment draws the picture. Built on
   the same pause pass that already re-reads the note (`MarkdownStyler`'s correction a pause after typing).

### Where the blocks come from

The Preview already makes a `NotePreview` of the whole note off the main thread, a quarter of a second after typing
(`LivePreview`). Live makes the same one, in its pause pass, with one addition in the core: **each top-level
`NoteBlock` carries its source range** (`NoteScanner` knows where it cut the note; it does not say yet). A block
needing the whole note (`<Toc />`, `<Footnotes />`, footnote numbers) is then right for free, because the whole
note was read. A Live block is "this range of the text, drawn as this `PreviewBlock`".

### The reveal rule (D3)

Inline constructs keep V1: the marks show, dimmed, while the selection touches them. A block, while the selection is
in it, **shows its source with the last good picture under it**, the way a picture's Markdown already shows with the
picture after it (L4). The picture is redrawn by the pause pass (about 300 ms after typing, the same pause the
colours use), so a half-typed tag never flashes a notice. The frontmatter is the exception (D5): only the YAML while
the caret is in it.

A tap on a drawn block puts the caret at the start of its source, as a tap on a drawn picture does today. What a
component does when touched (a `<Toc />` entry, a card's address, editing a drawing) is decision I6.

### Following a link without a mouse (D2 on touch)

A tap in a UITextView that is being edited moves the caret: that is how the Live tab edits, and it stays (D2: a
plain click edits). Following needs something else. The starting pick, I1: while the caret is in a link (its source
showing), a small **↗** sits just after it, drawn as a button over the text view at the link's last rect (the way the
`<` list is placed at the caret), 44 points to hit; a tap on it follows. With a hardware keyboard, **⌘-tap** on a link
follows at once (`UIGestureRecognizer.modifierFlags`, iPadOS 13.4+), and ⌘-click with a trackpad is the same
gesture. Following uses the Preview's handlers (`followNoteLink`, `followPdfLink`, `openURL`), lifted out of
`NoteReader` so both tabs call one thing.

### Keeping Live's undo across a tab switch (D7)

Markdown and Live already share one text view and so one undo stack. What is new: **the text view stays alive
while Preview or Split shows**. `NoteDetailView` lays the editor and the reader out in one structure for all four
modes (the editor hidden under Preview, beside the reader in Split) instead of a `switch` with a branch per mode, so
SwiftUI keeps the editor's identity. An edit that reaches the note from outside the text view (a drawing edited from
the Preview, a quote from a PDF appended while the Preview shows, the header image sheet) goes through
`NoteSession.edit`; it clears the text view's undo, as on the desktop.

## Steps

Each step lands on its own branch and PR, adds core tests (`LiveModel`, the block ranges), UI tests that read
`live-report` (Debug and test builds, `-liveReport 1`), a section in the iPad docs and numbered items in
[manual-tests/ipad.md](manual-tests/ipad.md). **New manual-test items start at 340**: the page ends at 322 on
`main`, and 323 to 336 are taken on unmerged branches (`claude/ipad-plugins-status-2d0a84`, the Reading List
worktree). **Simulator** = I check it with UI tests and screenshots; **iPad** = only you can (the Pencil, a finger's
feel, VoiceOver, speed on the device).

### Step 0: where notes open, and keeping the editor (M)

- The **"Open notes in" setting** (D9 as adapted): Live, Markdown, Preview or Split, in the Appearance sheet's
  *Writing* section, kept on this iPad (`@AppStorage`, like the Split divider's place), **Preview** by default until
  Step 8 (I3, I4). **Every note opens in it**; changing the tab lasts until another note opens (I3). This replaces
  the per-window memory of the last tab (`@SceneStorage("noteMode")`), which keeps only bringing back, after the app
  was ended, the tab of the note that was open.
- **A new note** opens in the setting's view when it is Live, Markdown or Split, and in Markdown when it is Preview
  (I5; Live from Step 8).
- **The editor stays alive under Preview and Split** (D7, above). `NoteDetailView`'s `switch mode` becomes one
  layout; Split's editor is the same view as the Markdown/Live one.
- **Simulator:** UI tests: with the setting on Live a note opens in Live; type, go to Preview and back, ⌘Z undoes
  the typing; the same through Split; an ink edit from the Preview then back leaves nothing to undo; the caret and
  scroll survive Preview and back. The existing suites pass (Split's divider tests especially).
- **Gate LD0 (iPad, yours):** items 340 to 343.

**Built, 2026-11-18, in the Simulator.**
- **The setting:** *Open notes in* is the first row of the Appearance sheet's *Writing* section (`@AppStorage("openNotesIn")`,
  Preview by default). `NoteDetailView` opens every note in it; `@SceneStorage("modeNote")` remembers which note the tab was
  chosen for, so only the note open when the app was ended comes back in its own tab. A new note opens in the setting's
  view, or Markdown when that is Preview. `-openMode` (Debug) still overrides it.
- **One layout for the four tabs:** `noteContent` is always a `SplitLayout`, which now takes `showing` (`.both`, `.leading`,
  `.trailing`) and lays the same two views out with `AnyLayout` (side by side, stacked, or one over the other), so the text
  view keeps its identity across every tab: undo survives Preview and Split. Under the Preview the text view is hidden
  (`isHidden`) and takes nothing a caller can put at the end of the note instead (`EditorHandle.isShowing`: a PDF quote while
  the Preview shows still goes to the end).
- **An edit from outside the text view clears its undo** (`Coordinator.show` calls `removeAllActions()`), as D7 asks.
- **Found on the way:** giving up the keyboard inside `updateUIView` (directly, or by hiding the view or turning its touches
  off) made the keyboard's tracking ask SwiftUI to render inside the same update: an AttributeGraph cycle that held the main
  thread (seen by sampling the app while a UI test stalled). The hide now happens on the next turn of the run loop.
- **Checked:** `OpenNotesInUITests`, five tests: every note opens in the setting's view and a tab chosen lasts until another
  note opens; the setting chosen in the sheet is kept across launches; ⌘Z undoes typing after a look at the Preview, and
  after Split and Markdown; an edit from outside (a test-only button in the Preview, the path a PDF quote takes) leaves
  nothing to undo. Also run: `LayoutUITests` (the Split divider), `PdfMarksUITests` (a quote and a citation while the
  Preview shows still go to the end of the note), `PolishUITests`, all of `AccessibilityUITests` (two audits failed once
  because a tap on the restore alert was lost under load and the audit saw the alert; both pass on a rerun, and on the base
  commit) and the picker-order test of `LiveUITests`. `LiveUITests.testSwitchingTabsKeepsTheCaretAndTheTextAndTheLiveLookComesBack`
  failed, and **fails the same way on the base commit** under this load (its Markdown tab tap is not retried). All of it on a
  Mac at a load of 300 to 800 shared with five other Simulator sessions; the rest of the UI suite was not rerun here. **XCUITest still lists the hidden text view** (a representable's view), so whether VoiceOver skips it
  under the Preview is item 342's to say.

### Step 1: `<Ink>` and `<Drawio>` as pictures (S)

- `LiveScan` reads `<Ink … />` and `<Drawio … />` as it reads `<Image … />`; `LiveImages` draws an `<Ink>` from its
  strokes in the scheme's colours (the Preview's `InkPictureView`), a `<Drawio>` at half its pixel size.
- The desktop's Live draws `<Ink>` already: its `liveDecorations` is the oracle for the ranges (`live-cases.json`
  gains Ink and Drawio texts).
- **Simulator:** a drawing made with *Drawing…* is drawn in Live in all five schemes (pixel check, as L4's tint test);
  the caret on it shows its tag with the drawing after it.
- **Gate LD1 (iPad):** item 344.
- **Status (2026-11-17): built; the Simulator checks pass; Gate LD1 is the owner's.** `LiveScan` reads the three
  tags in one pass and `LiveDecorations.Picture` carries a `kind` (`image`, `ink`, `drawio`). `LiveImages` reads a
  drawing's strokes off the main thread and renders them with `InkRenderer` in the scheme's `InkPalette`, cached by
  file, scheme and scale; until they are in, the drawing is sized from its PNG's pixels and `pHYs` density (the same
  size), so nothing jumps; a PNG with no strokes is drawn as its pixels. A `<Drawio>` is drawn at half its pixels
  unless the tag gives a width. The fixture writer emits the desktop's `InkWidget`s as `inks`; `LiveConformanceTests`
  compares them (24 new texts in `live-cases.json`, group `drawings`) and leaves `<Drawio>` out, since the desktop's
  Live tab does not draw it (checked by `LiveModelTests` instead). UI tests: `LiveDrawingsUITests` (a finger's line
  drawn in Live in all five schemes, its pixels the scheme's ink colour; the tag shown with the drawing after it
  under the caret; a diagram at 440 points from its 880-pixel PNG). `live-report` gains `picture-ink`,
  `picture-drawio`, `natural<width>` and `ink-strokes`.
- **Gate LD1 failed (2026-11-18), fixed (2026-11-19).** The Pencil over a drawing started Scribble, which wrote into
  its hidden tag, and the drawing vanished (item 344). `LiveScribble` adds a `UIScribbleInteraction` whose delegate
  refuses to begin over the band any drawn picture or block takes (`LiveDrawingFragment.drawnRoom`), across the
  whole line, and `LivePencilOpen` makes a Pencil touch on a drawn `<Ink>` open its canvas (the owner's choice; it
  amends I6 for the Pencil only). UI tests: `LiveScribbleUITests`. Retest: items 344 and 372.

### Step 2: links (S to M)

- `LiveModel`: link nodes; away from the selection `[` and `](url "title")` are hidden and the text is drawn in the
  link colour, underlined. A `pdf:` link to a PDF not here is struck through, muted, as the Preview draws it (the
  words "(PDF not on this device)" are not text in the source, so Live draws them after the link in the fragment).
  Autolinks and bare URLs are drawn as links.
- Following: per I1 and I2; the handlers lifted out of `NoteReader`.
- **Oracle:** once the desktop's Step 2 is merged, the fixture writer emits its link facts (the hidden runs and the
  link's range) into `live-expected.json`, and `LiveConformanceTests` compares them. Before that, hand cases only.
- **Simulator:** the report shows the hidden runs; a tap on ↗ opens the other note; ⌘-tap with the keyboard
  modifier opens it (XCUITest can hold ⌘ on a tap); a plain tap puts the caret in the link; editing a link's text
  and URL from the keyboard.
- **Gate LD2 (iPad):** items 345 to 348 (↗ with a finger, ⌘-tap on the Magic Keyboard, a trackpad, VoiceOver on a link).
- **Status (2026-11-17): built, Simulator only; LD2 is yours.** `LiveModel` reads `[text](url "title")`, `[text][label]` /
  `[text][]` / `[text]` with a definition, `<url>` and bare addresses (found in the text as lezer's GFM `Autolink` finds
  them: cmark here has no autolink extension). `LiveOverlay` draws the words in the link colour, underlined; a dead
  `pdf:` link is struck through and muted, and `LiveLinkFragment` draws "(PDF not on this device)" in room made by
  kerning the character after the words. `LiveLinks` keeps the ↗ (`live-follow-link`) after the link the selection is
  in and takes ⌘-tap; both call `LinkFollower`, which the Preview's `openURL` now calls too. **Oracle:** the fixture
  writer no longer leaves link marks out of `live-expected.json` and writes each link's range and address;
  `LiveConformanceTests` compares them, and 404 of 405 texts agree. Left out: `[nested [brackets]](u)` (lezer takes the
  inner `[brackets]` as a link even undefined, so the desktop draws none; cmark and the Preview make the outer one the
  link), in `known`; and the desktop's link on a footnote definition's first word (`[^a]: A.` drawn as a link to
  `http://A.`), not compared, since footnotes are Step 7's. A reference link whose definition is in another block is
  found by the full read a pause after typing, not by the quick read of the edited block. **Simulator:**
  `LiveLinksUITests` (hidden and dimmed marks, the ↗ and following it, ⌘-tap, a plain tap, editing a link, the dead
  `pdf:` link). XCUITest's held ⌘ does not reach a touch's `modifierFlags` in the Simulator (they arrive as 0), so the
  ⌘-tap tests launch with `-liveCommandHeld 1` (Debug and test builds), which stands in for it; the real ⌘ on a
  keyboard is item 346. The ↗ sits on the line after the link's `)`, so it covers the start of a word that follows:
  your look in LD2.

### Step 3: code blocks (S)

- Each line of a fenced or indented block: the code font at the Preview's size, and the fragment draws one rounded
  `surface` fill behind the block (first and last line rounded). Fences as V2. Colours per I7.
- **Simulator:** pixel check of the fill in five schemes; typing in a block keeps the 16 ms budget (`LiveBench`).
- **Gate LD3 (iPad):** item 349.
- **Status (2026-11-17): built, Simulator only.** `LiveModel` gives each block (`LiveDecorations.codeBlocks`): its range, the lines drawn on
  the fill (first and last are the rounded ends) and which of them are fences, and the indents hidden (`codeIndentsHidden`). The app
  (`LiveCode.swift`) puts each line in the Preview's code font (`.callout` monospaced, as Dynamic Type sizes it), 12 points in from the fill,
  and `LiveDrawingFragment` paints the line's share of one `surface` fill behind it. Away from the caret a fence line collapses to nothing
  (the desktop's Step 3 does the same), and a **top-level indented block's four-column indent is hidden**, as the desktop hides it; a block
  with nothing between its fences keeps them, also as the desktop. A long line wraps (the Preview scrolls it sideways).
  **Oracle:** the fixture writer emits the desktop's `codeDecorations` facts (`live-code-expected.json`) whenever `liveCode.ts` is in the
  tree, and `LiveConformanceTests.codeBlocks` compares lines, ends, fences, collapsed fences and hidden indents for every selection: run
  against the desktop's Step 3 branch, **all 375 texts agree, with nothing in `knownCode`**; since the plan branch took main (with the
  desktop's Step 3, through Step 2), it runs here too: all 429 texts and 64,839 selections agree. On a tree without `liveCode.ts` the file
  is not written and the comparison is skipped with a message. The V2 difference in the fixtures table is gone.
  **Simulator (iPad Pro 13-inch):** `LiveCodeUITests` (8) and `LiveUITests` (36) pass; the fill's pixels are checked in all five schemes.
  **`LiveBench`** (Release, `EDITOR_TEST_HOOKS`, 200 keystrokes, two alternating rounds each; the Mac's load average was 190 to 810, so
  the whole-keystroke times are mostly that): the Live pass per keystroke (the styler) is 0.5 to 1.2 ms before and after, typing in a
  block or in a paragraph. In a 5,000-line note a keystroke in a block took a median of 5 to 10 ms before (p95 16 to 21, 7 and 13 of 200
  over 16 ms) and 8 to 10 ms after (p95 11 to 33, 4 and 26 over, the 26 at a load of 786); in a 20,000-line note every keystroke is over 16 ms before and after alike (median 25
  to 30 ms, nearly all of it TextKit's layout, which this step does not change). No regression to see; the iPad's own numbers are LD3's.

### Step 4: lists, task lists, quotes (M)

- Bullets: away from the caret's line the `-`/`*`/`+` is hidden and the fragment draws `•` in its place, muted;
  ordered lists keep their numbers, muted. Wrapped lines hang under the item's text (`headIndent` per depth: an
  attribute, so the text is unchanged).
- Task lists: `[ ]` and `[x]` hidden and drawn as the Preview's symbols. **A tap on a drawn box toggles the `x`**
  (D4) through the text view, as one undo step; the tap target is 44 points round the box, and a tap anywhere else
  on the line edits. The Preview's boxes stay read-only.
- Quotes: a bar and an indent; `> ` hidden away from the caret's line; the quote's text muted.
- Return continues a list or quote as the Markdown tab does (`EditorAssist`), checked again.
- **Oracle:** the desktop's Step 4 facts, when merged.
- **Simulator:** UI tests for each, including Return, Tab/Shift-Tab over list lines (L5's test extended) and the
  toggle's undo.
- **Gate LD4 (iPad):** items 350 to 353 (a finger on a checkbox, the Pencil and Scribble in a list).

**Status (2026-11-17): built; Simulator checked; Gate LD4 is yours.** Branch `claude/ipad-live-step4-lists-26edbb`.

- **Core:** `LiveModel` gives each line of a list or a quote (`LiveDecorations.lists`): its lists and quotes outermost first, whether an item starts
  on it, and, away from the selection, the marks and indentation to hide, the marker (a bullet, or the number as written) and the task box.
  `LiveReader` reads them from cmark's quotes and items and finds the marks in the text as lezer does (the desktop's `readLines` and `prefixEnd`,
  liveLists.ts). What they hide is kept apart from `hidden`, so the fixture made by a desktop without its Step 4 still compares as before.
  `differences(from:)` now also returns list lines, because a quick re-read of a window can end an item early (a lazy line below the window) and the
  colours do not show it.
- **Oracle:** the fixture writer (`apps/web/scripts/conformance-fixtures.test.ts`) gives the desktop's list facts from its real
  `listDecorations` (`lists`: each line's lists and quotes and whether an item starts on it; `listDrawn`: the bullets, numbers, boxes and hidden
  marks), and `LiveConformanceTests` compares them (only when a fixture has them, so an older one still reads). **All 21,613 selections over
  429 texts agree** (2,273 with list or quote lines, 334 with a drawn box), with Steps 1 to 3's facts beside them. Hand cases in `LiveListTests`
  cover the same and the iPad's own parts (the box a tap finds, edits followed against a fresh read).
- **Beside Steps 2 and 3:** a line that is also a code block's (a code block in a quote or an item) or that holds a dead `pdf:` link is given that
  step's layout fragment, so it draws no quote bar or bullet of its own; its indent and hidden marks are still right. Joining the fragments is a
  follow-up.
- **App:** `LiveLists` puts on each line's indent (2 em a list level; the Preview's 3-point bar and 10 points a quote level; `headIndent` the same
  as the first line's, so a wrapped line hangs under the text), the hidden marks and the quote's muted words; `LiveListFragment` draws the bars and,
  in the level left of the text, the Preview's muted `•` or number, or its `square` / `checkmark.square.fill` (in place of the bullet, as the Preview
  does; the desktop draws both). On the caret's line the marks show as written, starting a level further out. `LiveTaskTap` ticks or unticks a drawn box
  through the text view (`replace(_:withText:)`), leaving the selection; the target is 44 points round the box, cut off where the item's text starts.
- **Simulator (2026-11-18):** `LiveListsUITests` (7, from `live-report`, with the boxes tapped where the Debug-only `live-boxes` element says they are):
  bullets, numbers and a nested item drawn and their marks shown on the caret's line; a quote's bars, hidden `> ` and muted words; two box taps
  each undone on its own by ⌘Z, the selection left where it was; a tap on an item's words edits and draws no box on that line; Return and Backspace
  in a list; Tab and Shift+Tab nesting and un-nesting two items. All 36 `LiveUITests` pass (some re-run alone: the Mac was very loaded, and on an
  11-inch iPad the crowded toolbar covers the view picker's *Markdown*, so the tab-switching and scheme tests were run on a 13-inch). Screenshots
  showed the bullets, numbers and boxes in the level left of the words.
- **Not built (as of the Step 4 PR):** Return did not continue a list or a quote in either tab. The plan said "as the Markdown tab does (`EditorAssist`)", but
  the iPad's Markdown tab never had: Return was a plain line break in both, and that is what Step 4 checked. VoiceOver says nothing of a box's state yet
  (item 353).
- **Return and Backspace in lists, built after Step 4 (2026-11-18, its own PR on top of Step 4's):** `ListContinuation` (CompositionCore/Editing) ports
  the desktop's CodeMirror `insertNewlineContinueMarkup` and `deleteMarkupBackward` (@codemirror/lang-markdown 6.5.2) to answer a `LineEdit`, which
  `NoteTextView.apply` puts in as one edit through the text view; the editor's delegate asks it in both tabs (after the list at the caret has had Return,
  not over a selection, not while an input method is composing, and for Backspace only when it takes the one character before the caret). The commands read
  lezer's tree, and where lezer ends an item or a quote is not where cmark does, so `MarkdownBlocks` ports the part of @lezer/markdown 1.8.1's block parser
  they look at (containers, their marks and where each block ends; HTML blocks and tags, where the desktop's Markdown is not active). **Oracle:**
  fixtures/conformance/list-continuation-cases.json, 124 texts with Return and Backspace tried at every caret place by the real commands
  (conformance-fixtures.test.ts writes list-continuation-expected.json); `ListContinuationConformanceTests` agrees at all 2,104 places (1,206 where Return changes the text, 285 where Backspace does), and
  `ListContinuationTests` has hand cases. It is the desktop's behaviour, quirks included: Return on the empty second item of a tight two-item list adds a
  blank line first (the list becomes loose), and Backspace after any item's `- ` (not only an empty one) turns it into spaces. Not ported: GFM tables
  and link reference definitions (leaf blocks either way). **Simulator:** see the UI tests in the PR; items 368 to 371 are yours (first numbered 359 to 362, which Step 6 had; renumbered 2026-11-18).

### Step 5: the block layer, and tables (L, starts with a spike)

- **Spike first (S):** in the Editor lab, a five-line table hidden and drawn as one picture: the first paragraph
  tall, the other lines' heights near zero, the caret arrowing into, out of and across it, a selection dragged
  through it, find landing in it, and the Pencil and Scribble beside it. Also `ImageRenderer` on the Preview's table,
  a chart and a panel (a `ScrollView` does not render in `ImageRenderer`: the table needs a non-scrolling variant;
  a table wider than the text is drawn scaled down to fit, or clipped with a fade, which is the spike's to choose).
  *No* = blocks fall back to their source with the picture under them always (D3's look while editing, all the time).
- **Core:** `NoteScanner` gives each top-level block its source range; tests that ranges cover the note and never
  overlap, over `mdx-notes.json` and the preview showcase.
- **`LiveBlocks`:** the pictures, cached by block text, text width, scheme and Dynamic Type size; redrawn on the
  pause pass; only blocks near the visible rect rendered.
- **Tables** through it.
- **Accessibility:** the text view's value stays the source (candidate B silences the pipes and dashes); a drawn
  table adds no element of its own (VoiceOver reads the cells' words in order). The audit runs on a note with a table.
- **Simulator:** the spike's cases as UI tests; arrowing and undo across a table; a pixel check that a table is
  drawn; the 16 ms budget on the showcase note.
- **Gate LD5 (iPad):** items 354 to 358 (arrowing, a finger's selection through a table, the Pencil beside one,
  scrolling speed with ten tables, VoiceOver).

**Status: built 2026-11-17** (branch `claude/ipad-live-step5-blocks-dd07b9`, stacked on this plan's branch). The spike
said **yes**, so blocks are drawn as pictures and the fallback was not needed. Gate LD5 is the owner's.

**The spike.** It was run on the Live tab itself, behind a launch switch, rather than in the Editor lab: the lab has
its own drawing code, and the question was whether the real fragment layer copes. `-liveBlockReveal never` keeps a
block hidden with the caret in it, which is the spike's "every character hidden" case; `LiveBlockSpikeUITests`
(skipped unless `LIVE_BLOCK_SPIKE` is set) drives it and logs what happened. A five-line table, its first paragraph
made as tall as the picture (`minimumLineHeight`), its other lines at `maximumLineHeight` 0.5, every character in the
half-point clear font:

| Case | What the Simulator showed |
|---|---|
| ↑ and ↓ across it, reveal off | One source line per press, both ways, from the line's end and from its start (eight presses from the line below the table to the one above). The caret on the four flat lines is drawn at one place (the bottom of the picture), so it does not seem to move; with D3 the source shows as soon as the caret is in, so this is never seen |
| Shift-↓ through it | One line per press, with and without the reveal; with it, the source shows from the press that enters the table, and the selection runs on past it |
| Find | Find (the toolbar's button) selects the word inside the hidden table, and the table reveals; closing Find leaves the selection there |
| Marked text beside it | Composing on the blank line after the table leaves the table drawn and nothing is restyled until the composition ends. GFM then reads the composed line as a row of the table (a line right after a table is one), and the table grows and reveals, as the Preview reads it too |
| A finger's drag | XCUITest's press-and-drag places the caret (the loupe) inside the table, which reveals; a selection handle dragged through it is item 355, the owner's |
| Scribble, the Pencil | Not in the Simulator: item 356 |

`ImageRenderer` on the showcase note's 22 top-level blocks (`-liveBlockSpike <folder>`, written by
`LiveBlockSpike`): every one draws, the line and pie charts (Swift Charts, no animation in the picture), the info and
warning panels, the cards, the notice and the table among them, in 1 to 120 ms each (the first of a kind is the slow
one; a table is about 9 ms). Only the table and the code block needed a change: `MarkdownView` puts both in a sideways
`ScrollView`, whose content `ImageRenderer` does not draw, so an environment value (`previewScrolls`, on by default)
lets the picture leave the scroll view out. **A table wider than the text** (decision left to the spike): drawn at its
own width, as the Preview does, when it fits; otherwise offered the text's width, so its cells wrap (SwiftUI's `Grid`
shares the width between the columns); and only a table still wider than that (columns whose words cannot wrap) is
**scaled down to fit**. Never clipped: nothing of a table is hidden from the eye that the source has.

**What was built.**

- **Core** (`NoteScanner`, `NotePreview`): `ScannedNote.blockRanges`, each top-level `NoteBlock`'s range in the
  note (UTF-16, frontmatter and `\r\n` counted: `scan(_:at:)` takes where the body starts), a component from its
  opening tag to the end of its closing one, a run of Markdown from its first written line to its last.
  `NotePreview.located` is the same blocks with each run of Markdown split into its own blocks (each `.markdown([one])`,
  located by swift-markdown's own ranges mapped back through the footnote cuts), which is what Live draws.
  `BlockRangeTests`: over the 115 notes of `mdx-notes.json` and the preview showcase, as written, with a frontmatter
  put in front and with every line ended by `\r\n`, the ranges are in order, never overlap, cover every written line
  but the footnotes' own text, and hold their block (a component scanned alone is the same element, a run parses the
  same, a table's text alone is the same table).
- **`LiveBlocks`** (app): `LiveBlockKinds` is the seam (below); `LiveBlock.blocks(of:)` makes the drawn blocks from
  the whole note's `NotePreview` in the styler's pause pass, off the main thread (and not at all when the note has no
  `|`); `LiveBlocks` keeps them on the main thread, moves them with the edits between passes, and renders the pictures
  one per turn of the run loop for the blocks within a screen of the viewport (and again as it scrolls), cached by
  the block's source and the text's width, emptied when the look or the text size changes. `LiveBlockRenderer`
  renders `PreviewBlockView` (made `internal` for it, with nothing copied) with the scheme's `Look`, its preview font,
  the Dynamic Type size of the text view and `previewScrolls` off.
- **Drawing** (`LiveOverlay.drawBlocks`, `LiveDrawing` kinds `block` and `blockAfter`): away from the selection,
  every character of the block (its last line break too) hidden, the first paragraph as tall as the picture and drawn
  with it, the other lines flat. With the selection in it (ends included, as a construct: D3) the source shows, drawn
  as the rest of the Live look draws it, with the last good picture after its last line, `block-stale` until the
  pause has rendered it anew. A block with no picture yet is a faint box of a guessed height (rows × 30 points);
  revealed, it has nothing under it rather than a box that comes and goes while typing. `MarkdownStyler` widens
  every range it draws to whole blocks, and treats a block as a construct when the selection moves.
- **A tap** on a drawn block puts the caret at the start of its source. UIKit's tap does not ask
  `closestPosition(to:)` (tried first: the caret landed at the end of the block's first line, its hidden characters),
  so `NoteTextView` notes when a touch begins (`TouchRecorder`, a recogniser that fails at once and so takes nothing
  from UIKit's own) and, when the selection that follows within 0.8 s is a caret in a block still drawn, moves it to
  the block's start (`.liveBlock` carries the block's range).
- **Accessibility**: the value stays the source; candidate B marks every hidden character "speak no punctuation", so
  the table's words are read and its pipes and dashes are not; the picture adds no element. The audit runs on a note
  with a table (`AccessibilityUITests.testTheLiveTabWithATable`).
- **`live-report`** gains `block-<kind>` (the block's source), `block-revealed`, `block-pictured`, `block-stale`,
  and `draw-block` / `draw-blockAfter` on the paragraph that draws it.

**The seam for Steps 6 and 7.** `LiveBlockKinds.kind(of:)` in `LiveBlocks.swift` says which `PreviewBlock`s are
drawn (a name for the report, or nil); `sizesToContent(_:)` says which are drawn at their own width (tables) rather
than across the text (panels, charts); `mayHold(_:)` is the cheap test that skips the second read of a note that can
hold none (today a `|`: Step 6 adds `<`). Nothing else changes per kind: hiding, revealing, the picture, its cache, a
tap and the report are the same for all. `NotePreview.located` already gives every component, `<Toc />`, a placed
`<Footnotes />` and each Markdown block with its range; the footnotes listed at the end of a note without the tag are
written nowhere and have no range (Step 7 decides where they are drawn). The frontmatter is not a located block (Step
7 adds the header).

**Simulator** (`LiveBlockUITests`, each passing; the Mac's load average was 150 to 950 from other sessions' Simulators,
so most runs lost some tests to the harness: a launch that hung, typing that never arrived, UI queries timing out): a table is drawn as one picture with every character hidden and
silenced; the caret into its last line reveals it with the picture after it, and out hides it; ↑ from the line below
to the line above visits each of its five lines, eight presses each way; undo across it (typing before, in and after
it, ⌘Z until the text is back) leaves the text as it was and the table drawn; typing in it redraws its picture after
the pause; a tap on the picture puts the caret at its start. The 16 ms budget on the showcase note (`LiveBench`,
Debug build, the Mac's load average about 80 to 300 while it ran): the styler's part of a keystroke median 0.7 ms,
p95 1.1 ms; a whole keystroke (UIKit's insert, the styler, the layout) median 3.8 ms, p95 8.7 ms, 7 of 200 over
16 ms (the worst 365 ms, the Mac's load); the pause's pass after typing settled in 304 ms. The existing `LiveUITests`
and the two Live audits on the final code: 40 of 45 in one run, and of the five it lost, three passed on a rerun;
`testTapsAlongALineWithHiddenMarksLandNextToAVisibleCharacter` passed on the final code in another run, and
`testHeadingsGrowWithTheTextSize` passed on this branch before the last change to taps (both failed at load 900 with
the typed text never reaching the note). Worth one more run of the suite on a quiet Mac before Gate LD5.

### Step 6: components (M)

- Through the block layer, everything `PreviewBlockView` draws: `<Info>`, `<Warning>`, `<Chart>`, `<YouTube>`,
  `<Repo>`, block `<Mark>`, and a component's notice. Their actions per I6.
- A note that stops being valid MDX while typed keeps its last good pictures (the pause pass draws nothing new
  until it is valid again), with no banner in Live; the Preview keeps its notice.
- **Oracle:** `component-cases.json` already checks `NotePreview`'s component decisions against the desktop; Live
  draws those same blocks, so it inherits that check. A UI test opens the preview showcase in Live and checks, from
  the report, that every `PreviewBlock` kind the Preview shows has a drawn block in Live.
- **Gate LD6 (iPad):** items 359 to 362 (the showcase note in Live beside the Preview, every scheme; a chart at the
  largest text size; the actions; typing a component, and VoiceOver).

**Status: built 2026-11-18** (branch `claude/ipad-live-step6-components`, on this plan's branch with Steps 1 to 5). Gate LD6 is the owner's.

- **Which blocks:** `LiveBlockKinds.kind(of:)` names `info`, `warning`, `chart`, `youtube`, `repo`, `mark` (a block
  `<Mark>`) and `notice`, beside Step 5's `table`; `mayHold` is now "a `|` or a `<`". `<Image>`, `<Ink>` and
  `<Drawio>` stay with the picture layer (Step 1), which already draws them at the Preview's size; `<Toc />` and the
  footnotes are Step 7's. Everything else (hiding, D3's reveal, the cache, a tap to the block's start, VoiceOver's
  silenced marks, the report) is Step 5's, unchanged. A hidden block now also drops what Steps 2 to 4 put on its lines
  (a code block's fill inside a `<Chart>`, a list's lines inside a panel, a link's attributes), so the picture is the
  only thing drawn there.
- **`<Chart>` in `ImageRenderer`:** Swift Charts draws in the picture, static (an `ImageRenderer` snapshot has no
  animation), as Step 5's spike found; checked again with a bar chart and the showcase's line and pie.
- **Actions (I6):** a tap on a drawn component edits (Step 5's tap to its start). While the selection is in a
  `<YouTube>` or `<Repo>` block, `MarkdownStyler.activeLink()` gives `LiveLinks` the block as a link (`node` = the
  block's source, `href` = `LiveBlockKinds.address(of:)`: the video's youtube.com address or the repository's, as the
  Preview's cards open), so Step 2's ↗ sits after the tag and opens it through `LinkFollower`. ⌘-tap follows only a
  link's words, not a card. A drawing is still edited in the Preview.
- **Not valid MDX:** `LiveBlock.blocks(of:)` returns nil when `NotePreview.error` is set, and the pause pass then
  leaves the blocks as they are: they keep their last good pictures, moved with the edits as between any two passes,
  and the Live tab shows no notice; the Preview keeps its own. A component typed while the note is not valid is drawn
  once it is.
- **Speed (found here):** `NotePreview.located` was quadratic in the number of blocks in a run of Markdown
  (`noteRange(ofRun:)` re-read the whole run for each block): 96 s for a 500,000-character note of 8,000 blocks in a
  Debug build. With `mayHold` now true for any note with a `<` (every `<Mark>`), that would have been every long note's
  pause pass. `ScannedNote.RunLocator` reads a run once: 0.5 s for the same note, linear (a new `BlockRangeTests`
  case keeps it so).
- **Preview probe:** with `-liveReport 1` the Preview has an element `preview-blocks` naming the kinds of block it
  draws (from its own `PreviewBlock`s), for the showcase test.

**Simulator** (`LiveComponentsUITests`, own Simulator, `-parallel-testing-enabled NO`, the Mac's load average 15 to
300): all seven pass. The showcase opened in the Preview says it draws `toc, markdown, info, warning, image, chart,
repo, youtube, notice, table, footnotes` (`preview-blocks`); in Live every one has its drawn block from its first line
(`block-<kind>` with `draw-block`), the pictures through the picture layer, and `toc` and `footnotes` are reported as
Step 7's. A note with each component (both panels, a block `<Mark>`, a bar chart, a video, a repository, a notice) has
each drawn as one picture with every character hidden. An `<Info>` panel's fill (the brand at 12% over the page) and
its bar of the brand are on screen in Dark and in Light, and not in the Markdown tab. The ↗ is beside a video's tag
with its youtube.com address while the caret is in it, goes when the caret leaves, and beside a repository's tag (the
caret put there by a tap on its picture) opens Safari. Typing ` an <Mark>open` leaves the panel drawn with its picture
for three seconds of passes, with no notice in Live, and closing the tag leaves it drawn. The 16 ms budget on the
showcase, now with its panels, charts and cards drawn (`LiveBench`, Debug): styler p95 1.6 ms, whole keystroke p95
7.9 ms, 1 of 200 over 16 ms. The existing Live tests (`LiveBlockUITests`, `LiveUITests`, `LiveLinksUITests`,
`LiveCodeUITests`, `LiveListsUITests`, `LiveDrawingsUITests`, `AccessibilityUITests`) with the new ones, 92 in one
run: 90 passed. `AccessibilityUITests.testTheListOfStoredImages` lost the restore's alert and passed alone;
`LiveDrawingsUITests.testADiagramIsDrawnAtHalfItsPixels` fails alone too, and fails the same way on the plan branch
without Step 6 (the first diagram is drawn revealed, as if the caret opened on its line): not this step's.

Found on the way, not changed here: arrowing up or down into a component's tag can stop in its name (`<Yo|uTube`),
where the `<` list (`EditorAssist`) opens and takes ↑ and ↓ until Escape. It is the typing aid's, in both tabs, and is
more likely in Live now that whole components reveal under the caret.

### Step 7: the rest (M)

- Setext headings drawn as levels 1 and 2, the underline hidden away from the caret (`LiveModel`; the desktop's
  Step 7 facts as oracle once merged).
- Footnote refs `[^1]` drawn as the Preview's superscript number (the label hidden, the digit drawn in the
  fragment); definitions and `<Footnotes />` as blocks.
- `<Toc />` as a block.
- **The frontmatter (D5):** away from the caret, the Preview's header (header image, title, date, tags) drawn as a
  block in place of the YAML; the YAML alone while the caret is in it.
- **Gate LD7 (iPad):** items 363 to 366.

**Status: built 2026-11-18** (on `main` after Step 5's merge). Gate LD7 is the owner's.

- **Setext headings** (`LiveReader.setext`): each line of the heading's text drawn at its level, the same sizes as ATX headings;
  the underline's mark is from its first `=` or `-` to its last (lezer's `HeaderMark`), shown dimmed while the selection is anywhere
  in the heading; away from it the underline's whole line is hidden and drawn with no height (`LiveDecorations.collapsedLines`, a
  `maximumLineHeight` of half a point, the desktop's `cm-live-setext-hidden`). The `---` ambiguity is swift-markdown's, which agrees
  with lezer: under a paragraph it is an underline, after a blank line a rule, and the frontmatter's fences are blanked before the read.
  cmark's range for `text\n---\nmore` runs on into `more`, so the underline is the first underline-shaped line after the heading's first.
- **Footnote citations:** `NoteScanner` now gives `footnoteCitations` (every `[^label]` with a definition, outside code, in the note
  and in footnotes' own text) with the Preview's numbers. `LiveModel` reads them from the whole note (like highlights, they pair across
  blocks: moved with the edits between full reads, made right by the next; `differences(from:)` redraws every citation whose number
  changed). Away from the selection the `[^label]` is hidden and a kern on its last character keeps room for the number; the
  paragraph's layout fragment (`LiveDrawingFragment`, now also given to a paragraph with no other drawing) draws the Preview's
  superscript digits (`NoteScanner.superscript`, `¹²`) there, in the font and colour the citation had. The text is never changed.
- **Definitions and `<Footnotes />`:** `<Toc />` and `<Footnotes />` are `LiveBlockKinds` (`toc`, `footnotes`). Definitions are
  `NotePreview.footnoteDefinitions`: each run of cited definitions with only blank lines between them is one `.footnotes` block of
  their entries (in the order written, with the Preview's numbers), drawn in place of them through Step 5's layer. **The list the
  Preview adds at the end of a note with no tag is not drawn as a block of its own**: it is written nowhere, so it would be drawn
  on no text. Since definitions are usually written at the end, the run drawn in place of them reads as that list; definitions
  written in the middle are drawn where they are (the desktop draws them in place too). A definition inside a component is that
  component's.
- **`<Toc />`:** the Preview's "Contents" box; a tap puts the caret at the tag's start (I6: its entries are reached through the
  Outline button, which already lists setext headings, as `MarkdownHighlighter` and `NoteScanner` read them).
- **The frontmatter (D5):** `LiveHeader` (a frontmatter that parses: title, date, tags, header image) is a block of kind
  `frontmatter` over the YAML, drawn as `NoteReaderHeader`, the view now shared with `NoteReader` (one renderer), with the header
  image read before rendering (`HeaderImageBanner(loaded:)`: `ImageRenderer` draws a view before its task runs). As on the desktop,
  it counts as "the caret in it" only while the text view is being edited (a note opens with the caret at 0 and shows its header);
  `MarkdownStyler.focusChanged` redraws it on focus. Revealed, only the YAML shows, in L4's smaller muted look, with no picture
  under it (`LiveBlockKinds.picturedWhileEditing`). A frontmatter that does not parse stays YAML. Its characters are hidden
  by colour in their own Dynamic Type font (`.liveConcealed`, counted as hidden by the report and by VoiceOver's silencing), not by
  the half-point font of the other blocks: Xcode's accessibility audit reads the text at the top of the note and said a half-point
  font "does not support Dynamic Type".
- **Oracle:** the fixture writer adds the desktop's `setextDecorations` (headings, shown underline, hidden underline line) and its
  footnote citations (`footnoteRefs`: drawn as a number, or shown dimmed) to `live-expected.json`; 15 hand cases in `live-cases.json`
  (group `rest`). All 390 texts agree but one, listed in `LiveConformanceTests.known`: the desktop draws a setext heading inside a
  frontmatter whose YAML does not parse (its setext code takes the body's start from `bodyStart`, its frontmatter look does not).
  The desktop's definition look (its `[^label]:` as a number) is the desktop's own and is left out.
- **Report and tests:** `live-report` gains `footnote<n>` over a citation drawn as its number and `flat` on a line with no height;
  `LiveReportReading` (UI tests) leaves the frontmatter's block out of what a test reads, since every test note has a frontmatter,
  and L4's frontmatter test now checks D5. Core: `LiveRestTests`. VoiceOver: the value stays the source (candidate B).

**Simulator** (iPad Pro 13-inch, iOS 26.4, `-parallel-testing-enabled NO`, the Mac's load 7 to 150): `LiveRestUITests` (3: everything
drawn away from the caret with the value unchanged and every hidden character silenced; the caret walking up into `<Toc />`, a
setext heading, a citation and the frontmatter, each revealed and drawn again; a tap on the Toc's picture putting the caret at its
start), `LiveBlockUITests` (Step 5's 7) and `AccessibilityUITests` (14, the five Live audits among them) all pass;
`LiveUITests` 35 of 36 (34 in the full run, and its frontmatter test on a rerun once it waited out the tap). The one that fails, `testTapsAlongALineWithHiddenMarksLandNextToAVisibleCharacter`,
fails the same way on `main` (Step 5) in the same Simulator: its first ⌘A after a tap is lost while the on-screen keyboard comes up.
On an 11-inch Simulator in landscape with the sidebar and list showing, the mode picker's Markdown segment is clipped under the
full-screen button and the six tests that tap it fail: use a 13-inch one. The 16 ms budget on the showcase note (which has footnotes,
`<Toc />` and a frontmatter): the styler's part of a keystroke p95 1.2 ms, a whole keystroke p95 6.4 ms, 2 of 200 over 16 ms.

After merging this plan's branch (Steps 1 to 5) into Step 7, every Live suite was run again on the same Simulator: `LiveRestUITests`,
`LiveBlockUITests`, `LiveCodeUITests`, `LiveDrawingsUITests`, `LiveListsUITests` and `LiveLinksUITests` all pass, `LiveUITests`
all but the taps test above (as on `main`), and `AccessibilityUITests` 14 of 14 once its largest-text Live audit leaves out one
finding: at that size the drawn header's title and date are "potentially inaccessible text" with no element. The picture adds no
element (Step 5's rule) and its words are the YAML's, read from the value; whether the header should be an element of its own is the
owner's (item 366). The plan branch alone passes that audit; Step 7 on `main` did too, so it is the two together.

### Step 8: Live by default (S)

- The setting's default becomes **Live** (D1). A choice already made stays.
- **Live first** in the picker and the compact View menu: *Live, Markdown, Preview, Split* (D6; replaces V4's order).
- A new note opens in Live when the setting is Preview (I5); *Insert in Open Note* from the Images page switches a Preview to Live, not Markdown.
- Docs: [ipad-live-view-plan.md](ipad-live-view-plan.md), the tracker and C12 in
  [ipad-app-design.md](ipad-app-design.md), [manual-tests/ipad.md](manual-tests/ipad.md), [index.md](index.md).
- **Gate LD8 (iPad, yours):** a week of writing on the iPad with Live as the default, item 367.

**Status (2026-11-18): built, Simulator only; Gate LD8 is yours.** Branch `claude/ipad-live-default-step8`, on the plan branch (Steps 0 to 7).
- **The default:** `NoteDetailView.Mode.openNotesInDefault` is `.live`. The key `openNotesIn` is written only by the
  Appearance sheet's picker (`@AppStorage` never stores a default), and `-resetOpenNotesIn` only removes it, so a setting
  never chosen follows the new default while one chosen before (Preview included) stays. No migration was needed: the
  desktop's stuck default came from saving the whole settings object, which the iPad does not do.
- **The order:** the `Mode` enum's cases are `live, markdown, preview, split`; the toolbar's segmented picker, the compact
  View menu and *Open notes in* all list `Mode.allCases`, so all three follow it.
- **A new note** (`model.takeFreshNote`) opens in Live when the setting is Preview; *Insert in Open Note* from the Images
  page switches a Preview to Live. Live and Markdown share one text view, so the picture goes in at the caret either way.
- **Checked:** see the PR for the Simulator run. UI tests added: `OpenNotesInUITests.testWithNothingChosenEveryNoteOpensInLive`,
  `…testTheSettingIsChosenInTheAppearanceSheetAndAStoredPreviewStays` (the sheet's choices in the order Live, Markdown,
  Preview, Split; Preview chosen there stays across a second launch), `…testANewNoteOpensInLiveWhenTheSettingIsPreview`,
  and `PolishUITests.testInsertInOpenNoteSwitchesAPreviewToLive`; `LiveUITests`' picker test became
  `testLiveIsTheFirstWordOfTheViewPicker`. The compact View menu's order is not tested on its own (it lists the same
  `allCases`).

**Order.** Step 0 first. Steps 1 to 4 are independent of each other. Step 5's spike comes before Steps 5 to 7.
Step 8 last (D1). The iPad can run behind the desktop step for step, so that each step's oracle exists when it
starts; Steps 0, 1, 3 and 6 need nothing from the desktop.

## Where the shared fixtures are the oracle

| Fixture | Written by | What it checks on the iPad |
|---|---|---|
| `live-cases.json` / `live-expected.json` | `apps/web/scripts/conformance-fixtures.test.ts`, from the desktop's real `liveDecorations` | Today: 16,671 selections over 344 texts. Extended per step with the desktop's new facts (links, list markers, task boxes, quote lines, code-block lines, setext, footnote refs) and its block ranges (which source spans are blocks, and whether the selection reveals them). The iPad compares **ranges and reveal**, not looks; known differences (V2 until desktop Step 3; drawing blocks as pictures) are listed in `LiveConformanceTests.known` |
| `component-cases.json`, `mdx-notes.json` | the desktop's MDX layer | What a component's props mean; unchanged, since Live reuses `NotePreview` |
| `preview-showcase/` | — | One note with every construct: the UI test that every Preview block kind has a drawn counterpart in Live, and your side-by-side look |
| `settings-cases.json` | `writing.ts` | Not used: the setting is kept on the iPad (I3), so the desktop's `writing.openNotesIn` is neither read nor written, and a restored desktop backup leaves the iPad's choice alone |

## Decisions

The owner's desktop decisions (2026-11-17) are copied; the iPad column says what touch or UIKit changes.

| # | Desktop decision | On the iPad |
|---|---|---|
| D1 | Live becomes the default at the end, once everything is drawn | Same: Step 8 |
| D2 | Cmd/Ctrl+click follows, Cmd/Ctrl+Shift+click opens beside, a plain click edits | A tap edits; following per I1, "beside" per I2 |
| D3 | A block shows its source with the drawing under it while the caret is in it, redrawn after a ~300 ms pause | Same, with the styler's existing pause; the drawing is a picture of the Preview's view |
| D4 | Clicking a task checkbox toggles it in Live; Preview stays read-only | Same, with a 44-point tap target |
| D5 | The frontmatter card away from the caret, YAML only while editing | Same; the "card" is the Preview's header (image, title, date, tags) |
| D6 | Live first | Same: *Live, Markdown, Preview, Split* (V4's order changes at Step 8) |
| D7 | Live stays mounted while hidden; an edit elsewhere clears its undo | Same; Markdown and Live already share one text view, so only Preview and Split are new |
| D8 | A separate iPad plan | This page |
| D9 | Settings › Writing › "Open notes in", Split by default until the last step, new panes only | Per I3 to I5 |

The iPad's own questions:

| # | Question | Recommended | Decided |
|---|---|---|---|
| I1 | Following a link in Live by touch | A tap edits; a **↗** beside the link under the caret follows; **⌘-tap** with a keyboard (or trackpad) follows at once | **As recommended** (2026-11-17) |
| I2 | "Opens beside" (desktop ⌘⇧-click): the iPad has no note beside a note | **No "beside" in this plan**: ⌘⇧-tap does what ⌘-tap does; a note in a second window is a follow-up | **As recommended** |
| I3 | Where the setting lives and what it changes | Appearance sheet › Writing › "Open notes in", **kept on this iPad** (not in `settings.json`, so a restored desktop backup does not bring the desktop's choice); **every note opens in it**, and changing the tab lasts until another note opens | **As recommended**: kept on this iPad, and every note opens in it |
| I4 | The default until Step 8 (desktop: Split) | **Preview**, as today (Split is cramped on a portrait iPad) | **Preview** |
| I5 | A new note (today: Markdown, keyboard up) | Opens in the setting's view when it is a writing view (Live, Markdown, Split); when it is Preview, in **Markdown until Step 8 and Live after** | **As recommended** |
| I6 | How blocks are drawn, and what a touch on one does | **Pictures of the Preview's own views** in the existing fragment layer; a tap edits; a component's action (a card's address, editing a drawing) is the same **↗** as a link's, while the caret is in it; a `<Toc />` entry is reached through the Outline button | **As recommended**; amended 2026-11-19 (Gate LD1): a **Pencil** touch on a drawn `<Ink>` opens its canvas, a finger still edits |
| I7 | Code-block colours (the iPad's Preview has none by language) | **Match the Preview**: one fill, the code font, no language colours; language colours for both tabs is a separate later item | **Match the Preview** |

## Out of scope

- `<Sheet>`: the iPad draws no Sheet in either tab yet; Live keeps its source.
- Editing a table as a grid, and drawing raw HTML.
- Pictures in the middle of a sentence and pictures from a web address (L4: they stay text).
- Language colours in code (I7), the ruler and reflow (V6), a second window for "beside" (I2).

## Risks

| Risk | Likelihood / impact | What answers it |
|---|---|---|
| A multi-line block hidden as one picture fights the caret, the selection handles or find | Medium / high | Step 5's spike before anything is built on it; a fallback that keeps the source showing |
| `ImageRenderer` draws some views wrongly (a `ScrollView`, Charts' animation, Dynamic Type) | Medium / medium | The spike renders a table, a chart and a panel; non-scrolling variants where needed |
| Pictures cost memory and time in a note with many components | Medium / medium | Cache by text, width, scheme and size; render near the visible rect only; `LiveBench` on the showcase |
| A block much taller than its source shifts the text when the caret enters it | High / low | D3: the picture stays under the source, so the shift is only the source's own height |
| The ↗ hides text or is hard to hit | Medium / low | Placed after the link's end; 44 points; your look in LD2 |
| Keeping the editor alive under the Preview costs memory or breaks Split's tests | Low / medium | Step 0's UI tests; the text view is one per note already |
| VoiceOver reads a hidden table's pipes or a component's props | Medium / medium | Candidate B silences punctuation; props' words are your item in LD5 and LD6 |
| Live and Preview drift (inline looks are Live's own attributes) | Medium / low | The showcase side by side at each gate |
