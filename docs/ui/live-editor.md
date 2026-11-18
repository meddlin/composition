# The Live tab

Source: [`LiveEditor.tsx`](../../apps/web/src/components/notes/LiveEditor.tsx),
[`liveMarkdown.ts`](../../apps/web/src/components/notes/liveMarkdown.ts),
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
- **Links** (`[text](url "title")`) are drawn as their text, underlined in the link colour, with `[` and
  `](url "title")` hidden; hover one to see its address (and title) as a tooltip. While the caret or a selection is
  in a link its source shows, the brackets dimmed, so its text and its address are edited like any Markdown.
  Reference links (`[text][label]`, `[label]`) are drawn the same way when the note defines the label. Autolinks
  (`<https://…>`, the brackets hidden) and bare addresses (`https://…`, `www.…`) are drawn as links too. A
  `note:` link to a note that no longer exists, and a `pdf:` link to a PDF that is not on this device (every PDF
  link, in the web app), are struck through and muted, as in Preview, and go nowhere. See
  [Following a link](#following-a-link).
- **Frontmatter** is set apart in a small monospaced face and is not read as Markdown (its closing `---` is not a heading).
- **Notes of any length** are drawn this way, with no limit on their size (see [Long notes](#long-notes)).
- Everything else (lists, quotes, code blocks, other MDX tags) is shown as the Markdown you wrote, coloured
  as the Markdown tab colours it ([markdown-editor-highlighting.md](markdown-editor-highlighting.md)).

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
- Not in the Live tab, by design: rendered lists, diagrams, and a preview of MDX components. Use
  **Split** for those.

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
