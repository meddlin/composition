# Live as the default view: drawing the rest of the note

The Live tab ([ui/live-editor.md](ui/live-editor.md)) now matches the Markdown tab feature for feature (the
[parity plan](live-editor-parity-plan.md), Gate I passed 2026-11-03). What it does not do yet is **draw** everything
Preview draws: links, lists, quotes, code blocks, tables, footnotes and most MDX components are still shown as the
Markdown source. This plan covers drawing them and then making Live the view a note opens in.
Markdown, Preview and Split stay available.

Status: **drafted 2026-11-16; every decision taken by the owner on 2026-11-17** (see
[Decided by the owner](#decided-by-the-owner-2026-11-17)). **Step 0 built 2026-11-17** (PR #321); Gate 0 is the
owner's. **Step 1 built 2026-11-17** (PR #323); Gate A passed on the editor's own work (below). **Step 2 (links)
built 2026-11-17** (PR #322); Gate B is the owner's. **Step 3 (code blocks) built 2026-11-17** (PR #324); Gate C is
the owner's. **Step 4 (lists, task lists, quotes) built 2026-11-17** (PR #325); Gate D is the owner's. **Step 5 (the block layer and tables)
built 2026-11-17** (PR #326); Gate E is the owner's. **Step 6 (MDX components) built 2026-11-17**; Gate F is the owner's.

## Goal and rule

- **Live reads like Preview.** Away from the caret, a note in Live looks like it does in Preview, close enough that
  the owner opens Preview only to read a note top to bottom, never to see what something looks like.
- **The text stays the source.** This is the rule the Live tab already follows: the document is the Markdown,
  character for character, and only how it is drawn changes. Anything drawn gives its source back while the caret
  or a selection is on it. Switching to the Markdown tab always shows exactly what was typed.
- **No regression.** Typing speed, the writing menus, find and reflow keep working as they do today. The parity
  harness (`parityHarness.tsx`) and the ~157 editor tests keep guarding them.
- **One renderer where possible.** Where Live draws an MDX component, it draws it with the component Preview uses.
  It does not get a second implementation.

## What is left

What Preview draws and Live does not, as of `ad9701a`:

| Construct | Live today | Preview | Step |
|---|---|---|---|
| Links `[text](url)`, `note:`, `pdf:`, `#heading` | Coloured; the brackets and URL show; clicking does nothing (drawn and followed since Step 2) | Text only; clicking follows the link | 2 |
| Fenced and indented code blocks | One flat "code" colour; fences show | Language highlighting (`rehype-highlight` over `lowlight`) on a block background | 3 |
| Lists | The marker is coloured | Bullets, numbers, a hanging indent | 4 |
| Task lists `- [ ]` | Text | Checkboxes | 4 |
| Blockquotes | The `>` is coloured | A bar and an indent | 4 |
| Tables (GFM) | Pipes | A table | 5 |
| `<Drawio>` | Source | The diagram, with an Edit button | 6 |
| `<Sheet>`, `<Chart>` | Source | The grid (with Edit) and the chart | 6 |
| `<Info>`, `<Warning>` | Source | Callouts | 6 |
| `<YouTube>`, `<Repo>` | Source | An embed and a card | 6 |
| `<Toc>`, `<Footnotes>`, footnote refs `[^1]` | Source | A linked table of contents; numbered notes | 7 |
| Setext headings (`Title` / `===`) | Text (only `#` headings are drawn) | A heading | 7 |
| Frontmatter | Muted monospaced YAML | `FrontmatterCard` | 7 |
| Notes over 100,000 characters | Tints, pictures, ink and colours are dropped (drawn since Step 1) | Drawn (slowly: see [stress-test findings #7](stress-test-findings.md)) | 1 |

Already drawn, and left alone: headings with `#`, bold, italic, strikethrough, inline code, rules, Markdown and
`<Image />` pictures, `<Ink>`, `<Mark>` highlights, and the syntax colours.

## Approach

### Two kinds of decoration

CodeMirror allows some decorations only from a state field. A view plugin (what `liveMarkdownPlugin` is) may not
produce block widgets or replace a line break. The check is in `@codemirror/view`: *"Block decorations may not be
specified via plugins"* and *"Decorations that replace line breaks may not be specified via plugins"*. That is also
why a `<Mark>` tag that runs over a line break is left showing today.

So the Live look becomes two layers:

1. **Inline and line decorations stay in the view plugin**, worked out for the viewport on every update as today.
   This covers links, list bullets, task checkboxes, quote bars, code-block lines and their colours, footnote refs
   and setext headings. It is cheap, and nothing in it depends on text off screen.
2. **Block widgets come from a new `StateField`** (`liveBlocks.ts`): tables, MDX component blocks, the frontmatter
   card, `<Toc>` and `<Footnotes>`. A state field sees the whole document, not the viewport, so it must be
   incremental. On a change it maps the old blocks through the change and re-reads only the top-level blocks the
   change touched, found from the syntax tree. Whether the selection touches a block is read on every selection
   change, which is cheap because it only compares ranges.

### Drawing a block with Preview's own code

A block widget's `toDOM` mounts a React root (`createRoot`, as the panel pop-outs already do over the shared
store). The root renders `<NoteMarkdown body={slice} />` for the block's source slice, inside the same providers
Preview has: `NoteLinksProvider`, `DrawioEditContext` and `SheetEditContext`. Every MDX component then draws in Live
exactly as it does in Preview, the Edit buttons included, with no per-component work. The widget's `eq()` compares
the source slice, so typing elsewhere does not re-render it. `destroy()` unmounts the root. `ignoreEvent()` returns
true, so clicks inside a sheet or a chart belong to the widget and do not move the caret.

Two components need the whole note rather than their own slice: `<Toc>` (the headings) and `<Footnotes>` (the
definitions). Their widgets are given the note's headings or footnotes as props, re-read when those change (Step 7).

### The reveal rule for blocks

Inline constructs keep today's rule: the marks show, dimmed, while the caret touches them. For a block (a table or
an MDX component), **while the caret is in it the source shows and the drawing sits under it** (D3), the way pictures
already work. The drawing is redrawn **after a pause of about 300 ms** in typing, not on every key; until then the
last drawing that rendered stays, so a half-typed tag never flashes an error. The frontmatter is the exception: while
the caret is in it only the YAML shows (D5), since the card would repeat it word for word.

Clicking a drawn block puts the caret at the start of its source, as clicking a picture does today. Components that
handle their own clicks (a sheet's grid, a YouTube player) get a small "Edit source" button instead.

### Code highlighting with Preview's colours

Preview highlights fenced code with `lowlight` (highlight.js grammars), lazy-loaded the first time a note has a
fence (`useCodeHighlighting.ts`). Live uses the same: the view plugin runs `lowlight.highlight(lang, code)` per
visible fenced block, caches the result by the block's text, and turns the `hljs-*` spans into mark decorations with
the same class names. The two tabs then colour code identically, with no new dependency and no second set of
colours. Considered and not picked: `@codemirror/language-data`, which adds CodeMirror's own parsers (a new
dependency, different colours).

## Steps

Each step lands on its own branch and PR. Each adds unit tests on `liveDecorations` / `liveBlocks` (they are pure
over an `EditorState`), lines in [manual-tests/live-editor.md](manual-tests/live-editor.md) and a section in
[ui/live-editor.md](ui/live-editor.md), and is checked in the browser pane (`preview_start web`) before its gate.

### Step 0: choose where notes open, and keep Live's history (S)

- **Settings › Writing › "Open notes in"**: Live, Markdown, Preview or Split, **Split by default** until Step 8 (D9).
  It is a writing setting (`WritingSettings.openNotesIn`), saved with the others. It picks the view of a **new** pane
  or panel only; a pane whose tab you changed keeps it when another note opens in it, and saved workspaces come back
  as they were.
- **Live stays mounted while another tab shows** (D7), hidden, so a look at Preview or Split and back keeps Live's
  undo history. An edit made in another tab (the Markdown textarea, a sheet's Edit) clears that history, since
  Live's undo steps would no longer apply to the text. Live is not mounted until it is first shown.
- **Gate 0 (the owner's):** with the setting on Live, new notes open in Live; a switch to Preview and back keeps
  Cmd+Z; an edit in the Markdown tab then a switch back leaves nothing to undo in Live.
- **Built (2026-11-17).**
  - `WritingSettings.openNotesIn` (`NOTE_VIEWS` in `writing.ts`), saved and checked like the other writing settings
    (desktop IPC validator included), chosen on Settings › Writing. The Swift core's `WritingSettings` carries it too,
    so `settings.json` round-trips on the iPad and the reflow conformance fixture (which includes the writing settings)
    still replays there; the iPad does not use it yet.
  - The workspace store holds the view and hands it to every place a note gets a new pane (`panes.ts`) or panel
    (`panelsState.ts`); `besideView` keeps today's rule that Split opens beside on Markdown. A note panel that has not
    shown a note yet takes the setting; one that has keeps its tab. A store kept across a visit to Settings takes the
    new value from `NotesApp`.
  - `LiveEditor` takes `active`; `MarkdownEditor` keeps it mounted, hidden, once a note has been shown in Live, and
    clears its history on return if the text changed meanwhile.
  - Found and fixed on the way: Live's editor was not re-made when another note opened in the same pane, so its undo
    history carried over and Cmd+Z right after the switch could write the previous note's text into the new one. It is
    now keyed by note (`MarkdownEditor.test.tsx` fails without the fix).
  - Checks: web 6,352 tests, desktop typecheck and 882 tests, Swift `ReflowConformanceTests`, lint (no new warnings);
    manual items added to [manual-tests/live-editor.md](manual-tests/live-editor.md) §6.

### Step 1: lift the 100,000-character limit (S to M)

The limit is `MAX_HIGHLIGHT_CHARS`, made for the Markdown tab's colour layer (2026-10-14). That layer re-tokenizes
the whole note on every keystroke. Live inherited the limit by reusing that scan (`scanOf`). CodeMirror itself does
not need the limit, and the iPad measured its version and dropped it (V5, 2026-11-09).

- Measure first: the keystroke time in Live at 100k, 400k and 1M characters (the stress-test notes), with the
  scan as it is and with no limit.
- If the scan is under budget at those sizes, drop the limit for Live only. The Markdown tab keeps it.
- If not, find code and frontmatter from the syntax tree (which is incremental) and run the `<Mark>`, `<Image>` and
  `<Ink>` reads only over the viewport plus the blocks around it.
- **Gate A (mine):** a 400k note with highlights at its end types under 16 ms a key in a production build, and
  draws its last highlight tinted.
- **Built (2026-11-17): the second way.** Dropping the limit alone was over budget at 1M (below), so Live now reads
  colours, highlights, `<Image>` and `<Ink>` only from 10,000 characters above the screen to 10,000 below it
  (`scanAround`, `SCAN_MARGIN`), starting in whichever code fence the syntax tree says that first line is in
  (`fenceAt`; `tokenizeMarkdown` can now start at any line). The frontmatter's end is read again only for an edit
  that could move it (`frontmatterEndAfter`). The Markdown tab keeps `MAX_HIGHLIGHT_CHARS`. A test checks that the
  read around the screen finds exactly what a read of the whole note finds, at screens every 5,000 characters through a
  note with fences of both kinds, a fenced block in a quote and in a list, and frontmatter. Docs:
  [ui/live-editor.md § Long notes](ui/live-editor.md#long-notes), [manual-tests/live-editor.md](manual-tests/live-editor.md) §8.
  Accepted: a highlight whose opening tag is more than 10,000 characters above the screen is drawn untinted until
  scrolled to.
- **Measured** (2026-11-17, production build, Apple silicon, the browser pane at 800×600). Notes: the `LINES:` notes of
  the stress generator (`--notes 100 --no-huge --line-notes 2600,10000,26000`, `mixed` profile) with three highlights
  appended, plus the 1M one tripled for 3 MB. 30 keys typed at the end of each through the editor's own input path
  (`execCommand("insertText")`), 40 ms apart. *Editor* is the keystroke up to CodeMirror having updated, drawn and
  measured (`view.measure()`); *whole key* adds the app's React update that follows (the note's state, the panes,
  the sidebar), up to the next task. Median / 95th percentile, in ms.

  | Note | As it was (limit: nothing drawn past 100k) | No limit, whole-note scan | Read around the screen (built) |
  |---|---|---|---|
  | 97,500 chars, editor | 3.4 / 4.6 | 2.8 / 3.8 | 2.6 / 4.7 |
  | 97,500 chars, whole key | 14.2 / 17.5 | 13.2 / 38.1 | 13.1 / 16.5 |
  | 397,000 chars, editor | 4.3 / 6.1 | 6.2 / **18.4** | **3.7 / 4.4** |
  | 397,000 chars, whole key | 16.8 / 22.5 | 17.6 / 33.9 | **15.6** / 17.9 |
  | 1,022,000 chars, editor | 7.5 / 9.7 | 12.3 / **32.2** | 6.1 / 7.8 |
  | 1,022,000 chars, whole key | 25.2 / 28.6 | 29.6 / 50.3 | 23.5 / 28.8 |
  | 3,066,000 chars, editor | | | 14.1 / 34.2 |
  | 1,000-char note, whole key | 10.5 / 14.3 | | |

  The whole-note scan itself (Node, same notes): 0.6 ms at 100k, 2.5 ms at 400k, 7.2 ms at 1M, and the garbage it
  makes shows as the 95th-percentile spikes above. Read around the screen, Live's own work is at or below what it was
  when these notes were drawn with nothing tinted, and the last highlight is drawn tinted at every size. **Gate A:** at
  400k the editor's work is 3.7 ms a key (4.4 at the 95th percentile), and the whole key 15.6 ms at the median. What is
  left of the whole key is not Live's: a 1,000-character note already costs 10.5 ms, the app's React update after
  every key, and it grows with the note's length (about 1 ms per 100k; not profiled: on each key the note's text is taken
  out of the editor and passed around, and `MarkdownEditor` parses its frontmatter, for example). That is stress-test territory (findings 1 and 7, out of scope here) and
  a follow-up of its own. Not measured: the 3 MB note's editor time is CodeMirror's own (no scan runs over the note),
  and notes of 1M and over are not saved (finding 1).

### Step 2: links (S)

- `Link` nodes: away from the caret, `[`, `](url "title")` are hidden and the text is drawn as a link (underline,
  the link colour), with the URL as its tooltip. A `note:` link to a gone note and a `pdf:` link to a PDF not on this
  device are struck through, as in Preview (`NoteAnchor`). Autolinks `<https://…>` and bare URLs are drawn as links.
- Following a link (D2): **Cmd/Ctrl+click follows, Cmd/Ctrl+Shift+click opens a note beside**, and a plain click
  puts the caret in the link. Holding Cmd/Ctrl over a link shows the pointer cursor. The handlers are `NoteAnchor`'s
  (open the note; open the PDF page; scroll to `#id` in Live's own document), lifted out of the React component so
  both can call them. Preview keeps a plain click to follow and Cmd/Ctrl+click for beside, and **also takes
  Cmd/Ctrl+Shift+click for beside**, so the Live habit works there too.
- **Gate B (the owner's):** links read and follow as in Preview; editing a link's text and its URL still works
  from the keyboard and the mouse.
- **Built (2026-11-17)**, on its own branch from Step 0's (PR #321).
  - `liveLinks.ts` draws `Link`, `Autolink` and bare `URL` nodes (`drawLink`, called from `liveDecorations`), reference
    links included when the note defines the label. The tooltip is the address, the title above it, and how to follow.
    A hidden stretch that would run over a line break (a link's text or title wrapped onto two lines) is dimmed instead,
    as a plugin may not hide a line break. Which notes and PDFs exist reaches the editor as a facet (`noteLinksFacet`,
    from `LiveEditor`'s `links`), and a change to it redraws.
  - Following: `followLink` and its helpers moved out of `NoteAnchor` into `noteLinkActions.ts`; `NoteAnchor` and Live
    both call them. Live passes its own `scrollTo` (`fragmentOffset`: the heading the preview gives that slug, or a
    footnote) and opens web addresses (`http:`, `https:`, `mailto:` only) in a new tab. Cmd/Ctrl is the platform's: Cmd
    on a Mac, where Ctrl+click is the context menu; Ctrl elsewhere. Preview still takes either.
  - Checks: `liveLinks.test.ts` (decorations), `noteLinkActions.test.ts`, Live and Preview following in
    `NoteLinks.app.test.tsx`; [ui/live-editor.md](ui/live-editor.md#following-a-link) and §1a of the manual test.
  - Not done: a link's definition line (`[label]: url`) still shows as written (Preview hides it), and a plain click
    on a link in Live is checked by hand only (jsdom can't place a caret from a click).

### Step 3: code blocks (M)

- Every line of a `FencedCode` or `CodeBlock` gets a line decoration for the block background in the code font,
  with rounded corners on the first and last line.
- The fences (```` ```lang ```` and ```` ``` ````) are hidden while the caret is outside the block. The iPad decided
  the same rule (its V2). Inside the block both fences show. Hiding a whole fence line from a plugin would replace
  a line break, so the fence lines are collapsed to zero height with a line class instead (to be checked in the
  spike at the start of the step; if CodeMirror fights it, the fence lines move to the state field).
- Language colours via `lowlight`, as under [Approach](#code-highlighting-with-previews-colours).
- **Gate C (the owner's):** a note with JS, Python, shell and an untagged fence looks the same as in Preview, and
  typing in a code block stays smooth.
- **Built (2026-11-17).**
  - In its own module, `liveCode.ts` (a view plugin and its theme), added to `liveMarkdown`'s extension; the only
    change to `liveMarkdown.ts` is that line and its import. `globals.css` gives `.cm-live-codeblock .hljs-*` the
    colours of `.prose pre code .hljs-*`.
  - **The spike went the line-class way, no state field.** A fence line away from the caret is drawn with
    `height: 0; overflow: hidden`. CodeMirror measures it as a line of no height and does not fight it: a click
    can't land on it, arrowing down (or up) into a block steps over it onto the code, after which the fences show
    and the arrows reach them; the height map stays right.
  - Colours from `lowlight` (every language, `detect` off, as Preview), cached by language and text (256 blocks),
    lazy-loaded the first time a tagged block shows. A unit test renders the same note through Preview's
    `rehype-highlight` and checks Live's classes character by character for JS, Python, shell and an untagged
    fence. The font, size, line height, padding, radius and background match Preview's computed `pre` style.
  - Measured in a dev build: ~2 ms a key in plain text, 7.6 ms median (10.9 ms p90) inside a 600-line JS block.
  - Also drawn: indented blocks (their four-space indent hidden away from the caret). Left as they are: long lines
    wrap (Preview scrolls them), and a block in a quote or list item gets its background behind the `>` or indent
    as well (Step 4 draws those).
  - Docs: [ui/live-editor.md](ui/live-editor.md#code-blocks), [manual-tests/live-editor.md](manual-tests/live-editor.md) §1.

### Step 4: lists, task lists, quotes (M)

- Bullet lists: away from the caret line, the `-`/`*`/`+` is drawn as a bullet, nested levels as Preview draws
  them. Ordered lists keep their numbers as written. Wrapped lines hang under the item's text (line decorations
  set the indent per depth).
- Task lists: `[ ]` and `[x]` are drawn as checkboxes. Clicking one toggles the `x` in the source, as one undo step
  (D4). Preview's checkboxes stay read-only.
- Blockquotes: a bar down the quote's lines and an indent; the `> ` is hidden away from the caret line.
- The Markdown keymap's Enter (which continues a list or quote) is already in place and is checked again here.
- **Gate D (the owner's).**
- **Built (2026-11-17).**
  - `liveLists.ts`, imported by `liveMarkdown.ts` (which only adds its decorations and theme): one line decoration
    per line of a list or quote, carrying its indent (2em a list level, `0.25rem + 1.25em` a quote level, as `prose`)
    and its quote bars (a background per level), with `text-indent: -2em` on an item's first line so wrapped rows hang.
    Away from the caret's line, the marks and indentation before the text become a bullet or the number as written, a
    task's `[ ] ` a checkbox, and a quote's `> ` nothing visible.
  - The checkbox toggles on `mousedown` (with `preventDefault`, so the caret and focus stay) through
    `toggleTask`, which carries `isolateHistory.of("full")` so the toggle is its own undo step.
  - Accessibility: the bullet, the checkbox and a hidden `>` keep their source as visually hidden text; the checkbox
    is `role="checkbox"` with `aria-checked`.
  - Ordered lists show their numbers as written, which differs from Preview (HTML renumbers from the first). Preview's
    curly quotation marks around a quote are not drawn.
  - Enter: CodeMirror's rule for an empty **second** item of a tight list (it makes the list loose rather than ending
    it) is kept, tested and documented.
  - Checks: `liveLists.test.tsx` (25 tests: the decorations over an `EditorState`, a click as one undo step, Enter),
    the browser pane on a scratch database; manual items in
    [manual-tests/live-editor.md](manual-tests/live-editor.md) §1b.

### Step 5: the block-widget layer, and tables (M to L)

- `liveBlocks.ts`: the state field, incremental as described under [Approach](#two-kinds-of-decoration), the
  reveal rule from D3, click-to-edit, and a React root per widget.
- Tables: a `Table` node becomes a widget that draws the table (Preview's markup, so the same `prose` styles), with
  the source shown while the caret is in it.
- Accessibility: a widget is a real `<table>` (or the component's own markup) with the cell text readable, and the
  editor's screen-reader text still reads the source.
- **Gate E (the owner's):** tables read like Preview; arrowing into and out of a table, undo across one and find
  inside one all work.
- **Built (2026-11-17).**
  - `liveBlocks.ts`: `liveBlocksField`, incremental as designed. A change maps the blocks through it and reads again
    the top-level nodes it touched in the tree before the change (mapped) and after it, so a code fence opened above
    tables swallows them and closing it brings them back. Where the parser has not reached yet, the stretch is kept as
    `dirty` and read when the tree gets there; the last top-level node of a partial tree is not trusted (it may be cut
    short). The frontmatter's end is read from its lines (`frontmatterEndOf`); nothing before it is a block.
  - `liveBlockWidget.tsx`: `BlockWidget`, a React root per block rendering `NoteMarkdown` inside `NoteLinksProvider`,
    `DrawioEditContext` and `SheetEditContext`, fed by a `LiveBlockHost` the editor updates (it is built once). A
    sheet's Edit offset is moved from the block to the note's body, ready for Step 6. `eq` compares the source;
    `updateDOM` re-renders the same root for a new source; `destroy` unmounts it (in a microtask, since the editor can
    be updating from inside a React effect).
  - Reveal rule (D3) as designed, with `redrawBlocks` sent by a view plugin 300 ms after the last change. One addition:
    a table that **stops being one** while it is typed (a header cell typed ahead of the delimiter row) keeps its
    drawing until the pause or until the caret leaves, then goes if it is still not a table, so the drawing under it
    does not blink out on every such key.
  - Clicks: a drawn table puts the caret at its start; `BlockKind.ownsClicks` gives a block an "Edit source" button
    (mouse and keyboard) instead. Both are tested; Step 6 adds its kinds to the `liveBlockKinds` facet.
  - **Found in CodeMirror:** Up and Down jump over a block widget in one go, as if it were a line, so the caret never
    entered a table from above or below. A small high-precedence keymap (`blockArrows`) turns a vertical move that
    would cross a drawn block into one onto its first line (down) or last (up), at the caret's column; Shift extends.
    The design is unchanged; this is what makes "arrowing into a table" work.
  - Find: `revealBlocks` (sent with find's highlights) shows the source of the table holding the current match.
  - Accessibility: a drawn table is a real `<table>` in the editor's content; while the caret is in a block, the
    drawing under the source is `aria-hidden`, so a screen reader reads the source once.
  - Not drawn: tables inside a list item or a quote (they are not top-level nodes); left as written.
  - **Measured** (production build on this Mac, a 22 KB note with 50 tables of 8 rows, 100-note scratch database):
    a keystroke costs 2.2-2.8 ms median in the editor (insert + measure) and 11.2-11.8 ms for the whole key (React
    included, the app's known ~10.5 ms baseline), typing above, between or inside the tables. The same note with the
    tables broken into plain text: 2.3-2.8 ms and 11.2-12.0 ms, so no difference within noise. The caret entering a
    table costs 5 ms, leaving it 3 ms (editor update; the React drawing follows in the next frame); the drawing under
    the source catches up 306 ms after the last key. The state field alone, over 2,000 keystrokes in node: 0 µs a key
    typing in a paragraph and 60 µs typing in a cell at 50 tables; 77 and 193 µs at 500 tables. Only the blocks in
    view are drawn (CodeMirror lays out what is near the viewport), so 50 tables mean 2 or 3 React roots on screen.
  - Checks: `liveBlocks.test.ts` (state field: finding, incremental re-reads, mapping, partial parses, the reveal
    rule, the debounce, orphans, find) and `liveBlocks.view.test.tsx` (the DOM: a real table, clicks, Edit source,
    the pause in a real view, undo, one root kept while typing elsewhere, LiveEditor's providers and find). Checked in
    the browser pane, dev and production builds.

### Step 6: MDX components (M)

- Through the block layer, `<NoteMarkdown body={slice} />` draws every allowlisted component: `<Drawio>` (with its
  Edit button), `<Sheet>` (with Edit), `<Chart>`, `<Info>`, `<Warning>`, `<YouTube>` and `<Repo>`.
- A block that is not valid MDX while it is being typed shows its source and a small "not rendered yet" note (the
  same failure `MdxBoundary` handles in Preview), not an error banner.
- Lazy imports (the sheet engine, highlight.js) load on the first such block, as in Preview.
- **Gate F (the owner's):** the [mdx-components](ui/mdx-components.md) sample note looks like it does in Preview,
  with the Edit buttons working from Live.
- **Built (2026-11-17).**
  - In its own module, `liveMdx.ts`: one block kind per component, added to `liveBlockKinds` beside `TABLE`
    (`liveMdxBlocks`, one line in `LiveEditor.tsx`). The syntax tree is left alone: a component starts at a top-level
    HTML block or paragraph that opens with its tag, and runs to the top-level node holding its matching closing tag
    (tags of the same name nested, tags in code skipped), so the blank lines and Markdown inside it are part of it,
    and while the caret is in it its Markdown is drawn by Live as anywhere else.
  - Three hooks on `BlockKind` let the block layer handle that without knowing about MDX: `reach` (where a block that
    runs over several nodes ends), `startAbove` (a closing tag typed below an opening one, so the layer reads again
    from the opening one) and `problem` (the source isn't valid MDX yet). `liveBlocks.ts` now tries every kind on a
    node, widens a re-read to the blocks it touches, and draws a block with a `problem` as its source with a note
    under it. One fix found on the way: a change at the very end of a fully parsed note was never read again.
  - Not valid yet: the block's source is checked with Preview's own remark plugins (`mdxRemarkPlugins`, now exported
    from `NoteMarkdown.tsx`), cached by source. A failing one shows its source and a small grey "Not rendered yet:
    reason" line, never `MdxBoundary`'s banner. An opening tag with no closing tag yet is a block of that line alone,
    so it gets the note too.
  - Clicks: `<Sheet>` and `<YouTube>` own their clicks and get the Edit source button (top left, clear of the
    sheet's own tools); a click on a button in any drawing (a diagram's Edit) is the button's. The sheet's Edit and
    Re-import get the block's offset in the note's body (Step 5's mapping).
  - Lazy loading: a block's drawing takes the highlighter through `useCodeHighlighting`, as Preview does, so a code
    fence in a component is coloured and the chunk is fetched the first time one is drawn. The sheet engine is part
    of Preview's bundle already (only the Excel reader and writer are lazy, and stay so).
  - Found in the browser: the editor's `white-space: break-spaces` reached the drawings, so the line breaks between a
    list's items drew as blank lines. The block body now sets `white-space: normal` (code keeps its own).
  - Checks: `liveMdx.test.ts` (finding, nesting, code, multi-line tags, typing a closing tag below, the not-valid-yet
    state, the pause, tags) and `liveMdx.view.test.tsx` (Preview's markup, the code coloured, click to edit, Edit
    source, Edit diagram and Edit sheet with the right offset, the note instead of a banner). Checked in the browser
    pane on a scratch database with the sample note. Manual items: [manual-tests/live-editor.md](manual-tests/live-editor.md) §4c.

### Step 7: the rest (S to M)

- Setext headings: `SetextHeading1/2` drawn as level 1 and 2, with the underline hidden away from the caret.
- Footnotes: `[^1]` drawn as a superscript number linked to its definition; definitions drawn with their number;
  `<Footnotes />` lists them as Preview does. (Lezer's GFM has no footnote node, so these come from a small scan
  over the viewport and the definitions' index.)
- `<Toc />`: drawn from the note's headings (`noteHeadings.ts`, which the heading rail already uses); a click
  scrolls Live to the heading.
- The frontmatter: drawn as `FrontmatterCard` away from the caret, and only its YAML while the caret is in it (D5).
- **Gate G (the owner's).**

### Step 8: make Live the default (S)

- The "Open notes in" setting (Step 0) defaults to **Live** instead of Split (D1). Anyone who chose a view keeps it.
- The tab order puts Live first (`TABS` in `EditorTabs.tsx`), so Ctrl/Cmd+\ cycles from it (D6).
- The iPad is not in this plan (D8): it gets its own plan, which copies these decisions.
- Docs: [ui/live-editor.md](ui/live-editor.md), [ui/panels.md](ui/panels.md), [ui/web-side-by-side.md](ui/web-side-by-side.md),
  [feature-matrix.md](feature-matrix.md), [index.md](index.md).
- **Gate H (the owner's):** a week of writing with Live as the default, desktop app.

Step 0 comes first. Steps 1 to 4 are independent of each other and of Step 5. Steps 6 and 7 need Step 5's block
layer. Step 8 comes last (D1).

## Decided by the owner (2026-11-17)

| # | Question | Decision |
|---|---|---|
| D1 | When does Live become the default? | **At the end** (Step 8), once everything is drawn. Until then the owner can choose Live for themself with the Step 0 setting. |
| D2 | Following a link in Live | **Cmd/Ctrl+click follows, Cmd/Ctrl+Shift+click opens beside, a plain click edits.** Preview also accepts Cmd/Ctrl+Shift+click for beside; its plain click and Cmd/Ctrl+click are unchanged. |
| D3 | A block while the caret is in it | **Its source, with the drawing under it**, redrawn after a ~300 ms pause in typing (the last good drawing stays meanwhile). |
| D4 | Clicking a task checkbox | **In Live it toggles `[ ]`/`[x]` in the source.** Preview's stay read-only. |
| D5 | Frontmatter | **The card away from the caret; only the YAML while the caret is in it.** |
| D6 | Tab order | **Live first** (from Step 8). |
| D7 | Undo across a tab switch | **Live stays mounted while hidden**, so its history survives a look at another tab; an edit made in another tab clears it (Step 0). One shared history across tabs is not planned. |
| D8 | The iPad | **A separate iPad plan**, started now, that copies these decisions and adapts only what touch needs (following a link: a tap on a ↗ beside the link under the caret, and Cmd+tap with a keyboard, as a starting pick). |
| D9 | A setting for the view notes open in | **Settings › Writing › "Open notes in"** (Live, Markdown, Preview, Split), built in Step 0 with Split as its default, which Step 8 changes to Live. It sets the view of **new** panes and panels only. |

## Out of scope

- Editing a table as a grid in Live (it is edited as Markdown, or through `<Sheet>`).
- Drawing raw HTML that is not an allowlisted component.
- The iPad's and the native apps' Live views (see D8). The Linux and Windows designs already list Live as their
  hardest feature.
- The other stress-test findings (the sidebar re-render, the 1 MB save failure). Live as the default does sidestep
  finding #7, Preview and Split re-rendering the whole note on every keystroke.

## Risks

- **Block widgets and the caret.** Arrowing into, out of and across a block widget, and selecting through one, are
  where CodeMirror's block decorations behave least like text. The Step 5 gate checks it by hand. The reveal rule
  means the caret only ever sits in source.
- **React roots per widget.** Many components in one note means many roots. They are cheap but not free. Mount them
  only for blocks near the viewport (CodeMirror only draws widgets it lays out) and measure on the
  mdx-components sample.
- **Scroll jumps.** A block whose drawn height differs a lot from its source height (a chart from three lines)
  shifts the text below it when the caret enters it. D3 (b) makes this smaller than (a) would, because the drawing
  stays. `estimatedHeight` on widgets keeps CodeMirror's height map close.
- **Highlighting cost.** `lowlight` over a large code block on every keystroke inside it. Cache per block text and
  highlight only visible blocks; measure in Step 3.
- **Two renderers drifting.** Inline constructs (links, lists, quotes) are drawn by Live's own CSS, not Preview's
  `prose`. A side-by-side check in Split against Live is part of each gate.
