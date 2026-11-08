# Manual test: reading, marking up and citing a PDF

A walkthrough to run by hand in the desktop app: **Gate P1** of [pdf-markup-plan.md](../pdf-markup-plan.md). `pnpm --dir apps/desktop smoke:pdf`
drives the real app against a small PDF the script writes itself (import, ranges under the security policy, the reader, marks and undo,
citations and following a link, the Notes tab, export native and flattened read back, delete and the Trash Can, restart). What it cannot
see is what this is for: a **real textbook**, a **real manual**, how it looks and feels, and other apps' reading of an export. What the
feature does: [ui/pdf.md](../ui/pdf.md). How it works: [architecture/pdf.md](../architecture/pdf.md).

Use a scratch home so your own notes and settings are not touched:
`HOME=$(mktemp -d) pnpm --dir apps/desktop dev` (or an installed build; then back up first). You need:

- **A textbook**: 300 pages or more and as large as you have (50 to 300 MB is the target), with a table of contents, front matter whose
  printed page numbers are not the physical ones (roman numerals, then 1), two-column pages if you can, and a figure-heavy chapter.
- **A manual or specification**: ideally a few thousand pages, the biggest you have.
- Optionally a **scanned** book (to see what it does with no text), a **password-protected** PDF, and a **rotated** page or two.
- **Acrobat Reader, Preview or another PDF app** to open exports in.

## 1. Import

- [ ] **+ Import PDF…** (under the note list). Pick the textbook. A note titled from the file's name appears with a PDF icon, at the top level of the notebook you were looking at, and a PDF panel opens to the left of its note.
- [ ] The first page appears at once (a big file must not make you wait for all of it). Note how long it took, and the app's memory in Activity Monitor or Task Manager.
- [ ] Import the **same file again** (rename the copy first): a dialog names the note that has it; **Import a separate copy** makes a second note, **Open it** only opens the first. Cancel does nothing.
- [ ] **File > Import PDF…** (top of the File menu, with a line under it): the picker opens; pick a PDF and it is imported at the notebook's top level. Open a group's page (click its name) and use the menu again: the PDF goes into that group. With a pop-out in front, the main window comes forward first. Cancel the picker: nothing happens.
- [ ] **Drag a PDF in** from Finder or Explorer. Over a group: the row lights up; drop, and the new note is in that group. Over the note editor or anywhere else in the window: a hint names where it will go; drop, and it lands in the open group page, else the notebook's top level. Drop two PDFs at once: the first is imported and a message says to drop the others again.
- [ ] Drag the **same file** in again: the same question as the button (Open it, Import a separate copy). Drag a `.txt`, or a PDF out of a web page, or the library's own file from `~/.composition/documents/`: nothing is imported (the last two say why).
- [ ] **The PDF's own title:** import a PDF that has a title in its metadata (most published books and papers do; Preview's or Acrobat's Document Properties shows it). Its note is first titled from the file's name and, as the reader opens, takes the PDF's title. Rename that note, close and reopen the PDF: your name stays. Import a PDF with no title, or a title that is a file name or "Untitled": the note keeps the file's name.
- [ ] Try a file that is not a PDF (rename a `.txt` to `.pdf`): it is refused with a reason, and no note is left behind.
- [ ] The password-protected PDF: it imports, and as its panel opens a dialog asks for the password (naming the file, and saying it is kept in memory only). A wrong password says so and asks again; the right one shows the pages. **Cancel** leaves the panel saying it is protected, with **Enter password…**. Close the PDF's panel and open the note again: no question. Quit and relaunch, and open it: the question again.
- [ ] Close the app and look in `~/.composition/documents/`: one file per PDF, named with 12 hex digits and the file's name. Your original is untouched.

## 2. Reading

- [ ] Scroll the textbook from start to end, fast and slowly. Pages appear as they come into view; scrolling stays smooth; text is sharp when you stop. Memory grows with how far you read, not with the file's size at once.
- [ ] **Zoom in / out** and **Fit to width**: pages redraw sharp; the position holds.
- [ ] The **page box**: type 100 and press Enter. In the front matter, the box shows the **printed** number in brackets (`(page iv)`), and the physical number is the one that counts for going to a page. Enter with nothing typed stays put.
- [ ] **Sidebar → Outline**: the table of contents is a tree; folding works; a click goes to the chapter (even a deep, far-away one: no wait of seconds on the big file).
- [ ] **Find in this PDF** (**Cmd/Ctrl+F**): a word on a late page is found, `3 of 17` counts the matches, Enter and Shift+Enter step, Esc closes. A word that is not there says "Not found".
- [ ] **Dark pages**: pages invert; text stays readable; figures look right (note any that do not). Turn it off.
- [ ] Open the **manual**: the first page appears quickly. Jump to page 2000 with the box, and to the middle of it with the outline.
- [ ] A **rotated page**: it is drawn rotated as the PDF says, and the page box counts it as one page.
- [ ] The **scanned book**: pages show as images; Find finds nothing and says so; marks by text selection are not possible, and text notes still are.
- [ ] Close and reopen the app: the PDF opens on the page you left, at the zoom you left, with dark pages as you had it.

## 3. Bookmarks

- [ ] **Bookmark this page** on three pages: the Bookmarks tab opens and lists them by page. Rename one (the pencil) and press Enter. Remove one (the trash). Click one to go to it.
- [ ] Quit and relaunch: the bookmarks are there.

## 4. Marks

- [ ] Select a line of the textbook: a small bar appears with five colors and highlight, underline and strikethrough. Click **Highlight**: the line is tinted, the text under it still readable. Scroll away and back; zoom; the highlight stays on its words.
- [ ] Select with the keys instead: **Cmd/Ctrl+Shift+H**, **U**, **S** each mark the selection. Without a selection they do nothing.
- [ ] Select **two lines**, then **part of a line** from the middle of a word: each mark covers what you selected, a rectangle per line, not a bar across the page.
- [ ] A **two-column page**: select down one column; the highlight stays in that column and does not run across the gutter. Select from the bottom of column one to the top of column two and note what happens.
- [ ] A selection that runs **over a page break**: one mark on each page. **Undo** takes back both; **Redo** puts them back. Delete one part (click it, trash): both parts go.
- [ ] Pick **blue** in the bar and mark another line: it is blue, and the next one is blue too (the last color is kept).
- [ ] **Click a highlight**: a card opens with five colors, a comment box, **Quote in the note** and a trash. Recolor it; type a comment and press Enter; click away. Click it again: the comment is there.
- [ ] **Add a text note**: click the button, then click in the margin. Type, including `Café ≤ Привет`; press **Ctrl/Cmd+Enter**. The note is drawn at the click, in a color, with its words. Double-click it, change the words, leave: it is retyped. Clear all its words and leave: it is deleted.
- [ ] Press **Esc** while placing a note: nothing is placed.
- [ ] **Undo** (button and **Cmd/Ctrl+Z**) steps back through the last marks, recolors and comments; **Redo** (**Cmd/Ctrl+Shift+Z**, **Ctrl+Y**) forwards. Delete a mark and undo it: it comes back exactly as it was.
- [ ] In the page box, press **Cmd/Ctrl+Z**: it undoes the box's own typing, not a mark.
- [ ] With **dark pages** on, a highlight is a visible colored bar behind the words (not just tinted letters).
- [ ] Quit and relaunch: every mark is where you left it, with its comment. (Undo history does not survive: expected.)

## 5. The Highlights tab

- [ ] **Sidebar → Highlights**: every mark by page, with its words and comment; a text note shows its own words. Click a row: the reader goes to it, on the big file too.
- [ ] Click a row's comment and edit it; the trash deletes (and **Undo** brings it back).
- [ ] Type in **Filter highlights**: the list narrows to marks whose words, comment or note say it; a word in none says "No highlight says that."

## 6. Notes beside the PDF

- [ ] With the PDF and its note open, click a highlight's **Quote in the note** (in its card, and in the Highlights tab). A block quote with a citation under it appears in the note at the end (you have not been in it yet). The words are the marked words; the citation reads `Title, p. N` with the **printed** page, and is a link.
- [ ] Click in the middle of a paragraph of the note, then Quote another highlight: it lands at the caret, set apart by blank lines, with the caret under it; nothing is inserted inside the frontmatter.
- [ ] Quote a passage that contains `*`, `_`, `<`, `#` or a `[` (a code sample from the manual): the note shows the characters literally, and the preview shows no formatting or error.
- [ ] **Cite this page** (the link icon): a link to the page you are on is put in the note at the caret, inline.
- [ ] Switch the note to **Preview**: the quote and the citations are links. Scroll the PDF to page 1 and click a citation: the PDF goes to its page and the marked words **flash**. Click a page-only citation: it goes to the page.
- [ ] Delete the highlight a citation names, then click the citation: it still goes to the page.
- [ ] Close the PDF panel (keep the note) and click a citation: a PDF panel opens to the left of the note, at the page.
- [ ] **Sidebar → Notes**: the PDF's own note is first, with "This PDF's own note"; a note that cites it says how many pages. Click it: it shows in the note panel beside the PDF, and Quote now writes there.
- [ ] **New note for this PDF**: "Notes on …" appears in the same group, its first line a link to the PDF, shown beside the PDF.
- [ ] Open **two chapters' notes** side by side. Hover the **Follow the note in use** button and read which note it quotes into. Turn it on, click in the other note, Quote: it goes to the note you used last. Turn it off: it is pinned to the note it was paired with.
- [ ] With **no note** open beside the PDF (close the note panel), click Cite this page: the reader says to open a note, and writes nothing.
- [ ] In the web build (`pnpm --dir apps/web dev`, same database) or the terminal app: the citations are plain text (web: struck through, "PDF not on this device") and nothing breaks.

## 7. Export annotated PDF

- [ ] Click **Export annotated PDF**. The dialog explains flattening; **Flatten markup** is off. **Cancel** does nothing.
- [ ] **Export…**: the system's save dialog suggests the file's name with `(annotated)`. Cancel it: nothing happens and no message. Choose a folder and save: the reader says **Exporting…** and then `Saved “… (annotated).pdf” with N marks.`. The app stays responsive while it runs; time a big file.
- [ ] Open the copy in **Preview** and in **Acrobat Reader**: highlights, underlines and strikethroughs are where they were on the page, in their colors; the text note shows its words; they can be selected and edited (they are annotations); hovering a highlight with a comment shows the comment.
- [ ] Export again with **Flatten markup** ticked and open that: everything looks the same, but nothing can be selected or edited, and it looks the same in both apps.
- [ ] Include a text note on a **rotated page** and in **Greek or Cyrillic** (`Привет`, `Ωμέγα`) and with `≤ ≠ → √`: it reads upright and the characters are right in both apps.
- [ ] Add a text note with `日本語` or an emoji and export: the export **stops**, naming the note's page and the characters, and no file is written. Change the note and export again.
- [ ] Try to save over **the library's own file** (`~/.composition/documents/…`): refused with a reason; the file is untouched.
- [ ] Mark the password-protected PDF and export it: the dialog says the copy is protected with the same password. Open the copy in Preview or Acrobat: it asks for that password and shows your marks. If the original limited printing or copying, check the copy's limits are the same.
- [ ] The manual, with a few marks on a late page: exports in seconds; the copy opens at that page's marks. Watch the memory the export uses; note it and the file sizes.
- [ ] Compare the original and the copy: the original is byte-identical to what you imported (`shasum`), and the library's file too.

## 8. Search

- [ ] Highlight a distinctive phrase and give a highlight a comment word nothing else contains. Search for each in the search bar: the PDF's note is found, as if the words were in it. Search for a word that only appears in the PDF's text but is not marked: no result (expected; the full text is not searched).
- [ ] Bookmark a page with a label and search the label: found.
- [ ] Delete the highlight: the search no longer finds the note by its words (give it a moment).

## 9. Delete, Trash Can, backup

- [ ] Delete the textbook's note: the dialog names the PDF's size, its marks by kind, its bookmarks and how many notes cite it, and says its quotes stay.
- [ ] **Settings → Trash Can**: the row shows the same counts and "permanently deleted in 60 days". The PDF's file is still in `documents/`. **Restore**: the note, the PDF, the marks and the bookmarks are back.
- [ ] Open a note that cites the PDF while it is in the Trash Can: its citations are struck through. Restore the PDF: they work again.
- [ ] Delete it again and delete it **for good** from the Trash Can: the file leaves `documents/`.
- [ ] **Settings → Create backup**, then restore it into a scratch home: the PDF, its marks, its bookmarks and your notes' citations are all there and work. (Backup size grows by the PDFs: expected.)

## 10. Other things to try

- [ ] Open the PDF in a **pop-out window** (**Move to new window**): it reads, marks and quotes there; the note beside it in the main window gets the quote.
- [ ] **Resize the panel** narrow (under 600 px): the sidebar covers the pages instead of squeezing them, and closes again.
- [ ] Press **Cmd/Ctrl+/**: the shortcuts window has a **Reading a PDF** group with the keys above.
- [ ] Windows and Linux builds, when you have them: the keys (`Ctrl` for `Cmd`), the save dialog, and the export worker starting from the installed app.
- [ ] Anything that felt slow, wrong or ugly: write it down with the file's size and page count.
