# The Live tab

Source: [`LiveEditor.tsx`](../../apps/web/src/components/notes/LiveEditor.tsx),
[`liveMarkdown.ts`](../../apps/web/src/components/notes/liveMarkdown.ts),
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
- **Tables** (GFM) are drawn as Preview draws them: the same markup and `prose` styles, column alignment included.
  See [Blocks](#blocks) below.
- **Frontmatter** is set apart in a small monospaced face and is not read as Markdown (its closing `---` is not a heading).
- Everything else (links, lists, quotes, code blocks, MDX tags, and tables inside a list or a quote) is shown as the Markdown you wrote, coloured
  as the Markdown tab colours it ([markdown-editor-highlighting.md](markdown-editor-highlighting.md)).

"Touches" means the selection reaches the construct, ends included, so a selection that spans several constructs
shows all their marks.

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
- Not in the Live tab yet: rendered links and lists, diagrams, and a preview of MDX components (Steps 2 to 7 of
  [live-default-plan.md](../live-default-plan.md)). Use **Split** for those.

## Keeping it level with the Markdown tab

[`parityHarness.tsx`](../../apps/web/src/components/notes/parityHarness.tsx) renders either editor and gives a test
one driver for both (`type`, `typeKeys`, `select`, `press`, `paste`, `blur`). A scenario written with `describeParity`
runs once on each. One that the Live tab cannot do yet carries `pendingInLive`, runs as an expected failure, and
turns red the moment the feature arrives, so the list of gaps cannot go stale.
