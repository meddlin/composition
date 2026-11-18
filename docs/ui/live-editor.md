# The Live tab

Source: [`LiveEditor.tsx`](../../apps/web/src/components/notes/LiveEditor.tsx),
[`liveMarkdown.ts`](../../apps/web/src/components/notes/liveMarkdown.ts),
[`liveCode.ts`](../../apps/web/src/components/notes/liveCode.ts),
[`liveLists.ts`](../../apps/web/src/components/notes/liveLists.ts),
[`liveImages.ts`](../../apps/web/src/components/notes/liveImages.ts),
[`liveBlocks.ts`](../../apps/web/src/components/notes/liveBlocks.ts),
[`liveBlockWidget.tsx`](../../apps/web/src/components/notes/liveBlockWidget.tsx),
[`liveSurface.ts`](../../apps/web/src/components/notes/liveSurface.ts),
[`liveReflow.ts`](../../apps/web/src/components/notes/liveReflow.ts),
[`editorSurface.ts`](../../apps/web/src/components/notes/editorSurface.ts),
[`useEditorFeatures.ts`](../../apps/web/src/components/notes/useEditorFeatures.ts).
Plan and decisions: [live-editor-parity-plan.md](../live-editor-parity-plan.md). Checking it by hand:
[manual-tests/live-editor.md](../manual-tests/live-editor.md).

A fourth tab beside **Markdown**, **Preview** and **Split**: the editor and the preview in one place. It is
the same Markdown source, character for character (switch to the Markdown tab and it is what you typed), drawn as
it will read, with the syntax showing only where the caret is. The other three tabs are unchanged.

## What it does

- **Bold, italic, strikethrough and inline code** are drawn styled with their marks (`**`, `*`, `~~`, `` ` ``)
  hidden. While the caret is in one, or right at either end of it, the marks come back, dimmed. Type `**some text**`
  and the marks stay while you are at the end of it; type a space and start the next word, and "some text" turns
  bold. A mark with no partner yet (`**some text`) is left alone.
- **Headings** are drawn large with their `# ` hidden, and the `#` comes back while the caret is on the heading's line.
- **Highlights** (`<Mark color="…">`, from the [highlight menu](text-highlighting.md)) are drawn tinted with their
  tags hidden, and the tags come back while the caret or a selection is anywhere from the opening tag to the closing
  one. A tag with no partner, one in code or in frontmatter, and one that runs over a line break are left showing.
- **Horizontal rules** (`---`, `***`, `___` on a line of their own) are drawn as a line across the page with the marks hidden, and the marks come back while the caret is on the line.
- **Images** (`![alt](src)` and `<Image src="…" />`) are drawn as the picture, in place of the text that writes them,
  at the `width` an `<Image>` asks for and never wider than the note. A pasted image becomes one as soon as it has
  uploaded. While the caret is on the text it stays, and the picture is drawn after it; a picture that can't be
  loaded shows "Image not found: alt" in place of the text (beside the text, while the caret is on it, it is left out).
  Click a picture to edit its Markdown. `![alt][ref]` references, and images in code or frontmatter, are left as written.
- **Drawings** (`<Ink src="…" />`, from the iPad) are drawn the same way: in place of the tag, from the strokes the stored PNG carries, in the colour scheme in force
  (see [`<Ink>`](mdx-components.md#ink)). A PNG with no readable strokes is drawn as the picture. `<Drawio>` is still left as written.
- **Links** (`[text](url "title")`) are drawn as their text, underlined in the link colour, with `[` and
  `](url "title")` hidden; hover one to see its address (and title) as a tooltip. While the caret or a selection is
  in a link its source shows, the brackets dimmed, so its text and its address are edited like any Markdown.
  Reference links (`[text][label]`, `[label]`) are drawn the same way when the note defines the label. Autolinks
  (`<https://…>`, the brackets hidden) and bare addresses (`https://…`, `www.…`) are drawn as links too. A
  `note:` link to a note that no longer exists, and a `pdf:` link to a PDF that is not on this device (every PDF
  link, in the web app), are struck through and muted, as in Preview, and go nowhere. See
  [Following a link](#following-a-link).
- **Lists, task lists and quotes**: see [below](#lists-task-lists-and-quotes).
- **Code blocks** (fenced and indented) are drawn as Preview draws them: on the block background, in the code
  font, with rounded corners, and coloured by language with Preview's highlighter (`lowlight`) and Preview's colours.
  See [Code blocks](#code-blocks).
- **Tables** (GFM) are drawn as Preview draws them: the same markup and `prose` styles, column alignment included.
  See [Blocks](#blocks) below.
- **Frontmatter** is set apart in a small monospaced face and is not read as Markdown (its closing `---` is not a heading).
- **Notes of any length** are drawn this way, with no limit on their size (see [Long notes](#long-notes)).
- Everything else (MDX tags, and tables inside a list or a quote) is shown as the Markdown you wrote, coloured
  as the Markdown tab colours it ([markdown-editor-highlighting.md](markdown-editor-highlighting.md)).

### Lists, task lists and quotes

Built in Step 4 of the [live-default plan](../live-default-plan.md#step-4-lists-task-lists-quotes-m)
([`liveLists.ts`](../../apps/web/src/components/notes/liveLists.ts)). Each is a line or inline decoration, worked out
for what is on screen, and the reveal rule is per line: on the line the caret (or a selection) is on, the marks are
shown as written; the line keeps its indent, so only its text shifts a little while the marks show.

- **Bullet lists**: the `-`, `*` or `+` and the indentation before it are drawn as a bullet, the same disc at every
  level as in Preview. Each level is indented 2em, as Preview's `prose` indents it, and a long item's wrapped rows hang
  under its text, not under the bullet. A continued line of an item (a second paragraph, or a line you broke by hand)
  is indented to the item's text, with its source indentation hidden up to that column and no further, so an
  indented code block inside an item keeps its own.
- **Ordered lists** keep their numbers **as written**: `1.`, `3.`, `7)` show as `1.`, `3.`, `7)`. Preview renumbers
  (`1. 2. 7.` reads 1, 2, 3 there), because HTML only keeps the first number.
- **Task lists** (`- [ ]`, `- [x]`, `- [X]`): the box is drawn as a checkbox after the item's bullet, as in Preview.
  **Clicking it toggles the `x` in the source** (decision D4): one undo step of its own (never joined to typing just
  before it), the caret stays where it was, the editor keeps or lacks focus as before, and no menu opens. A read-only
  note ignores the click. Preview's checkboxes stay read-only. From the keyboard, put the caret on the line and type
  the `x`.
- **Quotes**: each line of a quote, a lazy continuation line included, gets a bar down its left side and an indent;
  a nested quote gets a bar per level. The `> ` is hidden away from the caret's line. Quotes are italic, as in Preview;
  Preview's curly quotation marks around the quote are not drawn. A quote inside a list item sits at the item's text,
  and a list inside a quote sits after the bar.
- **Enter** is the Markdown keymap's (`insertNewlineContinueMarkup`), unchanged: it continues a bullet, a number (the
  next one), a task (with an empty box), a nested item at its own level and a quote. On an empty item it ends the list
  (or steps a nested item out a level). One CodeMirror rule to know: Enter on an empty **second** item of a tight list
  puts a blank line above it, making the list loose, and only a second Enter ends it.
- **Screen readers**: the bullet, the checkbox and a hidden `>` keep their source in visually hidden text, so the
  line still reads as written. A checkbox is a `role="checkbox"` with `aria-checked`, named by its source (`[ ]` or
  `[x]`). The editor's hidden indentation is not read.

"Touches" means the selection reaches the construct, ends included, so a selection that spans several constructs
shows all their marks.

## Following a link

The Live tab is for writing, so a click in a link is a click in text (decision D2 of the
[plan](../live-default-plan.md#decided-by-the-owner-2026-11-17)):

| Do | What happens |
|---|---|
| Click | The caret goes into the link, which shows its source, to edit |
| Cmd+click (Mac), Ctrl+click (elsewhere) | Follows it: opens the note in this pane, shows the PDF's page, scrolls to the `#heading`, or opens a web address in a new tab (the desktop app hands it to your browser) |
| Cmd/Ctrl+Shift+click | Opens a linked note beside this one |

While Cmd/Ctrl is held the pointer turns to a hand over a link. A `#heading` link scrolls Live to the heading the
preview would give that id (`#next-steps` for `## Next Steps`, `#next-steps-1` for a second one); `#fn-1` and
`#fnref-1` go to a footnote's definition and its reference. Only `http:`, `https:` and `mailto:` addresses are
opened. Following is the same code as Preview's (`followLink` in `noteLinkActions.ts`), so a dead link is dead in
both. Preview keeps a plain click to follow and Cmd/Ctrl+click to open a note beside, and takes Cmd/Ctrl+Shift+click
for beside as well, so the Live habit works there too. On a Mac, Ctrl+click in Live is left as the context menu.

## Code blocks

Source: [`liveCode.ts`](../../apps/web/src/components/notes/liveCode.ts). Plan: Step 3 of
[live-default-plan.md](../live-default-plan.md).

- **The block.** Every line of a fenced (```` ``` ````, `~~~`) or indented block gets a line decoration that draws
  Preview's `pre`: the `--surface` background, the code font at 0.875em, its padding, and rounded corners on the
  first and last line that show. The font, size, line height, padding and radius match Preview's computed style.
- **The fences.** While the caret is outside the block, the ```` ```lang ```` and ```` ``` ```` lines are collapsed to
  no height (a line class, `cm-live-codeblock-hidden`); their text stays in the document. While the caret or a
  selection is anywhere in the block, fences included, both show, dimmed, and the corners move onto them. The iPad
  decided the same rule (its V2). Arrowing down into a block steps over the hidden opening fence onto the first line
  of code, and the fences then show; arrowing up into one lands on its last line of code the same way. An empty
  block, and the opening fence of one that is never closed, keep their fences showing.
- **An indented block's** four-space indent is hidden the same way, and shows while the caret is in the block.
- **Colours.** For each fenced block on screen, the code (without the fences, a quote's `>` or a list item's
  indent) goes through `lowlight.highlight(lang, code)`, and the `hljs-*` spans become mark decorations with the
  same class names. `globals.css` gives `.cm-live-codeblock .hljs-*` the rules `.prose pre code .hljs-*` has, so
  the two tabs colour code alike (a unit test compares them character by character). The language is the info
  string's first word, as remark reads it. An untagged fence, an indented block and a language highlight.js does
  not know stay plain, as in Preview. Results are kept by language and text (the last 256 blocks), so moving the
  caret or scrolling highlights nothing again; typing in a block highlights that block once per keystroke.
- **Loading.** `lowlight` with every language is a large chunk, fetched the first time a block with a language
  shows (the chunk Preview loads too). Until it arrives the block is drawn uncoloured.
- **Typing cost** (dev build, 2026-11-17): about 2 ms a key in plain text and 7.6 ms (median; 10.9 ms p90) inside a
  600-line JavaScript block, nearly all of it highlighting that block. A block of a few dozen lines costs well under
  a millisecond.
- **Not like Preview:** long code lines wrap, where Preview scrolls the block sideways; a block in a quote or a list
  item puts the background behind the line's `>` or indent too.

## Blocks

A block is a part of the note drawn whole, in place of its source: for now a table (Step 5 of
[live-default-plan.md](../live-default-plan.md); MDX components, the frontmatter card, `<Toc>` and `<Footnotes>` come
in Steps 6 and 7 through the same layer).

- **Drawn by Preview's own code.** Each block is a React root that renders `NoteMarkdown` for the block's source, inside
  the providers Preview has (note links, the diagram and sheet editors), so it looks and behaves as it does in Preview.
- **The caret in a block shows its source**, with the drawing under it, as a picture's Markdown shows beside the
  picture. "In" means anywhere from the start of the block's first line to the end of its last; the line before and
  the line after are not the block. A selection that reaches into it counts too.
- **The drawing under the source is redrawn once typing pauses** (300 ms), not on every key. Until then it shows the
  block as it was, so a half-typed row never flashes. A table that stops being one while it is typed (a cell typed in
  the header row before the delimiter row has it) keeps its drawing until the pause, then lets go of it if it is still
  not a table. Leaving the block draws it as it is at once.
- **Clicking a drawn table** puts the caret at the start of its source. Cmd/Ctrl+click on a link in it is the link's
  (Preview's behaviour). A block whose drawing handles its own clicks (a sheet's grid, from Step 6) has a small
  **Edit source** button instead, shown on hover and reachable from the keyboard.
- **Up and down arrows step into a block**, onto its first line going down and its last going up, at the caret's
  column; CodeMirror on its own would jump over the drawing in one go.
- **Find** shows the source of the table holding the current match, so the match is seen and highlighted there.
- **Undo** works across a block as across any text; the block is read again from what comes back.
- **Screen readers** read a drawn table as a table, cells and all. While the caret is in a block, the drawing under
  the source is hidden from them (`aria-hidden`), so the source is what they read.
- **Not drawn:** a table inside a list item or a blockquote (it is shown as written), and anything in the frontmatter.

How it works: a `StateField` (`liveBlocksField`), since CodeMirror takes block widgets only from a field. It keeps the
blocks it found and, on a change, maps them through it and reads again only the top-level nodes of the syntax tree the
change touched, before and after it (so a code fence opened above a table swallows it, and closing it brings it back).
Where the parser has not reached yet (a long note just opened), the stretch is kept to read when it does. A widget's
`eq` compares its source, so typing elsewhere redraws nothing. `liveBlockKinds` is the list of kinds; Step 6 adds MDX
components to it.

## What it shares with the Markdown tab

The writing features go through one `EditorSurface`, so the same menus and keys work in both and a test runs the
same scenario on each:

| Feature | How |
|---|---|
| `<` MDX component, prop and value completion | typing |
| Note links | `[[`, or Ctrl/Cmd+Shift+K |
| Insert a stored image | Ctrl/Cmd+Shift+M |
| Paste an image | paste |
| Markdown image → `<Image />` | Ctrl/Cmd+Shift+X |
| Draw a diagram | Ctrl/Cmd+Shift+D, or the **Diagram** button |
| Highlight, recolour, remove | Ctrl/Cmd+Shift+H |
| Find in note | Ctrl/Cmd+F |
| Tab types a tab; Shift+Tab leaves the editor | Tab |
| Ruler and reflow | Settings → Writing |

## How it differs

- **Undo history** belongs to the Live editor. Once a note has been shown in Live, the editor is kept, hidden, while
  another tab shows, so a look at Preview or Split and back keeps it. If the text changed meanwhile (typed in the
  Markdown tab, or a sheet edited from Preview), the history starts again, since its steps no longer fit the text. A
  note opened in the same pane gets a history of its own. The Markdown tab keeps its own, in the browser.
- **Reflow's break** is part of the typed character's undo step; in the Markdown tab it is a step of its own.
- **The ruler** is drawn in the preview font, which is not monospaced, so a column is that many widths of a `0`: a
  guide. Reflow counts characters exactly, hidden marks included, because that is what the file holds.
- **Enter and pasting plain text** are done by the editor itself, not the browser.
- **Line height.** Without a notebook background the lines have the preview's roomier spacing. With the architect
  background (Settings → Styling) each line is a whole grid square tall (a level 1 or 2 heading, two), so the text
  sits on the rules as it does in the Markdown tab.
- **The note is drawn in the preview's font**, not the editor's.
- **A click in a link edits it**; Cmd/Ctrl+click follows it. In Preview a plain click follows.
- Not in the Live tab yet: diagrams and a preview of MDX components (Step 6 of the
  [live-default plan](../live-default-plan.md)). Use **Split** for those.

## Long notes

The Live tab draws a note of any length in full: tints, tags hidden, pictures, drawings and colours, at the end of a
3 MB note as at the start of a short one. The Markdown tab's colour layer still stops at 100,000 characters
(`MAX_HIGHLIGHT_CHARS`, [markdown-editor-highlighting.md](markdown-editor-highlighting.md)), because it re-reads the
whole note on every keystroke; Live used to share that limit and no longer does.

What makes that possible is that nothing Live does on a keystroke reads the whole note:

- **Colours, highlights, `<Image>` and `<Ink>` are read only around the screen** (`scanAround`): from 10,000
  characters above what is on screen to 10,000 below it (`SCAN_MARGIN`), read again as the note changes or scrolls.
  The reading goes a line at a time and needs to know only whether a line is in a code fence, which the read takes
  from CodeMirror's syntax tree (kept up to date as you type, without re-reading the note). So tags inside a code block
  that opened far above the screen are still not highlights, and a keystroke costs the same in a note of any length.
- **The frontmatter's end** is worked out again only when an edit is in the frontmatter, or could close one
  (`frontmatterEndAfter`); typing in the body never re-reads it.

One thing that follows: a highlight is tinted while both its tags are within that margin, so a highlight whose
opening tag is more than 10,000 characters above the screen is drawn untinted, its tags showing, until you scroll
up to it. Highlights that long are not something the highlight menu makes.

Measured in a production build (stress-test notes, 2026-11-17; the numbers are in
[live-default-plan.md](../live-default-plan.md#step-1-lift-the-100000-character-limit-s-to-m)): a keystroke's work in
the editor is about 4 ms at 400,000 characters and 6 ms at 1,000,000, the same as before when those notes were drawn
with nothing tinted.

## Keeping it level with the Markdown tab

[`parityHarness.tsx`](../../apps/web/src/components/notes/parityHarness.tsx) renders either editor and gives a test
one driver for both (`type`, `typeKeys`, `select`, `press`, `paste`, `blur`). A scenario written with `describeParity`
runs once on each. One that the Live tab cannot do yet carries `pendingInLive`, runs as an expected failure, and
turns red the moment the feature arrives, so the list of gaps cannot go stale.
