# Code blocks: line numbers and highlighted lines

Source: [`codeFence.ts`](../../apps/web/src/lib/composition/codeFence.ts) (reading the options),
[`rehypeCodeLines.ts`](../../apps/web/src/components/notes/rehypeCodeLines.ts) (Preview),
[`liveCode.ts`](../../apps/web/src/components/notes/liveCode.ts) (the Live tab). Shared cases:
[`fixtures/conformance/code-fence-cases.json`](../../fixtures/conformance/code-fence-cases.json).

A fenced code block can number its lines, start counting at a line other than 1, and highlight some of its lines. The
options are written on the opening fence, after the language, so the note stays plain Markdown: it needs no MDX
component, and anywhere else (GitHub, another editor, an export) it is an ordinary code block.

````md
```ts showLineNumbers=107 {109,112-114}
const a = 1;
const b = 2;
const c = a + b; // 109, highlighted
```
````

## The syntax

Decided 2026-11-18.

- **`showLineNumbers`** numbers the lines from 1. **`showLineNumbers=107`** numbers them from 107: the first line of
  code is 107. One key does both, so there is no way to set a start line with the numbers off. The value is a whole
  number from 0 to 999999999; any other value (`=abc`, `=-3`, `=1.5`, `=`) numbers from 1. The key is matched exactly,
  case included, as Docusaurus spells it.
- **`{109,112-114}`** highlights lines: single lines and ranges, separated by commas, spaces allowed inside the braces
  (`{ 109, 112 - 114 }`). A range written backwards (`{114-112}`) is read forwards. More than one group
  (`{109} {112-114}`) adds up. A piece that is not a number or a range (`{a,109}`) is skipped and the rest kept.
- **The numbers in braces are the line numbers you see.** With `showLineNumbers=107`, `{109}` is the line labelled
  109, the third line of the block. Without a start line (or without numbers at all) they count from 1, so `{3}` is
  the third line. A number outside the block (`{50}` in a block that starts at 107, or past its last line) is
  ignored, with no warning. Changing the start line keeps the numbers, so the highlight can land on other code: that
  is the price of typing the number you see, which is the one in a stack trace or a review.
- **Highlighting works without numbers.** ```` ```ts {3} ```` highlights the third line and shows no numbers.
- **The options go in any order** after the language, separated by spaces. Anything else on the line is ignored and
  left alone (it may be meant for another tool).
- **A fence with no language.** The language is the first word after the backticks, as Markdown reads it, except when
  that word is one of these options: ```` ``` {3} ```` and ```` ``` showLineNumbers ```` have no language and are not
  coloured, rather than being coloured as a language called `{3}`. GitHub and other Markdown readers take `{3}` as the
  language there; nothing breaks, the block is just plain.
- **Indented code blocks** have no fence, so no options: they are never numbered or highlighted.

Docusaurus and rehype-pretty-code read the same spelling, but count highlighted lines from the block's first line
whatever the start line. A note with a start line and highlights shows different lines highlighted there.

Left out for now, with room for them in the same `key=value` form: a title, `+`/`-` diff lines, highlighting words,
more than one highlight colour.

## How it looks

- **Line numbers** sit in a column to the left of the code, right-aligned, in the muted text colour, as wide as the
  largest number in the block. They are drawn by CSS (`content: attr(data-line)`), so copying code never copies them.
- **A highlighted line** has a band of the scheme's `--highlight` colour behind it, mixed into the code background,
  and a bar in that colour at its left edge, so it shows without telling colours apart. The band runs the width of
  the block.
- **Preview** splits the highlighted code into one element per line (`rehypeCodeLines`, after the syntax colours), and
  only for a fence with an option: a plain block is drawn as before.
- **The Live tab** puts the number and the highlight on each line of code as line decorations, with the fences hidden
  or shown as before. The fence lines themselves are never numbered. A long line wraps under its code, not under its
  number.

## Other apps

- **Terminal app:** the preview puts a block with options in OpenTUI's line-number gutter
  ([`Preview.tsx`](../../apps/cli/src/components/Preview.tsx)), numbered from the start line, with a highlighted line
  tinted in the accent (its number more strongly). With highlights alone the gutter is hidden and only the tint
  shows. It reads the fence with the same `codeFence.ts`, so ```` ``` {3} ```` is not coloured as a language there
  either.
- **iPad:** not built yet. Its preview and Live view should read `code-fence-cases.json` with a Swift port of
  `parseCodeFence`.
