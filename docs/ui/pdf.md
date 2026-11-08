# Reading and marking up a PDF

Source: [`PdfReader.tsx`](../../apps/web/src/components/pdf/PdfReader.tsx) (the reader),
[`PdfSidebar.tsx`](../../apps/web/src/components/pdf/PdfSidebar.tsx) (outline, bookmarks, highlights, notes),
[`PdfMarkLayers.tsx`](../../apps/web/src/components/pdf/PdfMarkLayers.tsx) (marks drawn over the pages),
[`useMarkEditing.ts`](../../apps/web/src/components/pdf/useMarkEditing.ts) and
[`selectionMarks.ts`](../../apps/web/src/components/pdf/selectionMarks.ts) (making and changing marks),
[`ExportPdfDialog.tsx`](../../apps/web/src/components/pdf/ExportPdfDialog.tsx),
[`pdfRefs.ts`](../../apps/web/src/lib/composition/pdfRefs.ts) (citations),
[`pdfExport.ts`](../../apps/web/src/lib/composition/pdfExport.ts) (export) — **desktop app only**. How it works inside:
[architecture/pdf.md](../architecture/pdf.md). The design and the reasons behind it: [pdf-markup-plan.md](../pdf-markup-plan.md).
To check it by hand: [manual-tests/pdf.md](../manual-tests/pdf.md).

Import a PDF, read it with your notes beside it, mark it up, keep bookmarks, and cite it from your notes. Two uses it is built
for: studying a textbook (read, mark the page as you would a printed book, take notes on the side, a note per chapter if you like),
and reading technical documentation (mark the passages that matter and write notes that lead back to the exact spot).

The web app and the terminal app have no reader. They keep the PDF's note and its text, and show a `pdf:` link as struck-through text.

## A PDF is a note that owns a PDF

Importing a PDF makes a note, titled from the file's name (underscores read as spaces, `Designing_Data.pdf` is "Designing Data"), and attaches
the file to it. **When the PDF opens and has a title of its own in its metadata, the note takes that title** ("Designing Data-Intensive
Applications" instead of "Designing Data"), once: only a note that still has the title made from the file's name is retitled, so a title you
typed is never replaced, and renaming it later sticks. A title that is not a real one is passed over: a placeholder such as "Untitled" or
"Document1", a file name such as "report.docx", garbled text, or more than 200 characters. The note sits in the notebook tree like any other:
it has a PDF icon, it can be put in a group, favorited, found by title, and deleted to the Trash Can. Its text starts empty; write in it as in
any note.

- **Import:** **+ Import PDF…** under the note list opens the system's file picker. The file must look like a PDF and be at most 1 GB.
  The file is **copied** into the app's data folder; the original is left alone and never changed. A new row appears at the top level of
  the notebook you are looking at, and the PDF and its note open.
- **File > Import PDF…:** the same picker, from the menu bar, at the top of the File menu. It goes where the sidebar is: into the group whose
  page is open, else the top level of the notebook you are looking at (the button under the note list always uses the top level). It brings
  the main window forward first, so it works from a pop-out too. With the Settings page showing, the menu item does nothing: go back to the notes first.
- **Drag a PDF in:** drag a `.pdf` from Finder, Explorer or your file manager and drop it **on a group** in the sidebar (the row lights up)
  or on **Ungrouped**, and the new row lands in that group. Drop it **anywhere else in the window**, the note editor included, and it
  lands where the sidebar is: in the group whose page is open, else at the top level of the notebook. While a PDF is over the window, a hint
  says where it will go. It then goes through the same checks and the same duplicate question as the button. One PDF at a time: if you
  drop several, the first is imported and a message says to drop the others again. A file that is not a PDF is left alone, a PDF from
  inside Composition's own data folder is refused (it is already in the library), and so is a file dragged out of a web page, which has
  no place on your disk.
- **A PDF you already have:** if the file's contents are the same as one in the library, a dialog says which note has it and offers
  **Open it** or **Import a separate copy**. Nothing is imported until you choose.
- **Your marks are not written into the file.** They are kept beside it, so the PDF stays exactly as you imported it. **Export annotated
  PDF** (below) writes a copy with the marks in it, for other apps.

## Opening a PDF

Picking a PDF's row opens **two panels**: the PDF on the left, focused (reading comes first), and its note on the right. If they are
already open it only focuses the PDF. They are ordinary [panels](panels.md): split them, move them, pop them out; they are saved with
the layout. The PDF panel is **paired** with a note, as the [AI helper](ai-helper.md) is: it starts paired with its own note, and
**Quote** and **Cite this page** write to the note it is paired with (see [The pairing](#the-pairing)).

Where you were in the PDF, the zoom and whether dark pages is on are remembered for each PDF, and come back after you close the app.

## The reader

The bar above the pages, from the left:

| Control | What it does |
|---|---|
| Sidebar | Shows or hides the outline, bookmarks, highlights and notes. In a panel narrower than 600 px it covers the pages instead of squeezing them. |
| Page box | The page you are on. Type a number and press **Enter** to go to it; **Esc** gives up. Beside it, `of 412`, and the **printed** page number in brackets when the PDF has page labels (a textbook's front matter makes the 44th page "page 42"). |
| Zoom out / in, Fit to width | Fit to width is how a PDF first opens. |
| Undo, Redo | Take back or put back the last change to the marks (below). |
| Add a text note | Click it, then click where the note goes on a page. |
| Cite this page | Puts a link to this page into the paired note. Shown when the PDF is paired with notes. |
| Follow the note in use | Switches between quoting into one note and into the note you used last. See [The pairing](#the-pairing). |
| Find in this PDF | A find bar over the whole PDF: Enter for the next match, Shift+Enter for the previous, Esc to close. **Cmd/Ctrl+F** opens it. |
| Export annotated PDF | Saves a copy with your marks in it. See [Export](#export-annotated-pdf). |
| Bookmark this page | Adds a bookmark for the page you are on and opens the Bookmarks tab. |
| Dark pages | Inverts the pages' colors, for reading at night. Your marks keep their own colors, and an export keeps the original's. Off by default. |

Pages are drawn as they scroll into view, so a 300 MB textbook opens at once and uses memory in step with how far you read.

## The sidebar

- **Outline:** the PDF's own table of contents, as a tree whose branches fold. A click goes to the entry. A PDF with none says so.
- **Bookmarks:** a page and an optional label. Click to go there; the pencil renames it and the trash removes it. Where the reader is left is *not* a
  bookmark; it is remembered on its own.
- **Highlights:** every mark of the PDF by page, with its words and comment. See [Marks](#marks).
- **Notes:** the PDF's own note first, then every note that links to it. See [Notes and citations](#notes-and-citations).

## Marks

Marks are drawn over the page and stored as records beside the file. There are three that mark text, and typed notes:

| Mark | How to make it |
|---|---|
| **Highlight, underline, strikethrough** | Select text on a page. A small bar appears by the selection: five colors (the `<Mark>` colors: yellow, green, blue, pink, orange) and the three buttons. The color you picked last is the one used next, and the same one the editor's highlight menu starts on. |
| **Text note** | **Add a text note**, then click where it goes (the margin is fine). Type, and leave the box by clicking elsewhere or **Ctrl/Cmd+Enter** (**Enter** writes a new line, **Esc** drops the change). A note with no words in it is not kept. Double-click a note to retype it. |

A selection that runs over several pages is one mark on each page, kept together: one **Undo** takes back all of it, and deleting one
part deletes the whole highlight. Ink (written with the Apple Pencil) arrives with the iPad app; it is not drawn here yet.

**Click a mark** and a small card opens by it: the five colors (click one to recolor), a one-line comment (up to 500 characters),
**Quote in the note**, and a trash button. **Delete** or **Backspace** deletes the selected mark; **Esc** lets go of it. A mark takes no
mouse of its own, so the words under a highlight stay selectable.

### Keys

| Keys | Does |
|---|---|
| **Cmd/Ctrl+Shift+H** | Highlight the selected text |
| **Cmd/Ctrl+Shift+U** | Underline it |
| **Cmd/Ctrl+Shift+S** | Strike it through |
| **Cmd/Ctrl+Z** | Undo the last change to the marks |
| **Cmd/Ctrl+Shift+Z**, **Ctrl+Y** | Redo it |
| **Delete**, **Backspace** | Delete the selected mark |
| **Esc** | Let go of the selected mark, or give up placing a text note |
| **Cmd/Ctrl+F** | Find in the PDF |

They are listed in the shortcuts window (**Cmd/Ctrl+/**) under "Reading a PDF". None applies while you are typing in a box.

### Undo and redo

Undo and redo cover making, recoloring, commenting on, retyping, and deleting marks, one PDF at a time, up to 200 steps. They last
**until the app is closed**: the history is not stored. Undoing a delete brings the mark back exactly as it was, so a note's
citation of it still works.

### The Highlights tab

Marks are listed by page, with their words (a text note shows its own words) and comment. Click one to go to it; click the comment to
edit it; the trash deletes. **Filter highlights** narrows the list to the marks whose words, comment or note say what you type. A small
quote icon marks a highlight that a note already quotes, and says which notes. **Quote** (on a row, as it appears) puts it into the
paired note.

## Notes and citations

A **citation** is ordinary Markdown in your note whose target names the PDF by its id, and a page and a mark on it:

```md
> Data outlives code.
>
> — [*Designing Data*, p. 42](pdf:3f9c2a71b0de4c1e8a2d5b6f7e8d9c0a#p=44&a=7b1d…)
```

`p` is the **physical** page (counted from 1), `a` is the mark's id, and both are optional; the words in the brackets show the printed
page label when the PDF has one. The PDF is named by an id that never changes, not by its title, so renaming it breaks nothing. Because
a citation is plain text, it is found by searching your notes, and it survives on the web and in the terminal as text.

- **Quote:** the quote button in a mark's card, or on its row in the Highlights tab, puts the marked words into the paired note as a
  block quote with a citation under it. The words are *copied*, so the note still reads if the PDF is gone. They go in at the note's
  caret, as typing would; if you have not been in that note yet, or it is not open, at the end of it. Never inside the frontmatter. The
  PDF's punctuation is made literal, so a `*` or `<` in a textbook starts no formatting.
- **Cite this page:** the link icon in the reader's bar puts just a link to the page you are on, in the words around the caret.
- **Following a link:** click it in the note's **Preview**. The PDF panel shows that page and **flashes the mark** the link names for a
  moment. If the window has no panel for that PDF, one opens to the left of the note, paired with it, and the note stays where it is.
  A link to a mark since deleted still goes to its page. (The editor and the Live tab draw the link like any other; only the preview follows it.)
- **A link whose PDF is gone:** shown struck through, "PDF not on this device", with its words still readable. That is the case for a
  PDF in the Trash Can until you restore it, and everywhere in the web app.
- **Notes tab:** the PDF's own note first, then every note whose text links to it, with how many pages each cites. Click one to show it in
  the note panel beside the PDF (the PDF is then paired with it). **New note for this PDF** makes "Notes on <title>", in the same group,
  whose first line is a link to the PDF.

### The pairing

A PDF panel writes into one note. It is **pinned** to its own note when you open it, and to a note you pick in the Notes tab or make
with **New note for this PDF**. The **Follow the note in use** button switches it to follow the note panel you used last instead, which
is what you want with chapters 3 and 4 open side by side; switch it off to pin it to the note it is paired with now. Hover the button to
see which note Quote goes to. With no note to write in, Quote and Cite this page say so.

## Export annotated PDF

The download icon in the reader's bar saves **a copy** of the PDF with your marks in it, for other apps. The PDF in your library is not
changed, and the export refuses to write over it.

1. A dialog offers **Flatten markup** (off by default). Off, your marks are standard annotations (Highlight, Underline, StrikeOut,
   FreeText) that other apps draw and can still edit. On, they are drawn into the pages: every app shows them the same, and they can no
   longer be edited or removed.
2. **Export…** opens the system's save dialog, suggesting the PDF's name with "(annotated)" added.
3. The reader says **Exporting…**, then "Saved “name” with N marks." A big file takes seconds; it is written by a separate process, so
   the app stays responsive.

What to know:

- **Text notes** are written in Noto Sans, with Noto Sans Math for symbols such as ≤, ≠ and →, so Latin, Greek and Cyrillic letters and
  common math come out right. A note with any other character (Chinese, Japanese, Korean, emoji) **stops the export**, which names the
  note's page and the characters, so nothing is lost silently. Change that note, or delete it, and export again.
- **Ink** (from the iPad) is left out for now, and the message says how many marks were.
- **A password-protected PDF** cannot be exported with its marks. (The reader cannot open one to mark, either.)
- **A signed PDF** loses its signature in the copy, since the whole file is rewritten.
- The copy is written next to its final name and renamed into place, so a failed export never leaves half a PDF behind.

## Finding things

Searching for a word in a highlight, a comment, a text note or a bookmark's label finds the PDF's note, as if the words were in it. Your
own notes are searched as always. Searching the *full text* of every PDF is not built; **Find in this PDF** searches the one you are reading.

## Deleting a PDF

Deleting the note moves it to the [Trash Can](web-trash-can.md) for 60 days, with its PDF, marks and bookmarks. The delete dialog names what
is inside:

> Delete “Designing Data”? It moves to the Trash Can in Settings, where you can restore it, and is permanently deleted after 60 days,
> with its PDF (212 MB), 41 highlights, 2 underlines, 1 text note and 6 bookmarks. 4 notes cite it; their quotes stay and their links
> stop working.

The Trash Can row shows the same counts. Restoring the note brings the PDF and its marks back with it; when the note is deleted for
good, so are the file and its marks.

## Not built yet

a prompt for a password-protected PDF; ink and handwritten notes (the iPad app, milestone M2); the
full text of every PDF in search, and scanned PDFs and OCR. See [pdf-markup-plan.md](../pdf-markup-plan.md#not-in-scope).
