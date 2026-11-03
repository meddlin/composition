# Live editor: reaching parity with the Markdown editor

The Live tab (a CodeMirror 6 editor that shows Markdown syntax only under the caret) shipped with the core look and
nothing else. This plan brings every writing feature of the textarea editor into it, so that Live can one day be the
default without anyone losing something. Status: **planned and agreed with the owner (2026-11-03); Steps 0 and 1
are built and Gates A and B have passed; Steps 2 to 8 are not started.** Anything marked **my pick** is a judgment, not something the owner decided; see
[Decided by the owner](#decided-by-the-owner-2026-11-03) for what was.

## Goal and rule

**No regression.** Whatever works in the Markdown tab (typing, shortcuts, menus, pasted images, reflow) works the
same in the Live tab before Live is offered as a default. The Markdown/Preview/Split tabs and the textarea editor
stay as they are; this is additive.

Not in this plan: rendering more Markdown inline (links, lists, blockquotes, code blocks, images as pictures; only
`<Mark>` is added, in Step 6), a setting for the default view, and the preview-side features (following a link, highlighting from the preview,
editing a diagram from the preview), none of which the Live tab has a counterpart for.

## Where the Live tab stands

Every row is a feature of [`MarkdownEditor.tsx`](../apps/web/src/components/notes/MarkdownEditor.tsx) and its
hooks. "Pure" means the logic works on a string and needs no change; "bound" means it reads or writes the textarea.

| Feature | Shortcut / trigger | Logic (pure) | Bound to the textarea | Live today |
|---|---|---|---|---|
| Image paste | paste | `imageRefs`, `imageLimit` | `onPaste`, placeholder + upload in `MarkdownEditor` | no |
| Image picker | Ctrl/Cmd+Shift+M | `imagePicker.ts` | `useImagePicker`, `ImagePickerMenu` position | no |
| Image → `<Image />` | Ctrl/Cmd+Shift+X | `mdx/imageToMdx.ts` | `convertImagesToMdx` (uses `execCommand`) | no |
| MDX completion | `<`, inside a tag, frontmatter, snippets | `mdx/completions`, `props`, `frontmatterProps`, `snippets` | `useMdxCompletion` | no |
| Note-link picker | `[[`, Ctrl/Cmd+Shift+K | `noteLinks.ts` | `useNoteLinkPicker` | no |
| Highlight menu | Ctrl/Cmd+Shift+H | `highlightText.ts` | `useHighlightMenu`, `applyHighlight` (`execCommand`) | no |
| Highlight tint | `<Mark color>` text is tinted | `markTints.ts` | `MarkdownHighlight` layer | no |
| Ruler | Settings > Writing | — | overlay in `MarkdownEditor` | no |
| Reflow | typing past the column | `reflowText.ts` | `reflowTyping`, `applyReflow` (`execCommand`) | no |
| Draw.io | Ctrl/Cmd+Shift+D, Diagram button | `mdx/drawioSrc.ts` | `startDiagram` | button works (caret kept in a ref); shortcut no |
| Tab types a tab | Tab | — | `onKeyDown` | yes |
| Find in note | Ctrl/Cmd+F | `findMatches.ts` | `MarkdownEditor` | yes |
| Read-only, spellcheck | — | — | — | yes |
| Syntax colours (code, fences, URLs, tags) | — | `markdownTokens.ts` | `MarkdownHighlight` layer | no (only bold, italic, strike, code, headings) |

The first inventory missed three of these: the image picker, Image → `<Image />`, and the draw.io shortcut. They
are in this plan too.

## Approach: one set of features, two editors

**Decision (agreed): the existing hooks and menus drive both editors, through a small adapter.** The alternative
is CodeMirror's own autocompletion and tooltip extensions, written again for each feature.

In plain terms: today each feature (the `<` menu, the `[[` link picker, the highlight menu, and so on) is written
against the textarea: it asks the textarea where the caret is and what is selected, listens for the textarea's
keys, and edits the textarea's text. The adapter is a short list of those questions and edits (see below) that
either editor can answer. The features are changed once to ask the adapter instead of the textarea, and then
work in the Markdown tab and the Live tab alike, with the same menus and the same keys. Nothing is copied.

Why the adapter:

- The logic is already pure strings (`findTrigger`, `matchNotes`, `highlightRange`, `reflowAtCaret` and the rest).
  What is textarea-specific is a thin layer: reading `selectionStart/End` and `value`, React keyboard events,
  and `caretCoordinates`, the invisible mirror that measures where the caret is.
- The menus (`MdxCompletionMenu`, `NoteLinkMenu`, `ImagePickerMenu`, `HighlightMenu`) are presentational and look
  the same in both editors, which is what "no regression" means to a user.
- One implementation of each key handler means one set of bugs, and the existing ~157 tests in the seven
  `MarkdownEditor.*.test.tsx` files keep guarding it.
- CodeMirror's autocomplete would give different menus, different keys and a second copy of every trigger rule.

What it costs: the hooks change signature once (Step 0), and CodeMirror's key handling has to be told to step
aside (below).

### The adapter

```ts
/** What the writing features need of whichever editor is showing. */
interface EditorSurface {
  text(): string;
  selection(): { start: number; end: number };
  /** Swaps [start, end) for text and puts the caret `caret` characters in (default: after it). One undo step. */
  replace(start: number, end: number, text: string, caret?: number): void;
  setSelection(start: number, end: number): void;
  /** Where the character at `pos` is, relative to the box the menus sit in, scroll already taken off. */
  coordsAt(pos: number): { left: number; top: number; height: number };
  /** The visible size of that box, for deciding whether a menu fits below or goes above. */
  box(): { width: number; height: number };
  hasFocus(): boolean;
}
```

- `textareaSurface(el)` wraps today's behaviour; `coordsAt` is `caretCoordinates` minus the scroll offsets.
- `liveSurface(view, host)` wraps CodeMirror: `view.coordsAtPos` converted to the host's coordinates; `replace` is
  one `dispatch` with a `selection`, which CodeMirror's history takes as one undo step, so the three
  `execCommand("insertText")` workarounds (highlight, Image → MDX, reflow) have no counterpart.
- Hooks stop taking `RefObject<HTMLTextAreaElement>` and take a surface; `sync(el)` becomes `sync()`.
- Keys: the hooks only use `key`, the modifier flags, `repeat`, `isComposing` and `preventDefault`, so they take a
  small `EditorKeyEvent` that both a React textarea event and a native event satisfy.
- **Key precedence.** In CodeMirror the Markdown keymap owns Enter (continue a list), Tab (our `insertTab`) and the
  arrows. The feature handler is registered with `Prec.highest(EditorView.domEventHandlers({ keydown }))` and
  returns `true` when it called `preventDefault`, so a menu that is open gets the key first, exactly as the
  textarea's `onKeyDown` does today.
- **React ↔ CodeMirror.** CodeMirror is built once, so handlers it calls are read from a ref updated each render
  (the pattern `onChange` already uses in `LiveEditor`). The menus' ARIA attributes (`aria-controls`,
  `aria-activedescendant`, `aria-keyshortcuts`) go onto `.cm-content` through a `Compartment` around
  `EditorView.contentAttributes`.
- The menus render inside the Live host, which is `relative`, like the textarea's wrapper.

## Build order

Step 0 and Step 1 come first and are not features; Steps 2 to 7 each leave the Live tab strictly better and can
ship alone (Step 6 needs Step 5's tint). They all touch the wiring in `MarkdownEditor.tsx` and `LiveEditor.tsx`, so build them one after the
other, not in parallel branches.

### Step 0: the surface, with no change in behaviour

- Add `editorSurface.ts` (the interface and `textareaSurface`); change `placeMenu`, `useMdxCompletion`,
  `useNoteLinkPicker`, `useImagePicker` and `useHighlightMenu` to take a surface and an `EditorKeyEvent`.
- Gather the feature hooks and their key, selection and blur wiring in one `useEditorFeatures(surface, …)` so
  `MarkdownEditor` and the Live view share it, instead of the textarea's long prop list.
- **Built (2026-11-03).** `editorSurface.ts` holds the interface, `EditorKeyEvent` and `fromReactKey`,
  `useTextareaSurface` (a hook, because the lint rule against reading refs during render allows refs to be passed
  to hooks only), and `placeMenu`, which moved here from `useMdxCompletion`. The four hooks take a surface and
  return `aria` plus plain `onKeyDown/onSelect/onScroll/onFocus/onBlur/sync` functions instead of `textareaProps`;
  `useEditorFeatures.ts` gathers them. `replace` is the surface's, so the hooks no longer take an `insert`
  callback.
- **Gate A:** the seven existing `MarkdownEditor.*` suites, `NoteFind`, `reflowText` and the rest pass with only
  signature changes in the tests. Nothing in the Live tab changes yet.

### Step 1: a parity test harness

- A helper that renders the editor on `markdown` or `live` and offers one driver for both: `type(text)`,
  `press(key, modifiers)`, `select(from, to)`, `text()`, `caret()`, `menu()`. The textarea driver is what the
  tests do now; the Live driver dispatches transactions with `userEvent: "input.type"` and sends real
  `KeyboardEvent`s to `.cm-content`.
- Convert the scenarios that exercise the features above to `describe.each(["markdown", "live"])`, a suite at a
  time as each step lands (the 29 note-link, 17 image-picker, 35 highlight, 8 writing and 9 draw.io tests are the
  main source). Behaviour that is deliberately different (below) gets its own test.
- **Built (2026-11-03).** `parityHarness.tsx` has `renderEditor(mode, options)`, returning an `EditorDriver`
  (`type`, `select`, `press`, `blur`, `text`, `caret`, `selection`, `element`, `reported`) for the textarea and
  for CodeMirror, and `describeParity(title, define)`, which runs the scenarios once per editor. A scenario that
  the live editor cannot do yet is written with `{ pendingInLive: "Step N: …" }`: it runs there as vitest's
  `it.fails`, so it is red the moment the feature arrives, and the marker has to come off. A scenario that differs
  on purpose checks `mode` and says why (see "leaves Enter alone when the menu is closed"). The MDX completion
  suite is converted (`MarkdownEditor.completion.test.tsx`, moved out of `MarkdownEditor.test.tsx`): 22 scenarios
  pass, 10 are pending in live until Step 3. The driver has tests of its own (`parityHarness.test.tsx`).
- **What the harness found at once:** Tab with a selection indented the line in Live (CodeMirror's `insertTab`)
  where the Markdown tab replaces the selection with a tab. Fixed in `LiveEditor.tsx`.
- Scenarios that only say a menu stays shut pass in Live today because nothing there opens one; the scenario
  that opens a menu, pending beside them, is what shows it is missing.
- **Gate B:** the harness runs one converted suite in both modes and fails when the Live behaviour is broken on
  purpose. Passed: it found the Tab difference above, and a pending marker on a scenario that already passes in
  Live turns red ("Expect test to fail").

### Step 2: images (paste, picker, Image → `<Image />`)

- Extract the upload flow from `MarkdownEditor` into `useImageUpload(surface)`: placeholder
  (`[Uploading name (n)…]`), size limit, error line, and resolving the placeholder when the upload ends. It
  resolves through `surface.replace`, keeping the caret where the user left it.
- Paste: `EditorView.domEventHandlers({ paste })`, with the same rule as now (images only when the clipboard has no
  text).
- `useImagePicker` (Ctrl/Cmd+Shift+M) and `convertImagesToMdx` (Ctrl/Cmd+Shift+X) move onto the surface; the
  latter becomes one `replace`.
- **Care:** the picker swallows printable keys into its filter. That works by cancelling `keydown`, which is also
  how it works in the textarea; it is unreliable under IME and on Android keyboards in both editors, and stays so.
- **Gate C:** the image suites pass in both modes; paste a picture in Live and see the placeholder, the upload and
  the final `![alt](app_data/…)`, with the caret still after it.

### Step 3: MDX completion

- `useMdxCompletion` on the surface; `<`, props inside a tag, frontmatter keys and snippets, with Tab and Enter
  accepting and Escape dismissing.
- `liveSurface.coordsAt` has to handle the caret sitting right after a hidden mark; completion only opens on
  typed text, where nothing is hidden, so this is a check rather than a fix.
- **Gate D:** the completion tests (in `MarkdownEditor.test.tsx`) pass in both modes; the menu sits under the
  caret in a scrolled, wrapped note.

### Step 4: note-link picker

- `[[` and Ctrl/Cmd+Shift+K on the surface. The shortcut's session mode (typing filters the menu, not the note)
  uses the same key swallowing as the image picker.
- **Gate E:** the 29 note-link tests pass in both modes.

### Step 5: highlight menu and its tint

- `useHighlightMenu` and `applyHighlight` on the surface (`applyHighlight`'s `execCommand` and fallback paths go;
  a single `replace` with the new selection is one undo step).
- Tint: the plain editor paints the text between `<Mark color="…">` tags in that colour, so a highlight is
  visible there. Live gets the same, from `markTints`. **My pick:** reuse the plain editor's tokenizer for this, under
  its existing 100,000-character guard, rather than writing it again from the syntax tree.
- **Gate F:** the 35 highlight tests pass in both modes; highlighting a selection in Live shows the colour.

### Step 6: hide the `<Mark>` tags (Live only)

The Live idea applied to highlights: a highlighted passage is drawn in its colour with its `<Mark color="…">` and
`</Mark>` tags hidden, and the tags come back, dimmed, while the caret or a selection touches the highlight, as
`**` does. The Markdown tab does not do this, so it is not a parity item and has no both-editors test.

- Where the tags are: the same scan that finds the tinted text (`markTints`), extended to return each tag's range
  beside the text's, because that scan is already how the plain editor finds highlights, including inside bold and
  links. I have not checked how Lezer parses inline `<Mark>` tags, so the syntax tree is not relied on.
- Rule: an element is touched when the selection reaches anywhere from its opening tag to its closing tag, ends
  included, so the tags stay visible for as long as the caret is inside a highlight. Nested highlights are each
  judged on their own. Tags in code and frontmatter are left alone, as `markTints` already does. A tag left open,
  or closed twice, is not hidden (nothing is tinted either), so a half-typed `<Mark` is never lost from sight.
- Two things to confirm in the browser: the highlight menu's recolour/remove (it opens with only a caret, inside a
  highlight) still works, since the caret inside a highlight shows the tags; and a freshly highlighted selection
  stays selected, so its tags are shown until the caret moves on.
- Copying a selection copies the source, tags included, as it does for `**`.
- **Gate G:** unit tests in the style of `liveMarkdown.test.ts` (hidden when the caret is elsewhere, shown when
  inside or right after, half-typed and unbalanced tags untouched, code and frontmatter skipped), and a look at it
  in the browser.

### Step 7: ruler and reflow

- **Reflow** (`reflowAtCaret`, pure) runs as a CodeMirror `transactionExtender`: after a single typed character
  (`isUserEvent("input.type")` and not `input.type.compose`; the textarea checks `inputType === "insertText"`), it
  adds the break to the same transaction. Paste, drop, delete and undo are left alone. The settings (enabled,
  column, keep tables) reach it through a `Compartment`.
  **My pick:** the typed character and its break are one undo step. The textarea makes the break a step of its
  own; one step is the better behaviour and CodeMirror gives it for free. It is a difference, and the tests say so.
- **Ruler:** a line at `calc(1rem + Nch)`, as now. The Live tab sets its text in the preview font, which is
  proportional, so `ch` is the width of a `0`, not of an average letter: the ruler is approximate, while reflow is
  exact (it counts characters, hidden marks included, because that is what the file holds). The owner accepted
  this; the manual script says so, so nobody reports it as a bug.
- **Gate H:** the writing tests pass in both modes; reflow in Live produces the same text as in the Markdown
  tab for the same typing.

### Step 8: what is left, then the switch

- Draw.io shortcut (Ctrl/Cmd+Shift+D) and the edit-notice line (the red "why that didn't happen" message) in Live.
- Syntax colours for code, fences, URLs and tags, so a note does not look plainer in Live than in the Markdown tab.
  **My pick:** decorations by syntax-tree node name using the same `--syntax-*` colours, not a new dependency.
- Accessibility pass: the label, the `aria-controls`/`aria-activedescendant` wiring on `.cm-content`, focus
  return after each menu.
- A by-hand test script, `docs/manual-tests/live-editor.md`, in the style of the others, covering what jsdom
  cannot: IME composition, the macOS and Windows keys, a real paste of an image, menu placement in a long note.
- **Gate I (the owner's):** the manual script passes on the desktop app. Only then is "make Live the default"
  worth deciding, and that decision (a setting, a per-notebook choice, or a one-line change to the starting view in
  `initialPanes` and the `note` kind) is its own small piece of work.

## Differences that will remain, on purpose

- Live keeps no undo history across a switch of tab: its editor is mounted only while shown, and the textarea
  keeps its own. Keeping both mounted would make two histories fight over one text. (Accepted by the owner.)
- The ruler is approximate in a proportional font; reflow is not.
- Reflow's break joins the typed character's undo step.
- Text is drawn with the preview font, not the editor font, so it reads like the preview.
- `<Mark>` tags are hidden away from the caret in Live (Step 6); the Markdown tab shows them always.

## Risks

- **Key handling under IME and mobile keyboards** (the picker sessions, `isComposing`). Same limits as today, but
  CodeMirror reads input differently, so Gate I checks it by hand.
- **`coordsAtPos` in a scrolled, wrapped note** next to the viewport edge: menu placement is the one thing both
  editors compute differently. Covered by the Step 3 gate.
- **Fighting the Markdown keymap:** if a handler forgets to return `true`, Enter continues a list under an open
  menu. The harness has a test per key per menu.
- **Bundle size:** `@codemirror/lang-markdown` depends on `@codemirror/lang-html`, which brings the CSS and
  JavaScript language packages with it, so they ship whether or not we use them. It is not a problem for the
  desktop app; measure the web build before deciding it matters. There is no setting to leave them out.

## Decided by the owner (2026-11-03)

1. **Approach:** the shared adapter, so the existing hooks and menus drive both editors.
2. **Ruler font:** keep the preview font in Live; the ruler is approximate there and reflow is exact.
3. **Mark tags:** hide them away from the caret in Live. Added as Step 6.
4. **Undo across tabs:** Live's history is lost on a switch of tab; the editor is not kept mounted while hidden.
