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
[Decisions](#decisions)). Nothing is built.

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

### Step 6: components (M)

- Through the block layer, everything `PreviewBlockView` draws: `<Info>`, `<Warning>`, `<Chart>`, `<YouTube>`,
  `<Repo>`, block `<Mark>`, and a component's notice. Their actions per I6.
- A note that stops being valid MDX while typed keeps its last good pictures (the pause pass draws nothing new
  until it is valid again), with no banner in Live; the Preview keeps its notice.
- **Oracle:** `component-cases.json` already checks `NotePreview`'s component decisions against the desktop; Live
  draws those same blocks, so it inherits that check. A UI test opens the preview showcase in Live and checks, from
  the report, that every `PreviewBlock` kind the Preview shows has a drawn block in Live.
- **Gate LD6 (iPad):** items 359 to 362 (the showcase note in Live beside the Preview, every scheme; a chart at the
  largest text size; the actions).

### Step 7: the rest (M)

- Setext headings drawn as levels 1 and 2, the underline hidden away from the caret (`LiveModel`; the desktop's
  Step 7 facts as oracle once merged).
- Footnote refs `[^1]` drawn as the Preview's superscript number (the label hidden, the digit drawn in the
  fragment); definitions and `<Footnotes />` as blocks.
- `<Toc />` as a block.
- **The frontmatter (D5):** away from the caret, the Preview's header (header image, title, date, tags) drawn as a
  block in place of the YAML; the YAML alone while the caret is in it.
- **Gate LD7 (iPad):** items 363 to 366.

### Step 8: Live by default (S)

- The setting's default becomes **Live** (D1). A choice already made stays.
- **Live first** in the picker and the compact View menu: *Live, Markdown, Preview, Split* (D6; replaces V4's order).
- A new note opens in Live when the setting is Preview (I5); *Insert in Open Note* from the Images page switches a Preview to Live, not Markdown.
- Docs: [ipad-live-view-plan.md](ipad-live-view-plan.md), the tracker and C12 in
  [ipad-app-design.md](ipad-app-design.md), [manual-tests/ipad.md](manual-tests/ipad.md), [index.md](index.md).
- **Gate LD8 (iPad, yours):** a week of writing on the iPad with Live as the default, item 367.

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
| I6 | How blocks are drawn, and what a touch on one does | **Pictures of the Preview's own views** in the existing fragment layer; a tap edits; a component's action (a card's address, editing a drawing) is the same **↗** as a link's, while the caret is in it; a `<Toc />` entry is reached through the Outline button | **As recommended** |
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
