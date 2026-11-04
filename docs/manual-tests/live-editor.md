# Manual test: the Live tab

A walkthrough to run by hand, in the web app and in the desktop app. The unit and component tests run every scenario
of the Markdown tab against the Live tab (see [ui/live-editor.md](../ui/live-editor.md#keeping-it-level-with-the-markdown-tab));
this is what a DOM without a layout engine, a real keyboard, a real clipboard or a screen reader can't check. What the
tab does: [ui/live-editor.md](../ui/live-editor.md). Plan and decisions: [live-editor-parity-plan.md](../live-editor-parity-plan.md).
Passing this is Gate I, the owner's, before the Live tab is considered as a default.

Use a scratch home so your own notes and settings are not touched. Desktop: `HOME=$(mktemp -d) pnpm --dir apps/desktop dev`.
Web: `COMPOSITION_SETTINGS_PATH=$(mktemp -d)/settings.json pnpm --dir apps/web dev`, with a settings file that sets `appDataDir` to a
temporary folder. Make a note and put it on the **Live** tab. Do the keyboard steps with a **real keyboard**, not a tool that
inserts text, which skips key events and so skips the menus' key handling.

## 1. The look

- [ ] Type `**some text**`: the `**` stay while the caret is at the end. Type a space and a word: the marks vanish and "some text" is bold.
- [ ] The same for `*italic*`, `~~struck~~` and `` `code` ``. A lone `**word` stays as typed.
- [ ] Type `# A heading` on its own line, then move to another line: it is large with no `#`. Click into it: the `#` comes back, dimmed. Levels 1 to 6 get smaller.
- [ ] Walk the caret with the arrow keys across `**bold**`: the marks show when the caret reaches the character before it and hide the character after the end. Nothing jumps or skips a character.
- [ ] Click on bold text: the marks appear and the text shifts a little to the right; the caret stays where you clicked.
- [ ] Select from the middle of one bold word to the middle of another: both words show their marks. Copy and paste into the Markdown tab: the marks are in the text.
- [ ] Frontmatter at the top is small and monospaced, and a note with `title: x` frontmatter does not turn the line above its closing `---` into a heading.
- [ ] Code fences, links, lists, quotes and `<Info>` tags are coloured as in the Markdown tab, in light and dark schemes and a scheme with a translucent window.
- [ ] A long note (several thousand lines) types without lag, and scrolling is smooth.

## 2. Highlights

- [ ] Select a word, Cmd/Ctrl+Shift+H, pick a colour: the word is tinted, the tags show while it is selected, then hide once you move the caret away.
- [ ] Put the caret in a highlight, Cmd/Ctrl+Shift+H: the menu offers **Remove highlight**; recolour and remove both work, and one undo takes either back.
- [ ] Highlight inside a bold word, across a line break, and in a list item: the tint and the tags behave.
- [ ] Try to highlight in a note containing a stray `<I` (not valid MDX): the red explanation shows above the editor and the note is unchanged.

## 3. The writing menus

- [ ] Type `<`: the component menu opens under the caret, in the middle of a long wrapped note and near the bottom of the window (where it opens above the line). Arrows, Tab, Enter and Escape work; clicking an option keeps the caret in the editor.
- [ ] Type `<Image ` and `<Image width="`: props and values are offered.
- [ ] Type `[[` and Cmd/Ctrl+Shift+K: the note picker opens; with the shortcut, typing filters the list **without** typing into the note, and Backspace edits the filter.
- [ ] Cmd/Ctrl+Shift+M: the stored images, newest first; typing filters; Enter inserts; selected words become the alt text.
- [ ] With a menu open, press Enter on a line that is a list item: the menu takes the Enter, and a list continues only when no menu is open.
- [ ] Each menu closes when you click elsewhere or leave the editor, and focus is still in the editor afterwards.

## 4. Images and diagrams

- [ ] Copy a screenshot to the clipboard and paste: `[Uploading image (1)…]` appears at the caret at once, then becomes `![image](app_data/…)` with the caret still after it. Paste two at once.
- [ ] Paste a picture and, before it finishes, switch to the Markdown tab and back: it still resolves, in whichever editor you are in.
- [ ] Paste text copied from a spreadsheet: the text pastes, not a picture.
- [ ] Put the caret in `![alt](src)` and press Cmd/Ctrl+Shift+X: it becomes `<Image … />` with the caret ready for another prop; one undo takes it back.
- [ ] Cmd/Ctrl+Shift+D and the **Diagram** button open the diagram editor, and the saved diagram goes in at the caret, as a block of its own.

## 5. Ruler and reflow

- [ ] Settings → Writing: turn on the ruler at 40. The line is drawn in the Live tab (it is approximate: see the note below). Turn on reflow at 40 and type a long sentence: it breaks at 40 characters with the caret staying at the end; a list item's continuation lines up under its text; a table row stays whole.
- [ ] Paste a long line, press Enter in the middle of one, and undo: none of them reflows. One undo removes the typed text and its breaks.
- [ ] Type with an input method (Japanese, Chinese or Korean): the composition is never broken by reflow, and nothing is lost.

## 6. Find, undo, switching

- [ ] Cmd/Ctrl+F with a word selected in the Live tab opens the find bar with that word; matches are highlighted and **Next** scrolls to them; Escape returns the caret to the editor.
- [ ] Cmd/Ctrl+\ and Cmd+Ctrl+Left/Right step Markdown → Preview → Split → Live → Markdown and put the caret back in the editor.
- [ ] Switch tabs while typing: nothing typed is lost, and the Live tab shows what the Markdown tab shows.
- [ ] A note deleted while it is open is read only: you can select and copy but not type.

## 7. Layout and accessibility

- [ ] In a pane narrower than 480 px the Live tab still works (it needs no room beside a preview).
- [ ] With the architect notebook background (Settings → Styling): the grid shows behind the Live tab and every line of text sits on a rule, including after a heading, a blank line and a long wrapped paragraph. Without it, the lines are more spaced out.
- [ ] Tab moves focus to and from the **Live** tab, the arrow keys move between tabs, and Shift+Tab leaves the editor; Tab inside it types a tab.
- [ ] With a screen reader (VoiceOver or NVDA): the editor is announced as a multi-line text box named "Markdown editor". Hidden marks are not read, which is expected; open a menu and its options are announced as you arrow through them.
- [ ] Windows high-contrast mode: the text, caret and selection are visible.

## Known and accepted

The ruler is a guide in a proportional font; undo history starts afresh when you switch to the Live tab; reflow's break joins the
typed character's undo step. They are in the plan under "Differences that will remain".
