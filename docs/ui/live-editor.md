# The Live tab

Source: [`LiveEditor.tsx`](../../apps/web/src/components/notes/LiveEditor.tsx),
[`liveMarkdown.ts`](../../apps/web/src/components/notes/liveMarkdown.ts),
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
- **Frontmatter** is set apart in a small monospaced face and is not read as Markdown (its closing `---` is not a heading).
- Everything else (links, lists, quotes, code blocks, images, MDX tags) is shown as the Markdown you wrote, coloured
  as the Markdown tab colours it ([markdown-editor-highlighting.md](markdown-editor-highlighting.md)).

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

- **Undo history** belongs to the Live editor and starts again when you switch to it from another tab (the Markdown
  tab keeps its own, in the browser).
- **Reflow's break** is part of the typed character's undo step; in the Markdown tab it is a step of its own.
- **The ruler** is drawn in the preview font, which is not monospaced, so a column is that many widths of a `0`: a
  guide. Reflow counts characters exactly, hidden marks included, because that is what the file holds.
- **Enter and pasting plain text** are done by the editor itself, not the browser.
- **Line height.** Without a notebook background the lines have the preview's roomier spacing. With the architect
  background (Settings → Styling) each line is a whole grid square tall (a level 1 or 2 heading, two), so the text
  sits on the rules as it does in the Markdown tab.
- **The note is drawn in the preview's font**, not the editor's.
- Not in the Live tab, by design: inline images, rendered links and lists, and a preview of MDX components. Use
  **Split** for those.

## Keeping it level with the Markdown tab

[`parityHarness.tsx`](../../apps/web/src/components/notes/parityHarness.tsx) renders either editor and gives a test
one driver for both (`type`, `typeKeys`, `select`, `press`, `paste`, `blur`). A scenario written with `describeParity`
runs once on each. One that the Live tab cannot do yet carries `pendingInLive`, runs as an expected failure, and
turns red the moment the feature arrives, so the list of gaps cannot go stale.
