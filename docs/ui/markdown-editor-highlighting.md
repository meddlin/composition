# Syntax highlighting in the Markdown editor

Source: [`MarkdownHighlight.tsx`](../../apps/web/src/components/notes/MarkdownHighlight.tsx),
[`markdownTokens.ts`](../../apps/web/src/components/notes/markdownTokens.ts),
`.md-*` in [`globals.css`](../../apps/web/src/app/globals.css) (web and desktop)

The Markdown tab colours headings, emphasis, code, links, lists, quotes, code fences, frontmatter
and MDX tags as you type. The code *inside* a fence is not coloured by language (the preview does
that); the editor shows it as code.

## How it works

The editor is still a plain `<textarea>`, which keeps the caret, selection, undo, IME, spell-check
and the `<` completion menu. Its text is drawn transparent, and a copy of the same text, split into
coloured `<span>`s, sits underneath it (`aria-hidden`, `pointer-events: none`). Scrolling is copied
from the textarea to the layer.

- **Tokenizer.** `tokenizeMarkdown` is a pure function that reads line by line, remembering only
  whether it is inside a code fence. It is not a full CommonMark parse: it has to run
  synchronously on every keystroke (a debounced parse would colour the wrong text while typing),
  so inline constructs never span lines and a line over 2000 characters is left plain. The runs it
  returns always concatenate back to the input; a test checks that.
- **Colour only.** Both layers must wrap identically, so token styles set only `color`. Don't add
  bold, italic or a different size to an `.md-*` class: the layer would drift from the caret. A
  background is fine, since it changes no glyph: find-in-note uses one, and so does a
  `<Mark>`'s text (`.md-mark`, see below).
- **Palette.** The `.md-*` classes reuse the `--syntax-*` tokens that colour code blocks in the
  preview, so every colour scheme gets editor colours with nothing extra.

## Highlights (`<Mark>`)

The text between `<Mark color="…">` and `</Mark>` is drawn with that colour behind it, the same tint
the preview uses ([text-highlighting.md](text-highlighting.md)). `markTints` in
[`markTints.ts`](../../apps/web/src/components/notes/markTints.ts) finds the stretches by scanning the
text for the tags, not by reading the coloured runs: the tokenizer takes `**<Mark>b</Mark>**` and
`[<Mark>c</Mark>](url)` as one run each, so the tags inside would be lost. Tags in code and
frontmatter are not tags. Where highlights nest, the inner colour wins.

## Limits

- Notes over `MAX_HIGHLIGHT_CHARS` (100,000) are shown plain, and the textarea draws its own text.
- Windows high-contrast mode (`forced-colors`) hides the layer; the browser forces the textarea's
  own text to be visible there.

## Editor font

Settings → Editor font picks the family (`EDITOR_FONT_CHOICES` in
[`editorFonts.ts`](../../apps/web/src/lib/composition/editorFonts.ts)). It is not limited to
monospace: the textarea and the coloured layer both use the `.editor-text` class, which reads
`--editor-font`, and the caret measuring for the completion menus copies the textarea's computed
font, so any family lines up. Ligatures are switched off in `.editor-text` because they cannot form
across the layer's coloured spans. Keep both elements on that one class when editing either.

## Note background

Settings → Note background picks a pattern behind the text (`NOTE_BACKGROUND_CHOICES` in
[`noteBackgrounds.ts`](../../apps/web/src/lib/composition/noteBackgrounds.ts)): "plain" (the
default) or "architect", a faint quad-ruled notebook grid. The choice is `data-note-background` on
`<html>` (set by both layouts, and by Settings on click), and `globals.css` draws the grid on
`.note-surface`, which the textarea and the preview pane carry. The lines are the scheme's
`--foreground` at a few percent, so every scheme (and the sun blend) gets a matching, quiet grid.

The grid is drawn on the textarea itself with `background-attachment: local`, so it scrolls with
the text. Its square is `1.5rem`, the editor's `leading-6`, anchored at the `1rem` padding, which
makes each line of text sit on a rule. That alignment holds only while the textarea's line height
and padding stay `leading-6` and `p-4`; change either and change `--grid-square` and
`background-position` with it. The preview's text does not follow the grid (headings and prose
have their own line heights), so there it is only texture.

## Ruler and reflow

Settings → Writing holds two aids, both off by default (`WritingSettings` in
[`writing.ts`](../../apps/web/src/lib/composition/writing.ts)). The workspace hands them to every
editor through `WritingProvider`, so a change applies when the user goes back to their notes.

- **Ruler.** A 1px line over the textarea (`pointer-events-none`, clipped to the editor) at
  `calc(1rem + <column>ch)`. `ch` is measured in `.editor-text` at the textarea's size, so it is
  exact in a monospace font and approximate in a proportional one. It never touches the text.
- **Reflow.** While typing (`inputType === "insertText"` only, so paste, drop, delete and undo are
  left alone), [`reflowAtCaret`](../../apps/web/src/components/notes/reflowText.ts) breaks the
  caret's line at the last space before the column. Only that line changes. Continuation lines keep
  the indent and `>` marks and sit under a list item's text. Frontmatter, code fences, indented
  code, headings and HTML/JSX lines are never broken, nor are table rows while "Keep Markdown tables
  intact" is on (a row must stay on one line to stay a table). The break goes in through
  `execCommand("insertText")` so it is its own undo step, falling back to replacing the text where
  that is unavailable.

## Changing it

If the layer and the text ever disagree, check that the textarea and the `<pre>` in
`MarkdownHighlight.tsx` still share font, size, line height, padding and wrapping classes. A
typical symptom is colours slipping further off the further down the note you scroll.
