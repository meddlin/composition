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
  bold, italic or a different size to an `.md-*` class: the layer would drift from the caret.
- **Palette.** The `.md-*` classes reuse the `--syntax-*` tokens that colour code blocks in the
  preview, so every colour scheme gets editor colours with nothing extra.

## Limits

- Notes over `MAX_HIGHLIGHT_CHARS` (100,000) are shown plain, and the textarea draws its own text.
- Windows high-contrast mode (`forced-colors`) hides the layer; the browser forces the textarea's
  own text to be visible there.

## Changing it

If the layer and the text ever disagree, check that the textarea and the `<pre>` in
`MarkdownHighlight.tsx` still share font, size, line height, padding and wrapping classes. A
typical symptom is colours slipping further off the further down the note you scroll.
