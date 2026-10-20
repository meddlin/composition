# Highlighting text

Source: [`highlightText.ts`](../../apps/web/src/components/notes/highlightText.ts),
[`mdx/Mark.tsx`](../../apps/web/src/components/notes/mdx/Mark.tsx),
[`mdx/highlightColors.ts`](../../apps/web/src/components/notes/mdx/highlightColors.ts),
`.note-mark` in [`globals.css`](../../apps/web/src/app/globals.css) (web and desktop)

A highlight is text in the note: `<Mark color="yellow">like this</Mark>`, the [`<Mark>`](mdx-components.md#mark)
component. There is no separate store of highlights, so they travel with the note through backup,
trash, search and the other apps, and move with the text as it is edited.

You can highlight from either pane: with a shortcut in the editor, or by selecting text in the
preview and right-clicking it.

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

## In the preview

Select text in the preview and right-click. The menu has **Highlight text** (in the color used
last), **Highlight color** (a submenu of the five), **Remove highlight** (when the selection touches
one) and **Copy**. Right-clicking an existing highlight, with nothing selected, opens the same menu for
it: recolor it or remove it.

The menu is only taken over when it has something to offer, a selection in the preview or a click
on a highlight. Anywhere else the browser's own menu (or the desktop app's) appears. Because ours
replaces it over a selection, Copy is in it. When the selection can't be highlighted (it is only
code, or its text can't be traced back to the note, see below) "Highlight text" is greyed out, with
the reason shown under it.

The edit is made in the editor's text, so it saves like any edit. In the split view the editor
takes focus and a highlight is one undo step; with the preview alone showing (the editor is
hidden and can't take focus) the text is replaced instead and the browser's undo starts over.
Source: [`PreviewHighlightMenu.tsx`](../../apps/web/src/components/notes/PreviewHighlightMenu.tsx),
[`ui/context-menu.tsx`](../../apps/web/src/components/ui/context-menu.tsx).

### Tracing a selection back to the note

The preview is rendered Markdown, so a selection in it has to be turned back into offsets in the
note's text before `highlightRange` can use it. That is what
[`previewSource.ts`](../../apps/web/src/components/notes/previewSource.ts) does:

- **`rehypeSourceSpans`** wraps every piece of the preview's text in `<span data-src="start-end">`,
  the positions the Markdown parser read it from. Code, and whitespace between pieces, are not
  wrapped, so a selection in code has nothing to highlight. It runs first among the rehype plugins.
  (It does mean `getByText` in a test can return that inner span; ask for the outer element by role or title.)
- **`sourceRangeOf`** finds the pieces a DOM range covers and aligns each piece's text with its
  source (`alignText`): the renderer drops the backslash of an escape, the `>` of a quote and the indent
  of a list item on continued lines, and spaces before a line break, and nothing else, so
  every character is found in order skipping only those. Where that doesn't hold it gives up
  rather than guess.
- **Character references** (`&amp;`, `&copy;`) are the one thing it refuses: `&` is one character on
  screen and several in the note, so the selection can't be traced. The editor can still highlight there.

`previewHighlight.property.test.tsx` is what stands behind this. It picks selections at random in
the rendered preview of notes using most of Markdown (nested quotes and lists, tables, escapes,
emoji, callouts, existing highlights), highlights them through the real pipeline, renders the
result and checks that exactly the selected words are highlighted. `HIGHLIGHT_FUZZ_SEED` and
`HIGHLIGHT_FUZZ_ATTEMPTS` widen it; about 60,000 selections passed when it was written. It found
the two core bugs below.

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

**It judges the note as it is shown.** A note with no component renders as plain Markdown, so that
is what a highlight is checked against, not MDX: MDX has no indented code, so a note with one
would silently turn it into a paragraph. Such a note is refused, with the reason (use a fenced
block). And the tags are kept clear of a quote's `>` and a list's indent, which a highlight that
starts or ends on a line break would otherwise land inside.

## Limits

- The terminal app shows a highlight's text without the tint; a stretch of Markdown is drawn by
  OpenTUI as one piece.
- The preview can't highlight text with a character reference (`&amp;`) in it, or code.
- A note with an indented code block can't hold highlights until it is a fenced one.
- A hand-written `<Mark>` with an unknown color is yellow, and the first highlight made over it
  rewrites the color.
