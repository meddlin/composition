# The Live tab

Source: [`LiveEditor.tsx`](../../apps/web/src/components/notes/LiveEditor.tsx),
[`liveMarkdown.ts`](../../apps/web/src/components/notes/liveMarkdown.ts),
[`liveLists.ts`](../../apps/web/src/components/notes/liveLists.ts),
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
- **Lists, task lists and quotes**: see [below](#lists-task-lists-and-quotes).
- **Frontmatter** is set apart in a small monospaced face and is not read as Markdown (its closing `---` is not a heading).
- Everything else (links, code blocks, other MDX tags) is shown as the Markdown you wrote, coloured
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
- Not in the Live tab yet: rendered links, code blocks, tables, diagrams, and a preview of MDX components (Steps 2,
  3, 5 and 6 of the [live-default plan](../live-default-plan.md)). Use **Split** for those.

## Keeping it level with the Markdown tab

[`parityHarness.tsx`](../../apps/web/src/components/notes/parityHarness.tsx) renders either editor and gives a test
one driver for both (`type`, `typeKeys`, `select`, `press`, `paste`, `blur`). A scenario written with `describeParity`
runs once on each. One that the Live tab cannot do yet carries `pendingInLive`, runs as an expected failure, and
turns red the moment the feature arrives, so the list of gaps cannot go stale.
