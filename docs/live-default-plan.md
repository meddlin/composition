# Live as the default view: drawing the rest of the note

The Live tab ([ui/live-editor.md](ui/live-editor.md)) now matches the Markdown tab feature for feature (the
[parity plan](live-editor-parity-plan.md), Gate I passed 2026-11-03). What it does not do yet is **draw** everything
Preview draws: links, lists, quotes, code blocks, tables, footnotes and most MDX components are still shown as the
Markdown source. This plan covers drawing them and then making Live the view a note opens in.
Markdown, Preview and Split stay available.

Status: **drafted 2026-11-16; every decision taken by the owner on 2026-11-17** (see
[Decided by the owner](#decided-by-the-owner-2026-11-17)). **Step 0 built 2026-11-17** (uncommitted); Gate 0 is the
owner's.

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
| Links `[text](url)`, `note:`, `pdf:`, `#heading` | Coloured; the brackets and URL show; clicking does nothing | Text only; clicking follows the link | 2 |
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
| Notes over 100,000 characters | Tints, pictures, ink and colours are dropped | Drawn (slowly: see [stress-test findings #7](stress-test-findings.md)) | 1 |

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
    [manual-tests/live-editor.md](manual-tests/live-editor.md) §1a.

### Step 5: the block-widget layer, and tables (M to L)

- `liveBlocks.ts`: the state field, incremental as described under [Approach](#two-kinds-of-decoration), the
  reveal rule from D3, click-to-edit, and a React root per widget.
- Tables: a `Table` node becomes a widget that draws the table (Preview's markup, so the same `prose` styles), with
  the source shown while the caret is in it.
- Accessibility: a widget is a real `<table>` (or the component's own markup) with the cell text readable, and the
  editor's screen-reader text still reads the source.
- **Gate E (the owner's):** tables read like Preview; arrowing into and out of a table, undo across one and find
  inside one all work.

### Step 6: MDX components (M)

- Through the block layer, `<NoteMarkdown body={slice} />` draws every allowlisted component: `<Drawio>` (with its
  Edit button), `<Sheet>` (with Edit), `<Chart>`, `<Info>`, `<Warning>`, `<YouTube>` and `<Repo>`.
- A block that is not valid MDX while it is being typed shows its source and a small "not rendered yet" note (the
  same failure `MdxBoundary` handles in Preview), not an error banner.
- Lazy imports (the sheet engine, highlight.js) load on the first such block, as in Preview.
- **Gate F (the owner's):** the [mdx-components](ui/mdx-components.md) sample note looks like it does in Preview,
  with the Edit buttons working from Live.

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
