# The Live tab

Source: [`LiveEditor.tsx`](../../apps/web/src/components/notes/LiveEditor.tsx),
[`liveMarkdown.ts`](../../apps/web/src/components/notes/liveMarkdown.ts),
[`liveCode.ts`](../../apps/web/src/components/notes/liveCode.ts),
[`liveImages.ts`](../../apps/web/src/components/notes/liveImages.ts),
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
- **Code blocks** (fenced and indented) are drawn as Preview draws them: on the block background, in the code
  font, with rounded corners, and coloured by language with Preview's highlighter (`lowlight`) and Preview's colours.
  See [Code blocks](#code-blocks).
- **Frontmatter** is set apart in a small monospaced face and is not read as Markdown (its closing `---` is not a heading).
- Everything else (links, lists, quotes, other MDX tags) is shown as the Markdown you wrote, coloured
  as the Markdown tab colours it ([markdown-editor-highlighting.md](markdown-editor-highlighting.md)).

"Touches" means the selection reaches the construct, ends included, so a selection that spans several constructs
shows all their marks.

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
- Not in the Live tab yet (see [live-default-plan.md](../live-default-plan.md)): rendered links and lists, diagrams, and a preview of MDX components. Use
  **Split** for those.

## Keeping it level with the Markdown tab

[`parityHarness.tsx`](../../apps/web/src/components/notes/parityHarness.tsx) renders either editor and gives a test
one driver for both (`type`, `typeKeys`, `select`, `press`, `paste`, `blur`). A scenario written with `describeParity`
runs once on each. One that the Live tab cannot do yet carries `pendingInLive`, runs as an expected failure, and
turns red the moment the feature arrives, so the list of gaps cannot go stale.
