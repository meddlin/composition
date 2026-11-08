# iPad: the Live view

The Live view is the Markdown editor with its syntax hidden away from the caret: the note drawn as it will read, headings large, bold and italic as such, and the marks (`#`, `**`, `~~`, backticks) showing only where you are writing. **It is in v1** (you, 2026-11-08; [G7](ipad-build-plan.md#decisions-to-make) reversed, [C12](ipad-app-design.md#compromise-register) "in v1") and is **built right after M1 closes, before M2**. This page is the order of work, in the style of [ipad-build-plan.md](ipad-build-plan.md): what each step ends in, what is checked against the desktop, and what only you can do. Status: **M1 is done (you, 2026-11-08), so this has started: L0 is done, and L1 is done in the Simulator (your look on the iPad is next).** The six decisions below were taken as proposed (you, 2026-11-08). Dates are 2026-11-08.

## The spec

The desktop's Live tab is the spec: [`liveMarkdown.ts`](../apps/web/src/components/notes/liveMarkdown.ts) (what is hidden and drawn), [`liveImages.ts`](../apps/web/src/components/notes/liveImages.ts), and its plan, [live-editor-parity-plan.md](live-editor-parity-plan.md) (its rule: **no regression**, whatever works in the Markdown tab works the same in Live). In its words, the text stays the Markdown source, character for character, and only how it is drawn changes:

| What | Drawn as | Marks |
|---|---|---|
| `**bold**`, `*italic*`, `~~struck~~`, `` `code` `` | bold, italic, struck through, monospaced on a faint fill | `**`, `*`, `~~`, backticks hidden |
| `# Heading` to `###### Heading` | bold, large (H1 twice the text, H2 one and a half, H3 one and a quarter) | the `#`s and the space after them hidden |
| `---` | a line across the page | hidden |
| `![alt](src)` and `<Image />` | the picture, in place of its text | the text stays while the caret is on it, with the picture after it |
| `<Mark color="…">words</Mark>` | the words tinted | both tags hidden, as `**` is |
| frontmatter | set apart, small, monospaced, muted | never hidden |
| code, fences, URLs, links, tags, list and quote marks | coloured as the Markdown tab colours them | **not** hidden |

"Showing where the caret is" means **the construct the caret or selection touches** (ends included, so `**bold**|` still shows its marks and `**bold** |` does not): the marks come back, dimmed, and go again when the caret leaves.

## What is already built

- **The marks, as ranges:** `MarkdownHighlighter` and the incremental `HighlightModel` give every construct's span and its `.mark` ranges, in blocks (build plan Steps 5 and 6).
- **The prototype:** the Editor lab's *Hide: tiny and clear* (a tiny, clear font on the marks outside the caret's line; the characters never change, so undo and the selection are untouched). It "works well" on your iPad (item 17), and VoiceOver and Scribble work in the editor.
- **`LiveReveal`:** what stays showing is the caret's line, or the whole of a code block (both fences), found on your iPad.
- **Everything the Live view must not break:** the typing aids (the `<` list, `[[`, snippets), find, autosave, images, `<Mark>` from the edit menu, undo, the colour schemes, Dynamic Type. They live in `NoteTextView`, `EditorAssist` and `NoteSession`, which the Live view shares with the Markdown tab.

## Decisions (taken as proposed, you, 2026-11-08)

| | Decision | Default |
|---|---|---|
| **V1** | **How much shows when the caret is somewhere.** The prototype reveals the caret's *line*; the desktop reveals the *construct* the caret touches. | **By construct, as the desktop**: it is the spec, it can be checked against the desktop's own code, and a line with two bold words shows only the one you are in. Code blocks stay whole ([`LiveReveal`](#what-is-already-built)). |
| **V2** | **Fences.** The desktop always shows them, coloured. Your iPad test asked for both to show *when the caret is in the block*; outside it the prototype hides them. | **What you tried**: hidden outside the block, both showing inside. A recorded difference from the desktop. |
| **V3** | **What is drawn in the first cut.** Heading sizes, inline styles, hidden marks and tinted `<Mark>` are certain. A rule drawn as a line and a picture drawn in place of its text need a custom layout in TextKit 2 (see [L1](#step-l1-draw-without-changing-the-text)). | **Rules and pictures are in, if the spike says they can be.** The picture is the first thing to drop (it stays as its text, with the Preview showing it). *L1 says they can, in the Simulator (pictures that stand on a line of their own).* |
| **V4** | **Where the tab goes.** | **Markdown, Live, Preview, Split**, the fourth word in the toolbar's picker (and in the View menu of a narrow window). A new note still opens in Markdown until you choose. |
| **V5** | **Long notes.** The desktop draws the extras only up to 100,000 characters (`MAX_HIGHLIGHT_CHARS`). | **Measured first** ([L7](#step-l7-speed)); the iPad's colouring is incremental, so it may need no limit. If it does, the Live view behaves as Markdown above it and says so. |
| **V6** | **Reflow and the ruler** (breaking lines at a column as you type; desktop writing settings). | **Not part of the Live view's steps.** They stay where the tracker has them (M3†, "Ruler, reflow, editor and preview fonts"), and are ported for both writing tabs then. |

## The steps

Sizes are relative (S, M, L). An oracle is the rule of this project: **no port without a check against the desktop's real code**.

### Step L0: your decisions (S, yours) — done 2026-11-08
V1 to V6 were taken as proposed, with the defaults in the table above.

### Step L1: draw without changing the text (M, a spike)
In the lab, three small prototypes, in the Simulator and then on your iPad:
- **Heading sizes** by attributes (expected to be easy).
- **A rule:** a line whose `---` is hidden, drawn as a line across the page, through a custom layout fragment (`NSTextLayoutManagerDelegate`).
- **A picture in place of `![alt](src)`:** the same, with a fragment as tall as the picture; the caret, the selection handles and the Pencil over it.

*Done when* each works with the caret before, inside and after, or is called *no*, with its fallback: a rule left as a dim row of dashes, a picture shown below its text instead of in place of it. *You:* a short look on the iPad.

**Result in the Simulator, 2026-11-08: all three work** (lab, *Hide syntax ▸ Live look (spike L1)*; open it straight with `-openLab 1 -labHide live`). The characters never change, so undo, the selection and saving are untouched.
- **Headings** are sized by attributes (H1 twice the text, H2 one and a half, H3 one and a quarter), with the `#`s hidden like the other marks.
- **A rule** (`---`) is hidden and drawn as a line across the page; with the caret on it the three dashes show and nothing is drawn.
- **A picture** (a line that is only `![alt](src)`) is hidden and drawn in its place, 160 points tall; with the caret on the line the Markdown shows and the picture is drawn after it, as on the desktop. (In the spike every picture is the same gradient; the real one reads the stored image.)
- **The caret** moves one line to the next with the arrow keys, through the picture's line too: no stuck presses. A tap on a drawn picture puts the caret in its line and shows its text.
- **How it works, since it was not obvious:** a paragraph is made as tall as what is drawn (`minimumLineHeight`, or `paragraphSpacing` for the revealed picture), its text is hidden with the tiny, clear font, and a custom `NSTextLayoutFragment` (given by `NSTextLayoutManagerDelegate`) draws the rule or picture. Two things bit: the fragment is only as wide as its hidden text, so what it draws is clipped to a sliver unless `renderingSurfaceBounds` is widened to the text's width; and the fragment's frame includes the paragraph's spacing, so something drawn "after the text" has to start from the text's own last line (`textLineFragments`), not the frame's bottom.
- **A limit:** this draws a picture that stands on a line of its own, which is how the iPad inserts every picture and how the Preview draws them. A picture in the middle of a sentence (the desktop draws it inline) would need a text attachment, which changes the characters; it stays as its text.
- **Not yet seen:** the selection handles and the Pencil over a drawn picture or rule, and the iPad itself. *Your look:* manual-test items 88 to 90.

### Step L2: the Live model, with an oracle (M to L)
A pure type in `CompositionCore`, `LiveModel`: from the text and the selection, **which ranges are hidden, which are styled (and how), which lines are headings or rules, which tints, which pictures**. It is built on the existing spans and marks; it carries the construct rule (V1) and `LiveReveal`.
- **Checked against:** the desktop's real `liveDecorations`, run in vitest on a CodeMirror state, over the MDX notes corpus, hand-made cases (nested bold in italic, a mark at the end of a line, a heading with no space, a rule next to a list, an image with a title) and random selections: `live-cases.json` and `live-expected.json`, as the other oracles.
- **A known risk:** the desktop reads Markdown with CodeMirror's parser and the iPad with swift-markdown; they differ on odd input. The oracle lists every case where they disagree; each is fixed in the Swift or accepted and written down.

*Done when* the Swift agrees on all but a documented few, and breaking details on purpose makes the check fail.

### Step L3: the Live tab (M to L)
- A fourth `Mode`, with the same `NoteTextView` and `NoteSession` as the Markdown tab, so switching keeps the caret and the text view is not rebuilt.
- A `LiveStyler` beside `MarkdownStyler`: it puts the model's attributes on the text (hidden = the prototype's tiny, clear font; headings sized; inline styles) and **follows the selection by construct**, redrawing only the constructs the caret left and entered. It does nothing while a composition (Scribble, dictation) is under way, as the colouring does.
- The typing aids, find, autosave, the Image menu and the edit menu work as in the Markdown tab; the picker and the compact View menu get the fourth entry.

*Done when:* UI tests move the caret into and out of a bold word, a heading and a code block and check what shows (by what the screen's pixels and the accessibility tree say, as the appearance tests do); switching tabs keeps the caret; the existing suites pass.

### Step L4: rules, pictures, tints, frontmatter (M)
What L1 allowed: rules and pictures drawn; `<Mark>` tinted (the scheme's five tints) with its tags hidden as `**` is; the frontmatter set apart (small, monospaced, muted); every colour scheme, and the faint fill behind code spans.

*Done when:* pixel checks in each scheme, and the Preview showcase note looks as the desktop's Live tab draws it.

### Step L5: editing across hidden marks (M)
The hard part, and the one only a person can judge. Marks that are hidden are still characters:
- **The caret and selection** must never seem stuck on an invisible character (you noted a press or two in the prototype): a rule that moves the caret across a hidden run.
- **Delete and backspace** next to a hidden mark; **⌘B and ⌘I** toggling marks that are hidden; **Tab**; **paste**; **undo and redo** (only attributes change, so the undo stack is the text's); **Scribble** and dictation; the `<` list's place at the caret.
- With a hardware keyboard, UI tests send the keys; the rest is your sitting.

*Done when:* the UI tests pass and you have written in a long note for ten minutes without a surprise.

### Step L6: accessibility (S)
**VoiceOver** reading the hidden marks (does it say "asterisk"?): tried first, then, if it does, the cheapest fix that works (hiding the marks from it, or an accessibility value without them, checked against the character rotor). **Dynamic Type** (headings scale with the text size), **Increase Contrast**, **Reduce Motion**, and the contrast of the dimmed syntax in each scheme (computed, in the core's tests, like the other tokens).

*Done when:* the accessibility audit passes on the Live tab, and you have read a bold word and a heading with VoiceOver.

### Step L7: speed (S)
The lab's *Typing speed test* on the 5,000-line note, in the Live view, against the 16 ms budget; the long-note rule (V5) decided from the number. On your iPad, in a Release build.

### Step L8: close (S)
The tracker's Live row and C12 updated (built, with what differs from the desktop), new items on the manual test page, the build plan. **Gate L: yours**, the manual test items for the Live view on the iPad. Then M2.

## Risks

| Risk | Likelihood / impact | What answers it |
|---|---|---|
| Caret and selection feel wrong across hidden marks | Medium / high | L5 is its own step, with a rule for skipping hidden runs; the prototype already works well, which is why this is not "high" |
| Custom layout fragments (rules, pictures) fight the caret or the selection | Medium / medium | L1 before anything is built on it; fallbacks that keep the text visible |
| The two Markdown parsers disagree on odd notes | High / low | L2's oracle lists them; documented differences |
| VoiceOver reads the hidden marks | Medium / medium | L6; a fix or a documented compromise |
| Redrawing on every caret move is slow in a long note | Low / medium | Only the constructs left and entered are redrawn; L7 measures it |
| Typing inside a hidden construct is confusing (`**` typed while the closing marks are hidden) | Medium / low | The construct shows its marks while the caret touches it, as on the desktop |

## The Live view is done when

- the Live tab edits a note as the Markdown tab does, with no loss of any writing feature (the desktop's rule: **no regression**);
- what is hidden and drawn agrees with the desktop's Live tab, except for the differences written down (V2, and the parser cases);
- the caret, selection, undo, Scribble and VoiceOver behave on your iPad, in portrait and landscape;
- typing in a long note keeps up.

## Out of scope

Reflow and the ruler (M3†, for both writing tabs); links, lists, quotes and code blocks drawn as such (the desktop's Live tab does not draw them either; the Preview does); editing a diagram from the Live view; and anything of the Pencil, which is M2.
