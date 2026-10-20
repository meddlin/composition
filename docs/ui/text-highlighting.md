# Highlighting text

Source: [`highlightText.ts`](../../apps/web/src/components/notes/highlightText.ts),
[`mdx/Mark.tsx`](../../apps/web/src/components/notes/mdx/Mark.tsx),
[`mdx/highlightColors.ts`](../../apps/web/src/components/notes/mdx/highlightColors.ts),
`.note-mark` in [`globals.css`](../../apps/web/src/app/globals.css) (web and desktop)

A highlight is text in the note: `<Mark color="yellow">like this</Mark>`, the [`<Mark>`](mdx-components.md#mark)
component. There is no separate store of highlights, so they travel with the note through backup,
trash, search and the other apps, and move with the text as it is edited.

Status: highlighting from the editor works, and the tags render in both panes. Highlighting from
the preview (select, right-click, "Highlight text") is not built yet: it needs the preview's
selection translated into offsets in the note's text.

## In the editor

Select text and press **Cmd/Ctrl+Shift+H**. A menu opens beside the selection with the five colors;
pick one with the arrow keys and Enter, a number key (`1`-`5`), or the mouse. It starts on the color
you used last (kept until the app is reloaded), so `Cmd+Shift+H`, `Enter` repeats it.

With only a caret, the menu opens only when the caret is inside a highlight, to recolor it
or choose **Remove highlight** (`0`). Escape, moving the selection, scrolling, or typing closes it.
If the note can't hold highlights (see below) a notice above the editor says why, until the note is
edited.

The change goes in through `execCommand("insertText")`, as Tab does, so Cmd/Ctrl+Z undoes a
highlight in one step; only the stretch between the first and last tag is replaced. Where that is
unavailable the text is replaced instead and the browser's undo history starts over. The editor's own
right-click menu is left alone: replacing it would lose spelling suggestions.
Source: [`useHighlightMenu.ts`](../../apps/web/src/components/notes/useHighlightMenu.ts),
[`HighlightMenu.tsx`](../../apps/web/src/components/notes/HighlightMenu.tsx),
`applyHighlight` in [`MarkdownEditor.tsx`](../../apps/web/src/components/notes/MarkdownEditor.tsx).
The editor also draws a highlight's color behind its text, see
[markdown-editor-highlighting.md](markdown-editor-highlighting.md#highlights-mark).

## Colors

`yellow`, `green`, `blue`, `pink`, `orange`. They are names, not hex values: a note written under
one color scheme has to read under another. `.note-mark` mixes the color's hue with transparency
(`--mark-alpha`, stronger on the light schemes), so the page and the text keep their own colors.
`markContrast.test.ts` fails if text on any color drops below a 4.5 contrast ratio in any scheme.

## Making highlights: `highlightText.ts`

Pure functions over the note's text, with offsets counted from the start of the note, frontmatter
included, as a textarea reports them.

- `highlightRange(text, range, color)` highlights the selection.
- `removeHighlight(text, range)` takes off the highlights the selection (or caret) touches.
- `highlightAt(text, offset)` says which highlight, if any, is around an offset.

Each returns the new text and the range to select again, or why it refused.

**One pair of tags per run of text.** A selection can cut across formatting (`**bo|ld** te|xt`),
and a tag pair can't. So the note is parsed and each run of plain text the selection touches gets
its own pair: `**bo<Mark>ld</Mark>** <Mark>te</Mark>xt`. Tags always sit inside the formatting,
never across it, and a selection over several paragraphs becomes one highlight per paragraph.
What is left alone: code, frontmatter, tag attributes, and a bare web address (wrapping it would
stop it being a link). A selection never cuts an escape (`\*`) or a character reference (`&amp;`)
in two, and the spaces at its ends stay outside the tags.

**Highlighting already-highlighted text recolors the highlight**, all of it, rather than nesting
or splitting it.

**It refuses rather than breaks the note.** Adding a `<Mark>` makes the note MDX (see
[mdx-components.md](mdx-components.md#how-it-renders)), which is stricter than Markdown, and
tags can change how formatting around them parses (`foo**<Mark>bar</Mark>**baz` is no longer
bold). So the result is parsed again, and if MDX can't read the note, or its structure (the
highlights looked through) differs from before, nothing is changed and the reason is returned.
A stray `{`, or an HTML tag like `<br>`, in a note is the usual cause: it has to be escaped or
removed first.

## Limits

- The terminal app shows a highlight's text without the tint; a stretch of Markdown is drawn by
  OpenTUI as one piece.
- A hand-written `<Mark>` with an unknown color is yellow, and the first highlight made over it
  rewrites the color.
