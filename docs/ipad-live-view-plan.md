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
- **Italics, found on the iPad:** the first cut only tinted `*emphasis*` (as the Markdown tab does), and in the lab's monospaced face that read as plain monospaced text. The Live look now draws it italic: after the spans' attributes are on, every font inside an emphasis span is replaced by its italic (so `***both***` stays bold and italic), and where the face has no italic of its own the same font is slanted with `.obliqueness`. `FontFamily.uiFont` has no italic yet, so L3 must add one and try it with all three families (sans, serif, mono).
- **A limit:** this draws a picture that stands on a line of its own, which is how the iPad inserts every picture and how the Preview draws them. A picture in the middle of a sentence (the desktop draws it inline) would need a text attachment, which changes the characters; it stays as its text.
- **Not yet seen:** the selection handles and the Pencil over a drawn picture or rule, and the iPad itself. *Your look:* manual-test items 88 to 90.

### Step L2: the Live model, with an oracle (M to L)
A pure type in `CompositionCore`, `LiveModel`: from the text and the selection, **which ranges are hidden, which are styled (and how), which lines are headings or rules, which tints, which pictures**. It is built on the existing spans and marks; it carries the construct rule (V1) and `LiveReveal`.
- **Checked against:** the desktop's real `liveDecorations`, run in vitest on a CodeMirror state, over the MDX notes corpus, hand-made cases (nested bold in italic, a mark at the end of a line, a heading with no space, a rule next to a list, an image with a title) and random selections: `live-cases.json` and `live-expected.json`, as the other oracles.
- **A known risk:** the desktop reads Markdown with CodeMirror's parser and the iPad with swift-markdown; they differ on odd input. The oracle lists every case where they disagree; each is fixed in the Swift or accepted and written down.

*Done when* the Swift agrees on all but a documented few, and breaking details on purpose makes the check fail.

### Step L3: the Live tab (M to L)
- A fourth `Mode`, with the same `NoteTextView` and `NoteSession` as the Markdown tab, so switching keeps the caret and the text view is not rebuilt.
- A `LiveStyler` beside `MarkdownStyler`: it puts the model's attributes on the text (hidden = the prototype's tiny, clear font; headings sized; inline styles, italic included: see L1's result for the italic fonts) and **follows the selection by construct**, redrawing only the constructs the caret left and entered. It does nothing while a composition (Scribble, dictation) is under way, as the colouring does.
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

**Spike results (2026-11-08, the Editor lab in the Simulator; keys as a hardware keyboard sends them, from `LiveLabSpikeUITests`; forward delete and ⌘Z through the Simulator's own key events).** The lab now has *Hide syntax ▸ Reveal* with three rules: the caret's line (what it always did), **the construct the caret or selection touches, ends included (V1: this plan's rule, and the desktop's)**, and *never* (every mark hidden even at the caret, the worst case, to see what the text view does beside invisible characters). **Under V1 every keyboard case works.** In 32 scripted runs (three rules by arrows, Shift+arrows, Option+arrows and ⌘←/→, ↑/↓, Backspace after `# `, at a heading's start, after a closing `**` and across a line break, typing at all four edges of a bold word, and taps), and forward delete done by hand (before an opening `**`, at a heading's start), the caret moved one visible character per press and each Backspace or forward delete removed one visible character: the reveal runs in `textViewDidChangeSelection`, before the next key, so a hidden mark is never next to the caret. The "treat a hidden mark as one unit" idea is therefore **not needed, and would be wrong** (one Backspace after `**bold**|` removing one `*` is what the Markdown tab does too). **Under *never* the fear is real:** two presses with nothing moving on screen at each `**` (four across `**bold**`, either way, with Shift too), and Backspace or forward delete removing an invisible `*` or a heading's hidden space with nothing visible changing except that the bold word, or the heading, silently loses its style. **Odd, by design (for your look, items 91 to 97):** (1) the text reflows under the caret at a construct's edge: pressing → after `**bold**|` hides four marks and the caret is drawn 26 points *left* of where it was (← does the reverse); (2) ↑/↓ and taps choose their landing on the *hidden* layout, so a bold line is entered after the same number of *visible* letters, and then the line grows rightward by the marks' width; all 27 taps landed on word edges, none between the two `*`; (3) while a construct is touched its marks show as dimmed text. **Not settled:** ⌘B/⌘I, Tab and paste (not in the lab: `NoteTextView`), Scribble and dictation (restyling waits while text is being composed, so marks beside a Scribble edit stay as they were until it ends; item 98), and **undo/redo: ⌘Z sent through the Simulator undid nothing after typing, in the lab and in the real Markdown tab alike, so "only attributes change, so the undo stack is the text's" is not shown by this spike** (item 99). The lab's *Reveal* rule scans every span per mark (quadratic), so it is a probe, not the implementation.

### Step L6: accessibility (S)
**VoiceOver** reading the hidden marks (does it say "asterisk"?): tried first, then, if it does, the cheapest fix that works (hiding the marks from it, or an accessibility value without them, checked against the character rotor). **Dynamic Type** (headings scale with the text size), **Increase Contrast**, **Reduce Motion**, and the contrast of the dimmed syntax in each scheme (computed, in the core's tests, like the other tokens).

*Done when:* the accessibility audit passes on the Live tab, and you have read a bold word and a heading with VoiceOver.

**Spike results (2026-11-08, the Editor lab in the Simulator, which has no VoiceOver: what the text view exposes was read from XCUITest and from inside the app; what VoiceOver says is items 100 to 103).** The text view is one accessibility element (a text view) whose value is **the whole text, hidden marks included** (`**`, `# `: 186 characters in the lab's note), with the text's own attributes (`NSFont`, `NSColor`, `NSStrikethrough`, `NSBackgroundColor`); the tiny, clear font changes nothing about it, so unless something is done VoiceOver has the marks to read. Its line-by-line reading (`accessibilityContent(forLineNumber:)`, `accessibilityPageContent`) answers nil for every line, so reading and the character rotor go by the value and the text input, not by lines. **Candidate A, an accessibility value without the marks** (overriding `accessibilityValue` and `accessibilityAttributedValue`): the value is 161 characters, no `**` or `# `, typing still reaches the text and the value follows; but its offsets no longer match the text view's (25 fewer characters in this note), and VoiceOver's character and word navigation and its announcements of a selection are in the text input's offsets, so they may disagree: only the iPad can say. **Candidate B, marks silent without changing the string**: the value stays the 186 characters, and the 25 hidden characters carry `UIAccessibilitySpeechAttributePunctuation = false` (UIKit's header: "no punctuation will be spoken") with heading lines carrying `UIAccessibilityTextAttributeHeadingLevel`; offsets are unchanged, so A's risk does not arise; whether VoiceOver honours those attributes in a *text view's* value is documented for labels and values but not shown here. Both are in the lab (*Hide syntax ▸ VoiceOver*), costing nothing in the Live look. Xcode's accessibility audit over the lab screen gives the same 13 issues in all three modes (all in the lab's own bars and buttons); it says nothing of the text view or the hidden marks, so it cannot be the check for this. **Plan for L6:** try B on the iPad first (items 100 and 101), A as the fallback (item 102), and if neither silences the marks write the compromise down; mark headings with their level either way (the rotor's Headings, item 101).

### Step L7: speed (S)
The lab's *Typing speed test* on the 5,000-line note, in the Live view, against the 16 ms budget; the long-note rule (V5) decided from the number. On your iPad, in a Release build.

**Spike results (2026-11-08, the Editor lab on a Mac's Simulator, iPad Pro 11-inch (M5); the iPad itself is item 104).** The 5,000-line note is 100,190 characters, the desktop's limit. **Release**, median / 95th percentile over 200 keystrokes typed 16 ms apart into a paragraph that has marks: the Live look's own colouring work (what `textViewDidChange` does) is **0.4 ms / 0.5 ms** with the construct or the caret's line revealed, the same as Markdown colours alone (0.4 / 0.6); a whole keystroke on the main thread, UIKit's insert plus laying out the visible lines, is **4.2 ms / 4.8 ms** in Live (Markdown colours alone: 7.8 / 9.3, the visible marks make the lines longer), and 11 / 13 ms if the changed lines are also drawn into a bitmap (an upper bound, no compositor). A caret move across a bold word costs the restyle 0.01 ms median and 0.4 ms at the 95th when the construct rule redraws it (nothing under the line rule: same line); a move to another paragraph 0.4 to 0.6 ms (line rule) or none (construct rule, nothing touched); with layout, 4.7 to 5.8 ms median and 8 to 9 ms at the 95th. The first full pass: read 19 ms off the main thread, put on in about 35 steps of at most 2.1 ms (35 to 48 ms in all), 330 to 350 ms from opening to done; a synchronous restyle of the whole note (what changing the look does) is 100 to 130 ms, the whole layout about 100 ms. **Debug** is the same but for the colouring (0.65 to 0.75 ms per keystroke), and the lab's probe for the construct rule, which scans every span per mark, restyles the whole note in 1.9 s there (130 ms in Release): the real `LiveModel` must find a mark's construct from its blocks. A few keystrokes in 200 (0 to 5, by run) took more than 16 ms before any drawing, mostly 30 to 50 ms and once 96 and once 260 ms, **in every variant, Markdown colours alone included**, so it is not the Live look (a busy Mac is the likelier cause). **The 100,000-character limit (V5): keep it as the Live look's limit for v1.** Nothing per keystroke or per caret move grows with the note (colouring is block by block), so those do not need it; the whole-note work does grow, five times for four times the text (a synchronous restyle 0.5 s at 404,540 characters, 1 s with the construct rule), and, found while measuring, **the lab's background colouring did not settle on a 20,000-line, 404,540-character note** (five runs; it kept the app at 110% CPU for over ten minutes, in the Markdown-only variant too, so it is the existing colouring and not the Live look): the log shows each new pass interrupting the one still putting colours on, and each interruption scheduling another pass 0.3 s later, which holds once a pass takes longer than that (about 0.5 s at that size). It is not yet known whether the real editor's `Coordinator` does the same (item 105); the fix is small (do not start or reschedule a pass while one is putting on) and belongs before the limit is ever raised. Above the limit the Live view behaves as the Markdown tab and says so. The Mac's Simulator is not an iPad: the numbers are for comparing variants, and the budget is only met when item 104 says so.

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
