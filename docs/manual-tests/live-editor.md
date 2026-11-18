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
- [ ] Code blocks (Gate C): make a note with a ```` ```js ````, a ```` ```python ````, a ```` ```sh ```` and an untagged ```` ``` ```` block, and an indented block. Away from the caret each looks as it does in Preview (open Split to compare): the same background, rounded corners, font, size and colours; no fences; the untagged and indented blocks plain.
- [ ] Click into a code block: both its fences appear, dimmed, and the text you clicked keeps the caret. Click outside: they collapse again. Arrow down into a block from the line above and up into one from the line below: the caret lands on the code, then the fences appear; arrowing on reaches each fence.
- [ ] Type inside a long code block (a couple of hundred lines): the colours follow as you type, with no lag. Type a new ```` ```js ```` block from scratch: it is drawn as a block once its closing fence is typed and the caret leaves it.
- [ ] Change the language on a fence (`js` to `python`) and leave the block: the colours change. A made-up language stays plain.
- [ ] In light and dark schemes the code colours are the ones Preview uses.
- [ ] `<Info>` tags are coloured as in the Markdown tab, in light and dark schemes and a scheme with a translucent window.
- [ ] A long note (several thousand lines) types without lag, and scrolling is smooth.

## 1a. Links

Make a second note to link to, and a note with: `[the docs](https://example.com "Docs")`, a note link from `[[`, a
note link to a note you then delete for good (empty the Trash Can), `<https://example.com>`, a bare `https://example.com`,
`## Next Steps` with `[jump](#next-steps)` above it, and (desktop) a `pdf:` link from a PDF's **Cite this page**.

- [ ] Away from the caret each link reads as its text, underlined in the link colour, with no brackets or address. Put Live and Preview side by side (Split in one pane, Live in another): the links read the same.
- [ ] Hover a link: the tooltip shows its address (and its title, for the first one), with "⌘-click to follow" (Mac) or "Ctrl+click to follow".
- [ ] The link to the deleted note is struck through and muted, with "This note no longer exists"; Cmd/Ctrl+click on it does nothing. In the web app, the `pdf:` link is struck through with "PDF not on this device".
- [ ] Click in a link's text: the caret lands where you clicked and the source shows, `[` `]` `(` `)` dimmed. Nothing opens.
- [ ] Edit the link's text, then its address, with the keyboard: arrow in from either side, type, delete, select a word in the address and retype it. Move away: it is drawn again with the new text, and following it goes to the new address.
- [ ] Do the same with the mouse: click into the address, double-click a word in the text, drag a selection from before the link into it.
- [ ] Hold Cmd (Mac) or Ctrl (Windows, Linux) over a link: the pointer is a hand. Let go: the text cursor is back. Ctrl on a Mac does not change it.
- [ ] Cmd/Ctrl+click the note link: the linked note opens in this pane. Back (Cmd/Ctrl+[) returns. Cmd/Ctrl+Shift+click it: it opens beside.
- [ ] Cmd/Ctrl+click `https://example.com` (each of the three forms): it opens in a new browser tab (web) or your browser (desktop); the app stays put.
- [ ] Cmd/Ctrl+click `[jump](#next-steps)`: Live scrolls to the heading; the caret does not move.
- [ ] Desktop: Cmd/Ctrl+click the `pdf:` link: the PDF opens at that page, beside the note if it was not showing.
- [ ] In Preview: a plain click on the note link follows it, Cmd/Ctrl+click opens it beside, and Cmd/Ctrl+Shift+click opens it beside too.

## 1b. Lists, task lists and quotes (Gate D)

Put this in a note, and open the same note in **Split** beside it to compare with Preview:

```markdown
- First item, long enough to wrap onto a second row when the pane is narrow
- Second item
  - Nested
    - Deeper
* Star item
+ Plus item

1. One
3. Three as written
7) Seven

- [ ] To do
- [x] Done

> A quote long enough to wrap onto a second row
> > Nested quote
lazy line

- Item with a quote
  > quoted inside
```

- [ ] Away from the caret, every `-`, `*` and `+` is a bullet; Nested and Deeper step in a level each, as in Preview, and the first item's second row starts under its text, not under the bullet.
- [ ] The numbers read `1.`, `3.`, `7)` (as written; Preview reads 1, 2, 3 and 1).
- [ ] Click a line: its marks come back as written (`  - Nested`), dimmed colours as in the Markdown tab, and the bullet goes. Click away: the bullet is back.
- [ ] Put the caret on the last line and click the **To do** box: it ticks, the caret is still on the last line, no menu opens, and the Markdown tab shows `- [x] To do`. Cmd/Ctrl+Z unticks it in one step; a second Cmd/Ctrl+Z undoes what you typed before, not the box.
- [ ] Type a word and click a box straight away: one Cmd/Ctrl+Z unticks the box only.
- [ ] Untick **Done** the same way. Right-click and middle-click a box: nothing changes.
- [ ] The quote lines have a bar and an indent, the nested one two bars, the lazy line too, and the `>` shows only on the caret's line. The quote inside the list item has its bar at the item's text.
- [ ] Enter at the end of **Second item**, **Nested**, **Three as written** and **Done**: each continues with `- `, `  - `, `4. ` and `- [ ] `. Enter on an empty item ends the list (an empty second item of a two-item list first adds a blank line; Enter again ends it). Enter at the end of a quote line continues the quote with `> `.
- [ ] Tab and Shift+Tab, and Backspace right after a new `- `, behave as they did before this step.
- [ ] With a screen reader, a list line reads with its `-`, a quote line with its `>`, and a task's box is announced as a checkbox, checked or not.
- [ ] Light and dark schemes, and a translucent window: the bullets, numbers, boxes and bars are visible but quieter than the text.

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
- [ ] When that finishes, the picture itself is drawn in the line (the Markdown is hidden); click it and the Markdown comes back, dimmed, with the picture after it; move away and it is the picture again.
- [ ] Type `<Image src="app_data/…" width="50%" />` (a name from the Images page) and `![x](app_data/nope-0123456789ab.png)`: the first draws at half the note's width, the second says "Image not found: x".
- [ ] Paste a picture and, before it finishes, switch to the Markdown tab and back: it still resolves, in whichever editor you are in.
- [ ] Paste text copied from a spreadsheet: the text pastes, not a picture.
- [ ] Put the caret in `![alt](src)` and press Cmd/Ctrl+Shift+X: it becomes `<Image … />` with the caret ready for another prop; one undo takes it back.
- [ ] Cmd/Ctrl+Shift+D and the **Diagram** button open the diagram editor, and the saved diagram goes in at the caret, as a block of its own.

## 4b. Tables (Gate E)

Use a note with a few tables, one with aligned columns (`|:---|---:|`), a link, inline code and bold in its cells, and
open it in **Split** beside **Live** in another panel to compare.

- [ ] Away from the caret each table reads as in Preview: the same borders, header weight, alignment, link colour and code style, in a light and a dark scheme.
- [ ] Click a cell: the caret goes to the start of the table's source, the source shows, and the drawing sits under it. Click below the table: it is drawn again.
- [ ] From the line above a table, press Down: the caret lands on the table's first line, in its source. Keep pressing Down: it walks the rows, then leaves the table, which is drawn again. The same upwards from the line below, landing on its last row.
- [ ] Shift+Down from the line above selects into the table, and its source shows.
- [ ] Type in a cell: the drawing under the source stays as it was while you type and catches up about a third of a second after you stop. Add a column to the header row first: the drawing stays until you have added it to the delimiter row too, with no flash of plain text.
- [ ] Cmd/Ctrl+Z after typing in a table, and after deleting a whole table, puts it back and it is drawn again.
- [ ] Cmd/Ctrl+F a word that is in a table cell: the table shows its source, the match highlighted; **Next** to a match outside it draws the table again.
- [ ] A note with 50 tables types smoothly above, between and inside them.
- [ ] With VoiceOver, a drawn table is read as a table (rows, columns, cell text). Put the caret in it: the source lines are read, not the table twice.
- [ ] A table inside a list item or a quote is left as written.

## 4c. MDX components (Gate F)

Make a note from the examples in [ui/mdx-components.md](../ui/mdx-components.md): an `<Info>` with bold, a link, a list
and a code fence in it, a `<Warning>`, a `<Drawio>` you drew (so it has a picture), a `<YouTube>`, a `<Repo>`, a
`<Chart>` and a `<Sheet>`. Open it in **Split** beside **Live** in another panel to compare.

- [ ] Away from the caret each component reads as in Preview: the callouts' tint and icon, the list spacing, the code colours in the callout, the diagram, the player, the repository card, the chart and the sheet's grid, in a light and a dark scheme.
- [ ] Click in a callout, the chart, the repository card or the diagram's picture: the caret goes to the start of its source, the whole component shows as Markdown (the lines inside it drawn as Live draws them) and its drawing sits under it. Click below it: it is drawn again.
- [ ] Hover over the diagram and press **Edit diagram**: the draw.io editor opens on it, without the caret moving. Save a change: the note points at the new picture and Live draws it.
- [ ] Hover over the sheet and press **Edit sheet**: the sheet editor opens on that sheet. Change a cell and save: the change is in that sheet's CSV (check the Markdown tab), and the rest of the note is unchanged. With two sheets in the note, each opens its own.
- [ ] Hover over the video and the sheet: an **Edit source** button shows at the top left; it puts the caret in the source. Tab to it from the keyboard and press Enter or Space: the same. Clicks in the player and the grid are theirs (the video plays).
- [ ] In a callout's source type ` {1`: about a third of a second after you stop, the drawing under it becomes a small grey "Not rendered yet: …" line, with no red banner. Delete it again: the callout is drawn again. Leave the caret outside while it is broken: the source stays showing with the note under it.
- [ ] Type a new `<Info>` line by hand above a paragraph: the line shows "Not rendered yet". Type `</Info>` a few paragraphs further down: the whole stretch becomes one callout when the caret leaves it. Delete the closing tag: it lets go again.
- [ ] Insert a component from the `<` menu: it is drawn as soon as the caret leaves it.
- [ ] `<Mark>`, `<Image>` and `<Ink>` are drawn as before, inline; `<Toc />` and `<Footnotes />` are still shown as written (Step 7). A component in a code fence is left as written.
- [ ] Open a note with a code fence only inside a callout, from a fresh reload: the colours appear in the callout once the highlighter has loaded.

## 5. Ruler and reflow

- [ ] Settings → Writing: turn on the ruler at 40. The line is drawn in the Live tab (it is approximate: see the note below). Turn on reflow at 40 and type a long sentence: it breaks at 40 characters with the caret staying at the end; a list item's continuation lines up under its text; a table row stays whole.
- [ ] Paste a long line, press Enter in the middle of one, and undo: none of them reflows. One undo removes the typed text and its breaks.
- [ ] Type with an input method (Japanese, Chinese or Korean): the composition is never broken by reflow, and nothing is lost.

## 6. Find, undo, switching

- [ ] Cmd/Ctrl+F with a word selected in the Live tab opens the find bar with that word; matches are highlighted and **Next** scrolls to them; Escape returns the caret to the editor.
- [ ] Cmd/Ctrl+\ and Cmd+Ctrl+Left/Right step Markdown → Preview → Split → Live → Markdown and put the caret back in the editor.
- [ ] Switch tabs while typing: nothing typed is lost, and the Live tab shows what the Markdown tab shows.
- [ ] Type a few words in Live, switch to Preview, then back to Live: Cmd/Ctrl+Z still undoes those words.
- [ ] Type in Live, switch to Markdown and type there, then back to Live: Cmd/Ctrl+Z does nothing (Live's history started again), and the text is what the Markdown tab shows.
- [ ] Type in Live, then pick another note in the sidebar so it opens in the same pane: Cmd/Ctrl+Z does nothing, and the other note's text is never brought back.
- [ ] Settings → Writing → **Open notes in**: choose Live and go back to your notes. Pick a note in an empty panel and open one to the side: both start on Live. A panel you switched to Preview stays on Preview when you pick another note into it. Choose Split again: a note opened to the side starts on Markdown.
- [ ] A note deleted while it is open is read only: you can select and copy but not type.

## 7. Layout and accessibility

- [ ] In a pane narrower than 480 px the Live tab still works (it needs no room beside a preview).
- [ ] With the architect notebook background (Settings → Styling): the grid shows behind the Live tab and every line of text sits on a rule, including after a heading, a blank line and a long wrapped paragraph. Without it, the lines are more spaced out.
- [ ] Tab moves focus to and from the **Live** tab, the arrow keys move between tabs, and Shift+Tab leaves the editor; Tab inside it types a tab.
- [ ] With a screen reader (VoiceOver or NVDA): the editor is announced as a multi-line text box named "Markdown editor". Hidden marks are not read, which is expected; open a menu and its options are announced as you arrow through them.
- [ ] Windows high-contrast mode: the text, caret and selection are visible.

## 8. Long notes

Make the stress-test notes (`pnpm --dir apps/web stress:db --notes 100 --no-huge --line-notes 2600,10000,26000 --out <folder>`,
see [stress-databases.md](stress-databases.md)) and add a line with three highlights at the end of each `LINES:` note
(on the Markdown tab, or with the highlight menu). Use a production build (`pnpm --dir apps/web build` and `start`).

- [ ] Open `LINES: 10,000 lines` (about 400,000 characters) on Live and press Cmd/Ctrl+End: the last highlights are tinted, their tags hidden, and the code blocks above are coloured.
- [ ] Type a sentence there with a real keyboard: no lag, the tints stay, and putting the caret in a highlight shows its tags.
- [ ] Scroll up through a long code block and back down: tags inside the code are never tinted; the text after the block is coloured as Markdown again.
- [ ] Do the same on `LINES: 26,000 lines` (about 1,000,000 characters). (A note this long is not saved yet: stress-test finding 1. Look, don't keep.)
- [ ] On the Markdown tab the same notes are left uncoloured past 100,000 characters, as before.

## Known and accepted

The ruler is a guide in a proportional font; undo history starts afresh when you switch to the Live tab; reflow's break joins the
typed character's undo step. They are in the plan under "Differences that will remain".
