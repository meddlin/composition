# PDF reading, markup and notes: design and build plan

Import a PDF, mark it up (on the iPad, with the Apple Pencil), keep bookmarks, and read it with your notes beside it. On the
desktop the same PDF opens next to a note you type while you read. Status (2026-11-09): **the desktop side is built, Steps 1 to 6
of the [build order](#build-order)**, and checked by tests and by driving the real app (Gate P1 was the owner's, passed 2026-11-08); **the iPad side is built up to the ink**
(import, the reader, typed marks, the sidebar's Highlights and Notes tabs, Quote, Cite this page, `pdf:` links, search by marks, export annotated, spike B's lab, and ink on the pages), **checked in the iPad Simulator and by `swift test` on a Mac only, never on an iPad**; **Pencil ink on a PDF is built too** ([Ink on the pages](#ink-on-the-pages-2026-11-10); a finger stands in for the Pencil in the Simulator), handwritten notes beside the PDF are not. Gate P2 is the owner's: [manual-tests/ipad.md](manual-tests/ipad.md#pdf-markup-notes-search-export-and-ink-m2-gate-p2), items 268 to 310. The design was decided with the owner in a question-by-question session (the
decisions are in [What is decided](#what-is-decided)); read the sections below as the design, and the build order and change log
for what was found when it was built. Anything marked **my pick** is a judgment the owner has not made; **Inference** is
reasoning from a fact, not a measurement; **unverified** means no source or test confirmed it.

## Goal and use cases

1. **A study tool.** Read a PDF textbook, mark the page as you would a printed book, and take notes on the side, one note per
   chapter if you like.
2. **Technical documentation.** Read a manual or a specification, mark the passages that matter, and write your own notes
   about them with a way back to the exact spot.

## The shape, in short

- A PDF is **a note that owns a PDF**. It sits in the notebook tree like any note, so ordering, groups, favorites, search by
  title, the Trash Can and the delete dialog all work as they do today.
- The PDF file is never changed. Your **markup is stored beside it** as small records (highlights, underlines, strikethroughs,
  typed text notes, ink), and **"Export annotated PDF"** writes a copy for other apps.
- Notes **cite** a PDF with a `pdf:` link to a page or a mark. Any number of notes can cite one PDF.
- **Desktop** (built first): a PDF panel drawn by pdf.js, paired with a note panel. Ink shows view-only.
- **iPad** (milestone M2, so part of the first release): PDFKit and PencilKit, the PDF on one side and the note on the other.

## What is decided

All from the owner, 2026-11-07, except where a row says **my pick**.

| # | Decision |
|---|---|
| P1 | **Desktop first, then the iPad.** The two devices keep separate libraries until sync ships; a PDF moves between them by backup and restore, like everything else ([C2, C14](ipad-app-design.md#compromise-register)). |
| P2 | **Many notes can cite one PDF.** A chapter per note is the expected use. |
| P3 | **Markup is stored beside the PDF, never in it.** A button, **Export annotated PDF**, makes a copy for other apps (marked up natively by default, or flattened with a checkbox). |
| P4 | **Markup tools:** highlight (the five `<Mark>` colors), underline, strikethrough, freehand ink, and a typed text note you can put anywhere on the page, including the margin. On the iPad, the Pencil's highlighter, underline and strikethrough snap to text lines. **No inserted pages.** Shapes, stamps, signatures and form filling are out. |
| P5 | **Handwriting beside the PDF too:** the note next to the PDF can be handwritten (a canvas in the pane under a typed strip of citations; see [Handwritten notes](#handwritten-notes-beside-the-pdf)). |
| P6 | **Markup stays inside the page** as printed. No added margin. Coordinates are stored so that a gutter can be added later without a migration. |
| P7 | **The PDFs are text-based**, 20 to 600 pages and 5 to 300 MB, with an outline. Scans and OCR wait. |
| P8 | **Search finds** highlighted text, comments and your notes now. The full text of every PDF waits. |
| P9 | **Import copies the file in.** Same 1 GB limit per file as attachments. |
| P10 | **PDFs sit in the notebook and group tree, next to notes**, as a note that owns a PDF. A PDF is therefore core, not a plugin. |
| P11 | **Quote to note** inserts `> quote` and a linked citation at the caret, with the printed page label when the PDF has one ([Citations](#notes-and-citations)). |
| P12 | **Sidebar:** Outline, Bookmarks, Highlights and Notes tabs; a highlight can carry an optional one-line comment. Reading position is remembered automatically and is not a bookmark. |
| P13 | **Deleting a PDF moves it to the Trash Can for 60 days**, the same as any note. The delete dialog and the Trash Can row name what is inside ([The Trash Can](#the-trash-can)). |
| P14 | **iPad layout:** landscape is a split with a draggable divider; portrait shows the PDF with a switch to the note. The finger scrolls and long-press selects text; the Pencil marks with the active tool; double-tap follows the system's Apple Pencil setting. |
| P15 | **Desktop layout:** opening a PDF row opens a PDF panel and its note panel. The PDF panel is **paired** to a note by pin or follow, as the AI helper is. |
| P16 | **Import:** from the tree's `+` menu, the File menu, or by dragging a `.pdf` in. The new row lands in the current group, titled from the PDF's metadata or its filename. A file whose SHA-256 you already have offers **Open it** or **Import a separate copy**. |
| P17 | **Dark pages:** a per-PDF toggle that inverts the page image. Marks are drawn on top unfiltered and export keeps the original colors. Off by default. |
| P18 | **A PDF knows its notes from the text:** a note is one of a PDF's notes if its Markdown links to it. No extra data. |
| P19 | **The iPad PDF work is in M2**, in this order: the reader, Pencil ink on PDFs, handwritten notes beside the PDF, then standalone `<Ink>` pages last (the first thing cut if the schedule bites). This widens v1 ([D13](ipad-app-design.md#decisions)). |

## How it fits what exists

| Fact | What it means here | Source |
|---|---|---|
| **An attachment is a file on one note** that is never displayed or opened, with a renderer that never supplies a path and file bytes that never cross the bridge. | A reader needs the opposite, so a PDF is not an attachment. It gets its own table and its own serving path, and the attachments rules stay as they are. | [attachments.md](architecture/attachments.md) |
| **The desktop's CSP has `object-src 'none'` and `connect-src 'self'`**, and the page has no network access. | Chromium's built-in PDF viewer is out. pdf.js draws pages to a canvas from bytes the main process serves over the app scheme. | [protocol.ts](../apps/desktop/src/main/protocol.ts) |
| **Panels are desktop-only**, each a *kind*; the AI helper is a kind that is pinned to a note or follows the one you last used. | The PDF panel is a new kind with the same pin and follow. It is **desktop-only**: the web app and the CLI get no reader. | [panels.md](ui/panels.md), [kinds.ts](../apps/web/src/components/panels/kinds.ts), [panelsState.ts](../apps/web/src/components/panels/panelsState.ts) |
| **The Trash Can moves a note to `trashed_notes`, keeping its id; attachments stay while it is trashed and go with the note when it is deleted for good** (`removeOrphans`). | A PDF's file and markup follow the same rule, keyed to the owner note. | [web-trash-can.md](ui/web-trash-can.md), [attachments.ts](../apps/web/src/lib/composition/attachments.ts) |
| **A note link is plain `note:<id>` Markdown, and nothing in the database records links**, so there is no "linked from" list. | `pdf:` links work the same way, and a PDF's notes are found by searching note text for its id. | [note-links.md](ui/note-links.md) |
| **`<Mark>` has five named colors** (`yellow`, `green`, `blue`, `pink`, `orange`), names and not hex values. | Highlights reuse them, so a mark reads under every color scheme. | [text-highlighting.md](ui/text-highlighting.md) |
| **Every note, group, notebook, trashed item and attachment carries a `uuid`** (column, fill trigger, unique index, backfill). | The three new tables get one the same way, so they are sync-ready from the start. | [data-model.md](architecture/data-model.md#identity-the-uuid-column) |
| **The iPad app is native Swift on a branch (`claude/ipad-app-design-build-683ed8`), not yet on `main`**, at build-plan Step 9 of 12 for M1. It has no ink target yet. The ink stroke format (D9) is proposed and freezes at Gate C; ink is view-only off Apple (D11). | The PDF work lands in M2, and PDF ink uses the D9 stroke format rather than inventing one. | [ipad-app-design.md](ipad-app-design.md) |
| **Sync is designed but not built.** Files are blobs addressed by content hash; attachments are the "fast follow". | PDFs join the attachments on that fast follow. Until then, nothing here depends on sync. | [cross-device-sync-design.md](cross-device-sync-design.md) |
| **draw.io's editor is vendored** (`drawio.lock.json`, `fetch-drawio.mjs`) and served from the app, not fetched at run time. | pdf.js's worker and assets are vendored and pinned the same way. | [diagrams.md](architecture/diagrams.md) |

## The data model

Three new tables, created the way every table is (`CREATE TABLE IF NOT EXISTS`, so an older build that opens the file ignores
them), each with a `uuid`, its fill trigger and unique index. The tables and the files are the shared schema, so the iPad's
Swift core reproduces them exactly (a conformance fixture, as for the other tables).

```sql
CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER NOT NULL,      -- the owner note, live or in the Trash Can; one PDF per owner note
    file_name TEXT NOT NULL,       -- the name it was imported as
    stored_name TEXT NOT NULL,     -- the file's name in documents/
    sha256 TEXT NOT NULL,          -- of the bytes; used to spot a second import of the same file
    size INTEGER NOT NULL,         -- bytes
    page_count INTEGER NOT NULL,
    view_state TEXT,               -- JSON: reading position, zoom, dark pages (my pick: per device, in the row)
    created_at TEXT NOT NULL,
    uuid TEXT
);

CREATE TABLE pdf_annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    page INTEGER NOT NULL,         -- 0-based page index
    kind TEXT NOT NULL,            -- highlight | underline | strikethrough | text | ink
    color TEXT NOT NULL,           -- one of the five <Mark> names; for ink, a semantic name
    rects TEXT,                    -- JSON: the marked lines as rectangles, in page space (text marks)
    quote TEXT NOT NULL DEFAULT '',   -- the text under a text mark, kept for search and Quote
    comment TEXT NOT NULL DEFAULT '', -- the optional one-line comment
    body TEXT,                     -- JSON: a text note's box and text; an ink page's stroke JSON (D9)
    group_uuid TEXT,               -- ties the per-page records of one selection that crossed pages
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    uuid TEXT
);

CREATE TABLE pdf_bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    page INTEGER NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    uuid TEXT
);
```

```
~/.composition/
├── composition.db
└── documents/
    └── 3f9c2a71b0de-Designing_Data_Intensive_Applications.pdf
```

- **The file** is copied at import and never written again. The stored name follows the attachments rule (12 random hex
  digits, then the name made safe). The original is left alone.
- **One owner note per PDF**, enforced by a unique index on `note_id`. Citing the same PDF from other notes is a link, not a
  second row. Importing the same bytes again offers the existing one (P16).
- **Coordinates are raw PDF user space:** the numbers a PDF's own annotation `/Rect` and `/QuadPoints` use, in points,
  unrotated, whatever the page's crop box, media box, rotation or `UserUnit`. Each viewer maps them to its screen with its own
  call. Spike C measured this on rotated, cropped and offset pages: pdf.js and PDFKit draw a stored rectangle in the same
  place on every one ([Spike C findings](#spike-c-findings-2026-11-07)). (This plan first said "relative to the crop box's
  lower-left corner"; that fails on every page whose crop or media box does not start at 0,0, and needs the origin added
  back everywhere.) A coordinate outside the page is legal, which is what keeps a later margin gutter from needing a migration
  (P6), and **Export annotated PDF** writes the same numbers back out.
- **One ink record per page** (my pick): all of a page's strokes in one `ink` row, since PencilKit draws one drawing per page
  overlay. Decided with the stroke format at Gate C. A finer grain (a row per stroke) would merge two devices' edits better
  and cost thousands of rows per book.
- **A selection across pages** becomes one record per page, joined by `group_uuid`.
- **Undo and redo** apply to markup, per document, in the session.
- **A deleted mark** leaves any citation to it working at the page level (the link falls back to `p=`), and the quote text
  stays in the note.
- **No `view_state` in the note's frontmatter**, for the reason attachments give: the CLI rewrites frontmatter from the keys it
  knows.

## Notes and citations

A citation is ordinary Markdown, in the family of `note:<id>`, but it names the document by **uuid** from the first release,
so sync never has to rewrite it:

```md
> The selected text.
> — [*Designing Data-Intensive Applications*, p. 42](pdf:3f9c2a71b0de4c1e8a2d5b6f7e8d9c0a#p=44&a=7b1d…)
```

- `p` is the **physical page** (1-based); the words in the brackets show the **printed page label** when the PDF defines one
  (a textbook's front matter makes the 44th page "page 42") and the physical number otherwise. `a` is the mark's uuid and is
  optional: a plain page link is `#p=44`, and a link to the whole PDF has no fragment.
- **Quote** (a button on a highlight, and in the Highlights tab) inserts the block above **at the caret of the paired note**
  (P15), or at the end if that note is not focused. The quoted text is copied in, so a note still reads if the PDF is gone.
- **Cite this page** inserts just the page link. On the iPad it adds the link to the typed strip of a handwritten note.
- **Following a link** opens or scrolls the PDF panel in the window to that page and flashes the mark. If the PDF is not on
  this device (a restored backup without it, or one deleted for good), the link says **PDF not on this device** and the quote
  stays. A PDF in the Trash Can counts as gone until restored, as a trashed note does for `note:` links.
- **Where it is wired,** following `note:` links ([`noteRefs.ts`](../apps/web/src/lib/composition/noteRefs.ts),
  [`noteLinks.ts`](../apps/web/src/components/notes/noteLinks.ts)): the preview's URL allowlist must let `pdf:` through (and
  keep dropping unsafe schemes), the link component, the editor and the Live tab's drawing of a link, and the iPad's Markdown
  preview. The CLI keeps the Markdown and shows the link as text.
- **A PDF's notes** are the notes whose text contains `pdf:<uuid>`, found by searching note text on demand, with the owner note
  first. **Inference:** at personal-library scale that is fast enough; add an index only if it measures slow. The same scan
  finds `a=<uuid>` in those notes, which is how the Highlights tab shows which highlights you have already quoted, and where.
- **New note for this PDF** creates a note in the current group whose first line is a link to the PDF, so it is one of the
  PDF's notes at once.

## The desktop

### Reading

pdf.js (`pdfjs-dist`, Apache-2.0) in a new panel kind, `pdf`. The renderer never supplies a path: the panel asks for a
document by id, and the main process serves its bytes over the app scheme, streamed from disk with `Range` support (the
handler in [`protocol.ts`](../apps/desktop/src/main/protocol.ts) reads whole files into memory, so documents get a streaming
path of their own). **pdf.js does not use `Range` itself on an `app://` URL** (spike A), so the panel hands it a
`PDFDataRangeTransport` that fetches ranges from that route, with a small `rangeChunkSize` (16 KB) and `disableAutoFetch`.
That is what lets a 400 MB textbook open after reading about 10 MB ([Spike A findings](#spike-a-findings-2026-11-07)). The
route is found from the row, answers only to the app's own pages, and is never navigable (`nosniff`, no display of the file as
a page), mirroring the attachment download rules.

- **Reader basics** (my pick): continuous vertical scroll, fit-to-width on first open, zoom, and **find in the open PDF**
  (pdf.js has it; it is separate from the library-wide full-text search that P8 defers). Position and zoom are remembered
  per PDF.
- **Sidebar**, collapsible, on the panel's left: **Outline** (the PDF's own contents, read-only), **Bookmarks** (a page and an
  optional label, toggled with a key), **Highlights** (listed by page; click to jump; a **Quote** button; the optional
  comment) and **Notes** (every note that cites the PDF, owner first; click to open it in the paired note panel; **New note for
  this PDF**).
- **Dark pages** (P17) inverts the page canvas only, with a CSS filter on the canvas layer.
- **Marking:** select text and pick highlight, underline or strikethrough (five colors); place a typed text note anywhere,
  margin included. Ink made on the iPad shows here, read-only (D11).
- **Shortcuts** go in [`shortcuts.ts`](../apps/web/src/components/shortcuts/shortcuts.ts), chosen at build time. The editor
  already uses `Mod+Shift+H` (highlight), `K` (note link), `D` (diagram), `M` (images), `X` (width) and `L` (AI helper), so the
  PDF panel's keys are checked against those first.
- **Untrusted files.** A restored database can come from someone else, so a PDF is treated as hostile: pin a recent pdf.js
  (spike A ran 6.5.438, well past 4.2.67, which fixed the script-execution bug CVE-2024-4367), turn `isEvalSupported` off (the
  app's CSP blocks `eval` anyway; spike A ran only with it off), load no PDF scripting, and open a link in a PDF through the
  same external-link path a note's links use (**unverified** that path exists as needed).
- **CSP.** Measured in spike A: pdf.js's module worker, CMaps, standard fonts and text layer all work under the app's CSP, with
  no violations, when served from the app origin. They are vendored and pinned like draw.io (a `pdfjs.lock.json` and a fetch
  script). **WebAssembly is blocked** (the CSP has no `'wasm-unsafe-eval'`): pdf.js logs a warning and falls back to its
  JavaScript decoders, and a JPEG 2000 page rendered correctly. Allowing `'wasm-unsafe-eval'` (it permits compiling
  WebAssembly, not `eval`) made the same page 2 to 3 times faster in a small test. **My pick:** leave the CSP as it is for
  the first release, since scans are out of scope (P7), and revisit when scans and OCR come.

### The panel pair

- **Opening a PDF row** in the tree opens two panels in the window's grid: the PDF on the left, its owner note on the right. If
  that pair is already open, it focuses it.
- **The PDF panel is paired to a note** by the AI helper's mechanism: pinned to one note, or following the note panel you used
  last in its window ([`assistantSubject`](../apps/web/src/components/panels/panelsState.ts) is the model). It starts pinned to
  its owner. State: `{ documentId, noteId, follow }`.
- **With chapters 3 and 4 open side by side,** Quote goes to the pinned note, or, following, to the one you last clicked in.
- **Clicking a `pdf:` link** goes to the PDF panel for that document in the window if there is one; otherwise it opens one
  beside the note and leaves the note where it is.
- **They are ordinary panels:** they split, move, pop out and are saved with the layout. A pop-out shows the same workspace.

### Import

**Import PDF…** in the tree's `+` menu and the File menu opens the system picker in the main process (paths never come from
the page, as for attachments), or drag a `.pdf` onto a group or the window. The file is copied into `documents/`, hashed,
counted, and given an owner note in the current group, titled from the PDF's metadata or its filename and editable, with an
empty body. A second import of the same bytes asks (P16).

### The Trash Can

A PDF's owner note is a note, so the existing delete dialog already names the item, says it moves to the Trash Can, and
repeats the 60 days. What is new is **what it names**:

> **Delete "Designing Data-Intensive Applications"?** It moves to the Trash Can and is permanently deleted after 60 days,
> with its PDF (212 MB), 41 highlights, 2 ink pages and 6 bookmarks. 4 notes cite it; their quotes stay and their links stop
> working.

The Trash Can row for a PDF note shows the same counts and "permanently deleted in 12 days". The file and markup stay while the
note is in the Trash Can (up to 60 days of a large file) and go when it is deleted for good, by hand or by expiry: `removeOrphans`
gains documents, deleting the file, its annotations and its bookmarks. Restoring the note finds them again by its unchanged
id. An older build that trashes an owner note keeps `note_id`, so it loses nothing. The CLI, which has no Trash Can, deletes the
note for good and the next sweep removes the file.

## The iPad (milestone M2)

Native, on PDFKit and PencilKit, in the iPad app's own packages. Lands after M1 and is part of the first release.

- **Reader:** a `PDFView` with the same sidebar (outline from `PDFDocument`, bookmarks, highlights, notes), import from the
  **Files picker** and by **dragging from Files** (a share-sheet import waits), and the same links and quoting.
- **Layout:** landscape is the PDF left and the note right with a draggable divider; portrait shows the PDF with a switch to
  the note; the Notes tab switches which note the right pane shows.
- **Pencil and finger:** the finger scrolls and zooms, and a long press selects text for highlight, underline or strikethrough.
  The Pencil marks with the active tool: the highlighter, underline and strikethrough snap to the text lines under the stroke;
  ink is freehand with eraser, color and thickness. Double-tap follows the system's setting.
- **Ink on the page:** a `PKCanvasView` per page, supplied by PDFKit's page-overlay provider (iOS 16 and later; **unverified**,
  from memory) and set to Pencil-only input so a finger still scrolls. Strokes are saved as the D9 stroke JSON (with the
  PencilKit blob for lossless re-edit on the iPad), converted when the page changes or the app leaves the foreground. Only
  visible pages have overlays, which is what makes a 500-page book possible (**unverified**, spike B).
- **Why this is risky:** whether a finger can scroll and select text while the Pencil draws on a canvas over the page is the
  open question of spike B.

### Handwritten notes beside the PDF

A handwritten note is an ordinary note whose pane is **a canvas you write on directly**, with **a typed strip above it** for
citations. **Cite this page** and Quote add to the strip. A full-screen hop to edit would hide the PDF, so the canvas is
editable in place. Typed text in the middle of handwriting waits for ink-in-text, which the iPad design lists as later, so the
shape is one strip and one canvas. The desktop shows the canvas view-only and the strip editable (D11). The iPad recognises the
handwriting on the device and writes the text into the note so it can be searched; accuracy on real handwriting is unknown
([C11](ipad-app-design.md#compromise-register)).

## Export annotated PDF

A button on the PDF panel (a save dialog on the desktop, the share sheet or Files on the iPad). Two modes, with a **Flatten
markup** checkbox, off by default:

| Mode | Highlights, underlines, strikethroughs | Text notes | Ink |
|---|---|---|---|
| **Native** (default) | `Highlight`, `Underline` and `StrikeOut` annotations with their rectangles | `FreeText` | `Ink` paths. PencilKit's textured pencil and crayon strokes are **simplified** to paths |
| **Flattened** | Burned into the page | Burned in | Burned in, exactly as drawn |

Native marks stay editable and visible in other apps; flattened ones look identical everywhere and cannot be edited. The iPad
writes native annotations with PDFKit. The desktop writes them with `@cantoo/pdf-lib` (MIT, a maintained fork of `pdf-lib`),
chosen by spike D ([findings](#spike-d-findings-2026-11-07)): it writes the annotations with appearance streams, or burns
them into the page for Flatten, and rewrites the whole file in a utility process with a progress bar. A text note goes through
an embedded font, never a standard one. **Export of a password-protected PDF** uses the password the reader opened it with and writes a copy **protected with the
same password and the same limits on printing and copying** (the owner's choice, 2026-11-08; this section first said an unprotected copy, which would have left a readable
copy of a private document on disk).

## Search

[Search](architecture/search.md) finds what you made: the owner note's search entry also holds the text of its highlights and
comments (so searching "B-tree" returns the textbook's row, and the Highlights tab can list the matches), and your notes are
indexed as always. **Inference:** the hook is wherever the owner note is indexed today, re-indexed when its marks change; the
indexing code was not read for this plan, so the exact place is a build-time check. The iPad does the same in its FTS5 index.

Not now: the text of every PDF, which needs a text extractor per device (pdf.js and PDFKit read text differently, so it is
never synced) and sits in [product-positioning.md](product-positioning.md) as a potential feature; and OCR for scans (Vision on
the iPad; on the desktop, as far as I know, nothing is built in, so a bundled engine such as Tesseract would be needed).

## Backup, restore and sync

- **Backup** gains `documents/` and the three tables (the tables are in the snapshot already); **Restore** brings them back.
  The counts message mentions PDFs. A backup grows by the size of every textbook, the price of P9. See
  [backup-restore.md](architecture/backup-restore.md).
- **Moving the data location** moves `documents/` with `attachments/` and `app_data/`, and the pinned-names test covers it.
- **The iPad's backup** is tar and gzip written in Swift, and a multi-gigabyte backup is where risk R10 bites. Test with a large
  archive.
- **Sync-ready.** The three tables get the `uuid` pass (so the pass covers nine tables, not six), and the file's SHA-256 is a
  natural blob key. The sync design uses a *keyed* hash for end-to-end encryption, so it derives its own blob id; the plain
  SHA-256 stays local for duplicate detection. Two devices that imported the same textbook separately are merged by that hash.
  Marks are small records per page, so they merge by union; a mark edited on two devices is last-writer-wins.

## The web app and the CLI

- **Web:** an owner note is an ordinary note, with a line saying **This note has a PDF; open it in the desktop app**. Backup and
  restore carry the files. There is no reader and no import.
- **CLI:** an ordinary note; `pdf:` links show as text; deleting it is permanent (as for any note) and the next sweep removes
  the file.
- **Duplicating an owner note** (my pick): the copy has the same text and **no PDF**, so it is a normal note whose `pdf:` links
  still work. See [`DuplicateNoteDialog.tsx`](../apps/web/src/components/panels/DuplicateNoteDialog.tsx); not yet checked.

## Build order

Each step ends with something checkable. **Your steps** are G3 and G7; everything else I can do and show you.

0. **Spikes** (before anything is built for real):
   - **A, pdf.js on the desktop. Done 2026-11-07;** see [Spike A findings](#spike-a-findings-2026-11-07). Under the real CSP,
     with the worker served by the app scheme, on a 405 MB, 600-page file. It changed the plan: ranges need a transport, a
     small chunk size and a streaming handler. Scrolling in a visible window with pdf.js's viewer components, and a cold disk,
     are still untested.
   - **C, coordinates. Done 2026-11-07;** see [Spike C findings](#spike-c-findings-2026-11-07). One convention (raw user space),
     a fixture with rotated, cropped and offset pages, pdf.js and PDFKit compared. PDFKit runs on macOS, so its half was a
     command-line Swift program on this Mac with no simulator. Still untested: PDFKit on the iPad itself, and real
     multi-line selections.
   - **D, the export writer. Done 2026-11-07;** see [Spike D findings](#spike-d-findings-2026-11-07). `@cantoo/pdf-lib`, tried
     against two other variants and pdf.js on the nine geometries and on four real files (one of 183 MB). Still untested: a
     signed PDF, AES-256, Acrobat, and non-Latin text notes with a font we may ship.
   - **B, PencilKit over PDFKit,** needs the iPad: finger scroll, selection and Pencil drawing together; ink latency; memory on
     500 pages. It runs at the start of M2 and gates the iPad's ink, not the desktop's work. **The harness is built (2026-11-09) and
     exercised in the Simulator; the answers are still the iPad's.** See [Spike B status](#spike-b-status-2026-11-09).
1. **Shared schema and core (TypeScript). Done 2026-11-07.** The three tables with uuids (the uuid pass now covers nine),
   repos, `removeOrphans` for documents, backup and restore of `documents/`, the counts message, tests as each earlier schema
   opened (the intent of `db.test.ts`), and fixtures the Swift core will replay
   ([`fixtures/conformance/pdf`](../fixtures/conformance/README.md): the schema, the validation rules, and five operation
   scripts with their end states). The files are `documentsRepo.ts`, `pdfMarkupRepo.ts`, `documents.ts` (import, hash, serve a
   path, remove, sweep), `pdfMarkup.ts` (the rules) and `documentsApi.ts` (the types); `service.ts`, `backup.ts`,
   `dataLocation.ts` (the CLI's move) and `metrics.ts` know the new folder. **My picks, made while building** (change any):
   - A PDF is given only to a **live** note, so you cannot import into a trashed one; one note, one PDF.
   - **`page_count` is 0 until the reader counts the pages**, and a mark may be on any page until then (after, only on a page
     the PDF has). Step 2 decides whether the main process counts at import or the reader does on first open.
   - A mark's **color** is one of the five names for a highlight, underline or strikethrough, and any lowercase name for a text
     note or ink. A **comment** is one line (line breaks become a space) of at most 500 characters, a **bookmark label** at most
     200. Rectangles are stored **rounded to a thousandth of a point**. Ink's strokes are any JSON object or array until the
     stroke format freezes at Gate C.
   - **Deleting a mark deletes its whole selection** when it crossed pages (one highlight on screen, so one delete).
   - **The backup format stays at version 1.** A backup that holds PDFs is refused by an older build ("contains a file
     Composition doesn't know") rather than restored without them.
   - **"Assets on disk"** in Settings now counts the PDFs with the attached files.

   Not in this step, on purpose: the delete dialog's and the Trash Can row's summary of what is inside (Step 2), its count of
   citing notes (Step 4), the service and IPC wrappers the reader calls (Step 2), and the Swift side (M2).
2. **Import and the reader. Built 2026-11-07,** checked in the real app by `pnpm --dir apps/desktop smoke:pdf` (24 checks,
   against a small hand-made PDF, with the screenshots it takes). Importing through the native picker, serving the bytes with
   ranges, the `pdf` panel kind, the PDF row in the tree, the pair opening, outline, bookmarks, resume, find, dark pages, the
   new delete dialog and Trash Can row. What was built, and what it found:
   - **Main process:** `DocumentsApi` over IPC (ids and a target only: no path from the page), `main/documents.ts` (the picker,
     and a random token that stands for a file found to be a duplicate so that "Import a separate copy" needs no path), and
     `main/rangeResponse.ts` (a streaming `Range` handler for `app://composition/documents/<id>`; a 3 GB sparse file is sliced
     in a test without reading it). The scheme gains `corsEnabled`, and a response is given `Access-Control-Allow-Origin` only
     for the dev server's own origin, so `next dev` can fetch the bytes too (written, but only the built app was exercised).
   - **Renderer:** `PdfReader` drives pdf.js's own viewer components through `usePdfViewer`, with the range transport and
     16 KB chunks of spike A. Toolbar (page box with the printed label, zoom, fit width, find, bookmark, dark pages), an
     outline and bookmarks sidebar (it covers the pages in a panel narrower than 600 px instead of squeezing them), find across
     the whole PDF. The reading position, zoom and dark pages are saved a moment after the reader stops and come back after a
     restart. The workspace store has a `documents` store like the contacts one, and opening a PDF's note opens the pair.
   - **Findings:** (1) `pdf_viewer.mjs` reads the core library from `globalThis.pdfjsLib` when it loads, so the loader puts it
     there first. (2) pdf.js 6.5.438 has **no `isEvalSupported` option and no eval at all**, so the spike's `isEvalSupported:
     false` did nothing and risk X5's "eval off" is moot. (3) `useWasm: false` keeps pdf.js from trying WebAssembly under the
     CSP. (4) pdf.js bundles under Next 16's Turbopack as a dynamic import, with its worker, CMaps, fonts and ICC profiles copied
     into `public/pdfjs/` from the pinned package by `pnpm copy:pdfjs` (the desktop build and dev loop run it; nothing to
     download, unlike draw.io), and the worker is served by the app scheme under the unchanged CSP.
   - **My picks, made while building:** the note is titled from the file name (underscores read as spaces), not from the PDF's
     own metadata, which is left for a later pass; **the reader counts the pages** on first open, not the main process; the
     PDF panel's saved state is only its document (the paired-note state of Step 4 is added then); opening a PDF note focuses
     the PDF panel; a PDF in a narrow panel puts the sidebar over the pages; a password-protected PDF says it is protected.
   - **Not done in this step:** dragging a `.pdf` onto the window or a group, and **Import PDF…** in the File menu (the sidebar
     button is the one way in so far); the Highlights and Notes tabs (Steps 3 and 4); web's "This note has a PDF" line; a
     password prompt; the panel's title in a pop-out's window (it says "PDF").
3. **Text markup. Built 2026-11-07,** checked in the real app by the same `smoke:pdf` (now 44 checks, five runs in a row all
   passing). Highlight, underline and strikethrough in the five colors, typed text notes, the Highlights tab with the optional
   one-line comment, undo and redo. Quote, citations and `pdf:` links are Step 4; export is Step 5. What was built:
   - **Backend:** five `DocumentsApi` methods (`listAnnotations`, `addAnnotations`, `updateAnnotation`, `deleteAnnotation`,
     `restoreAnnotations`) through service, IPC and validators (at most 500 marks in one call), and `restoreAnnotations` in
     `pdfMarkupRepo.ts`, which puts a deleted mark back with the same uuid, group and times.
   - **Store:** `documentMarks.ts` is a controller with a serial queue per PDF and an undo and redo history (create, delete and
     update steps, 200 deep); `documentsStore` exposes it, so every panel showing the PDF agrees.
   - **Reader:** `PdfMarkLayers` draws marks in two layers on each page (an "under" layer after the canvas, where a highlight
     multiplies into the page, and an "over" layer for text notes, the popover and the catcher that places a note), rebuilt when
     pdf.js draws a page again or zooms. `selectionMarks.ts` turns a selection into marks: one per page, one rectangle per line,
     in raw PDF user space (spike C), with the words as the quote. `SelectionToolbar` floats over the selection;
     `useMarkEditing` holds the rest (selecting, recoloring, commenting, deleting, keys). Keys are in `shortcuts.ts` under
     "Reading a PDF": `Mod+Shift+H`, `U`, `S`, `Mod+Z`, `Mod+Shift+Z` and `Ctrl+Y`, `Delete`, `Esc`.
   - **Findings:** (1) A mark takes no mouse of its own, so the words under it stay selectable; a click selects by testing the
     stored rectangles, and a click that ends a text selection is left to the selection. (2) pdf.js ends a line with a `<br>` and
     no space, which `Range.toString()` reads as nothing, so the quote reads a `<br>` as a space. (3) A selection's rectangles are
     taken relative to the page's content area, inside its border (`clientLeft`), or every mark sits a border's width off.
     (4) The real-app test found one bug the unit tests did not: Enter in the page box with nothing typed jumped to page 1.
     (5) A mark is in the database a few milliseconds before the reader lets go of the selection and puts the toolbar away,
     and the toolbar sits over the line above the selection, so a click aimed there lands on a color swatch; a person cannot
     click that fast, and the test now waits for the toolbar to go. (6) A highlight multiplies into the page, which shows on a
     white page and vanishes on a dark one (the inverted page is black), so with dark pages on it screens instead.
   - **My picks, made while building:** **undo and redo last only while the app is open** (the history is not stored); undoing
     a delete brings the mark back with its uuid, so a note's citation of it (Step 4) survives; **a text note takes the color last
     chosen** (shared with the editor's highlight menu), in a default box of 200 by 56 points at 12 points; a text note emptied
     of words is deleted; a delete takes the whole cross-page selection with it (Step 1's pick), and one undo brings it all
     back; Highlights lists every mark (not only highlights) by page, with its words and comment.
   - **Not checked:** a text note on a rotated page (its box and its orientation in the export, Step 5), a selection through a
     two-column page in a real textbook (Gate P1), and the keys on Windows and Linux.
4. **Notes and links. Built 2026-11-07,** checked in the real app by the same `smoke:pdf` (now 58 checks, three runs in a row
   all passing). `pdf:` links in the preview, Quote, Cite this page, following a link, the Notes tab, New note for this PDF, pin
   and follow. What was built:
   - **The link format** is in `pdfRefs.ts`: `pdf:<uuid>#p=<page>&a=<mark uuid>`, read tolerantly (a damaged part is dropped and
     the rest kept), with the writers for a quote block, a page citation and a whole-PDF link, `escapeMarkdown` for text copied
     out of a PDF, and the scan that finds which pages and marks a note cites.
   - **The preview** draws a `pdf:` link as a link (`NoteLink.tsx`; `usePdfLinks` says whether the PDF is here). A link whose
     PDF is not on this device, or whose note is in the Trash Can, is shown struck through, "PDF not on this device", with its
     words still readable; the web app has no PDFs, so every such link there is dead.
   - **Following a link** (`openLinkedPdf` in `panelsState.ts`): the PDF panel the window shows for that document is focused
     and asked for the page and mark, or a PDF panel opens to the left of the note, paired with it, and the note stays where it
     is. The reader shows the page once it is open and its marks are read, flashes the mark for 1.6 seconds, then drops the ask.
   - **The pairing** (`PdfPanelState` is now `{documentId, noteId, follow, goTo?}`): a PDF panel is pinned to a note or follows
     the note in use, as the AI helper does (`pdfSubject`, `setPdfFollow`); the pen-and-notebook button in the reader's toolbar
     switches it. Opening a PDF's note pins the panel to it; a panel saved before this follows.
   - **Quote** is a button in a mark's popover and in the Highlights tab; **Cite this page** is a toolbar button. Both put
     Markdown into the paired note through its editor, at its caret as typing would (`noteInsertions.ts`, `insertMarkdown` on
     the editor's controls), and at the end of the note when it is not open or the user has not been in it yet; never in the
     frontmatter. Without a paired note the reader says so instead of doing nothing.
   - **The Notes tab** lists the PDF's own note first and every note whose text links to the PDF, with how many pages each cites;
     picking one shows it in the paired note panel and pins the PDF to it. **New note for this PDF** makes "Notes on <title>" in
     the owner note's group, its first line a link to the PDF, and shows it the same way. The Highlights tab marks the
     highlights a note already quotes, and names the notes.
   - **The delete dialog** now ends "N notes cite it; their quotes stay and their links stop working." (the owner note does not
     count).
   - **Findings:** (1) Consecutive quoted lines are one Markdown paragraph, so this plan's two-line example (the words, then
     the citation) runs together in the preview; the citation is now a paragraph of its own, after an empty quoted line. (2)
     The renderer already holds every note's text, so the Notes tab reads citations from the notes in memory, which follows
     what is typed at once; the scan on the database side (`listCitations` in `documentsRepo.ts`) is only for the delete
     dialog's count, and there is no IPC method for it. (3) The editor and the Live tab already draw any `[text](target)` link,
     so `pdf:` links needed nothing there; as with `note:` links, only the preview follows them. (4) Opengrep's
     `unsafe-dynamic-method` rejects calling `list[list.length - 1](...)`; the registry of open editors uses `.at(-1)`.
   - **My picks, made while building:** Quote is not offered for a text note (its words are its own); a quote's words are
     escaped so that the PDF's punctuation starts no Markdown or MDX; the printed page label is in the link text and the physical
     page in `p=`; a link to the whole PDF only focuses or opens the panel, and Cmd-click makes no difference to a `pdf:` link;
     when a note is open in two panels the later editor takes the quote; the ask to go to a page is kept in the panel's state
     but is not saved.
   - **Not checked:** a PDF opened from a link in a pop-out window, a quote into a note open in another window, a very large
     page where the mark is not drawn before the flash ends, and the iPad's Markdown preview (M2).
5. **Search and export. Built 2026-11-07,** checked in the real app by the same `smoke:pdf` (now 63 checks, twice in a row all
   passing) and, for the writer, by `spikes/pdf-reader/export/app-writer-check.mjs` (pdf.js renders of the output on spike C's nine
   geometries, native and flattened: 18 of 18). What was built:
   - **Search:** the owner note's entry in the search index also holds the words of its PDF's marks (quotes, comments, text notes)
     and bookmark labels, after its own text and never shown, so searching "B-tree" finds the textbook's note
     (`marksSearchText` in `pdfMarkupRepo.ts`, used by `searchIndex.ts` for one note and for a full rebuild). A change to a mark or
     bookmark puts the note back in the index without the caller waiting; a burst of changes while it is indexing asks for only one
     more pass (`reindexOwnerSoon` in `service.ts`). The Highlights tab has a filter box over the words, comments and notes.
   - **Export annotated PDF:** a toolbar button opens a dialog (Flatten markup, off by default), then the operating system's save
     dialog (the page never names a path), and the copy is written in a **utility process** (`exportProcess.ts` starts it for each
     export and ends it when it answers; `src/worker/exportWorker.ts` is its script, bundled with both fonts into
     `dist/export-worker.js` and unpacked from the app archive, `asarUnpack` in `electron-builder.yml`). It writes the copy beside its
     name with `.part` and renames it into place, so a failure leaves no half a PDF. The PDF in the library is never written to,
     and a target that is that file is refused.
   - **The writer** is `pdfExport.ts` (`@cantoo/pdf-lib` 2.11.1 and `fontkit` 2.0.4, exact pins): native marks are Highlight,
     Underline, StrikeOut and FreeText annotations with hand-written appearance streams (highlights multiply into the page, as the
     reader draws them), each carrying its uuid (`NM`), change time (`M`) and comment (`Contents`); flattened, the same appearances
     are drawn into the page's content and no annotation is added. Existing annotations (links) survive. Text notes are laid out
     by their own line breaking and written with an embedded font, upright on a rotated page (the appearance's matrix turns it back
     by the page's rotation).
   - **Findings:** (1) **Noto Sans has no `≤ ≥ ≠ ≈ → √ ∞ ✓`** (it covers Latin, Greek and Cyrillic and little else), which the
     choice offered to the owner implied it did; so the second bundled font is **Noto Sans Math** (about 1 MB, same licence), used
     for a character the first lacks, and neither is embedded unless a note needs it (a subset costs a few KB). (2) Text on a
     rotated page reads upright in pdf.js on all four rotations, with or without a crop or media box offset, closing the
     "not tested" of spike D. (3) A note's words wrap to the displayed box, so on a page turned 90 degrees a wide box is a narrow
     one on screen, as in the reader. (4) vitest reads a `.ttf` as a URL, not bytes, so the desktop config has a small plugin that
     gives the fonts as bytes, as esbuild's binary loader does in the build. (5) The licence notices now include the writer,
     fontkit and both fonts with the OFL text (`LICENSE_FONT`, which the collector's filename pattern now matches).
   - **My picks, made while building:** a text note with a character neither font can draw **stops the export and names the note
     and the characters** (the owner's choice, 2026-11-07: Latin, Greek and Cyrillic; no system fonts, no CJK); there is no bar,
     only "Exporting…" and then "Saved “name” with N marks.", since a rewrite has no steps to report; **ink is left out and
     counted** (its stroke format is not final and the desktop has none), as is a mark on a page the PDF does not have; a
     password-protected PDF is refused with a reason (the reader cannot open one to mark, either); the suggested name is the
     PDF's name with " (annotated)"; a text note is filled a little lighter than the reader's, which blends with the page.
   - **Not checked:** the output in Acrobat or PDFKit (pdf.js only; PDFKit was checked for spike D's writer, not this code), AES-256,
     a signed PDF (a full rewrite drops the signature, as spike D said), memory on a file near the 1 GB limit, the utility process
     started from a **packaged** app (CI checks that the worker is unpacked where it will be started, not that it runs there), and
     Windows and Linux.
6. **Docs and the manual test. Done 2026-11-07.** [ui/pdf.md](ui/pdf.md) (what you see and do), [architecture/pdf.md](architecture/pdf.md)
   (how it works inside), [manual-tests/pdf.md](manual-tests/pdf.md) (Gate P1, the checklist to run by hand), and every doc in
   [Docs to change](#docs-to-change-when-it-ships), each updated for what is built; the iPad rows are proposals and stay ⬜. Every
   link and anchor in the changed pages was checked.
7. **Gate P1 (yours):** the manual test by hand on a real textbook and a real manual.
8. **iPad M1 finishes** as planned (not part of this plan).
9. **M2, in order:** the Swift core's three tables against the shared fixtures; the PDFKit reader and the split; typed markup,
   bookmarks, the Notes tab and import from Files; spike B; **Gate C** (the ink stroke format, including one ink record per
   page); Pencil ink on PDFs; handwritten notes beside the PDF; export on the iPad; then standalone `<Ink>` pages.
   **Status 2026-11-09, in the Simulator only (see [The iPad's build, 2026-11-09](#the-ipads-build-2026-11-09)):** the tables and files
   (PRs #276 and #279), import and the PDFKit reader, **typed markup, the Highlights and Notes tabs, Quote, Cite this page, `pdf:` links, search
   by marks and export annotated are built**, and **spike B's lab is built** (not run on an iPad). **Not built, waiting on the iPad and Gate C:**
   the Pencil's highlighter snapping to text lines, handwritten notes beside the PDF, and standalone `<Ink>` pages.
   **Update 2026-11-10: Pencil ink on a PDF is built too, in the Simulator with a finger** ([Ink on the pages](#ink-on-the-pages-2026-11-10)): drawn on a canvas over each page, kept as one record per page, listed and cleared in the Highlights tab, written into an export. Whether a Pencil reaches the canvas is the iPad's.
10. **Gate P2 (yours):** the iPad manual test, extending `docs/manual-tests/ipad.md` (items 268 to 293 for the reader, notes, search and export, 294 to 307 for ink, 308 to 310 for all of it together; the lab is 200 to 215; the earlier 140 to 157 are the reader).
    The checklist is written; nothing in it is ticked.

## Spike A findings (2026-11-07)

The prototype is [`spikes/pdf-reader`](../spikes/pdf-reader/README.md): a minimal Electron main process (45.2.1, the desktop
app's locked version) with the app's scheme privileges and the CSP string copied from
[`protocol.ts`](../apps/desktop/src/main/protocol.ts), serving a test PDF from a streaming handler, and `pdfjs-dist` 6.5.438.

**The test file** is generated, and is harder than the plan's bound in one way and easier in others: 600 pages, **405 MB**
(the bound is 300), real selectable text, a 79-entry outline, printed page labels (i to viii, then 1 to 592), and one
0.7 MB incompressible JPEG on every page. A real book has fewer figures, so its pages are cheaper to render, but real print
PDFs also scatter their page objects through the file the way this one does. **The numbers** are one run each on this Mac,
with a warm file cache and a hidden window.

| Question | Answer |
|---|---|
| Does pdf.js run under the real CSP? | **Yes.** The module worker, CMaps, standard fonts, text layer, outline and page labels all work, with no CSP violation except WebAssembly (below). |
| Does it use `Range` on `app://`? | **No.** pdf.js sets `isHttp` from the URL's protocol and turns range requests off when it is false (`pdf.mjs`, `validateRangeRequestCapabilities`). Opened by URL, it made one request for the whole 405 MB file, and the renderer's working set was about 800 MB straight after open. |
| With a `PDFDataRangeTransport` that fetches ranges itself? | **Yes, and the chunk size decides the cost.** Opening walks the page tree to the last page, and here every page object sits between images, so it reads one chunk per page: **297 MB at 512 KB chunks, 37.5 MB at 64 KB, 9.5 MB at 16 KB, 4.9 MB at 8 KB** (about 600 requests at every size). At 16 KB the open took 125 ms in Electron. |
| How fast is it? (16 KB chunks) | First page with its text layer 34 ms; jumps to pages 300, 450 and 600 took 22 to 33 ms; 100 pages in a row averaged 33 ms (p95 34 ms); the outline took under 2 ms and the labels were right. |
| Is find-in-PDF feasible? | **Yes:** the text of all 600 pages (22,800 items) took 1.3 s. It read 325 MB doing it, because each page's resources pull its figure in. |
| Memory | The renderer's working set was 174 MB after open, 345 MB after reading 100 pages (67 MB), and about 700 MB after reading most of the file. pdf.js keeps what it has read until the document closes, so a long session trends toward the file's size; closing the panel frees it. |
| WebAssembly | **Blocked by the CSP** (no `'wasm-unsafe-eval'`). pdf.js logs a warning and falls back to its JavaScript decoders, and a JPEG 2000 page rendered correctly (140 to 234 ms). With `'wasm-unsafe-eval'` allowed it took 58 to 80 ms and the warning went away. |

**What it changed in the plan:** ranges need a transport (not a URL), a 16 KB chunk size and `disableAutoFetch`, and a
streaming handler (the existing one reads whole files into memory); the CSP question has an answer and a pick (above); and
risk X1 is mostly answered.

**What it did not test:** scrolling in a visible window with pdf.js's viewer components (`pdfjs-dist/web`), which is where a
page-canvas pool and the memory trend would show; a cold disk; JBIG2 and ICC color (the other WebAssembly paths); encrypted
PDFs; a balanced page tree (the open may be cheaper than here); and Windows and Linux. The test file's incompressible images
and interleaved layout are not typical, and a handwritten generator is not a real book: **run the same phases on two or three
real PDFs of yours** (the README says how) before treating any number as a promise.

## Spike C findings (2026-11-07)

The check is in [`spikes/pdf-reader/coords`](../spikes/pdf-reader/README.md#spike-c-do-pdfjs-and-pdfkit-agree-on-where-a-mark-goes).
The fixture has nine pages with the same two landmarks in raw user space (a red square at (100,100) to (150,150), and the text
ANCHOR TEXT with its baseline at (100,300)); the pages differ only in geometry: plain, `/Rotate` 90, 180 and 270, a crop box, a
media box with a negative origin, crop and rotate 90, media offset with crop and rotate 270, and `UserUnit 2`. Both sides ran
headless on this Mac: pdf.js 6.5.438 in Node (with `@napi-rs/canvas`) and PDFKit (macOS 27.0.1, Swift 6.4.2) in a command-line
program. `node coords/compare.mjs` gives the pass or fail.

| Question | Answer |
|---|---|
| Does a rectangle stored in raw user space land on the same spot in both viewers? | **Yes, on all nine pages.** In pdf.js (each corner through `convertToViewportPoint`) the converted area was 100% red with no red outside it; in PDFKit an annotation whose `bounds` are the raw rectangle covered the red square exactly (0 red pixels left, 0 changed pixels outside it). Both draw the landmark at the same viewport position, within 0.5 pt. A rectangle also survives pdf.js's round trip to the viewport and back with no error. |
| Does the convention this plan first wrote (relative to the crop box's lower-left corner) work? | **No.** A negative control that uses it as if it were raw fails on exactly the four pages whose crop or media box does not start at 0,0. Raw user space needs no origin added back, and is what an exported annotation's `/Rect` holds. |
| Is the text in the same place? | **x and width agree** (100 pt and 172.0 pt) on every page, whatever its rotation. Vertically, pdf.js gives the baseline (300) and PDFKit its line box (294.5 to 318.5): they differ by the font's descent, 5.5 pt at 24 pt. A stored text rectangle keeps what the viewer that made it captured, and the other draws it as stored. |
| What did PDFKit do that needs care? | (1) `PDFPage.bounds(for:)` returns the **unrotated** box: width and height are not swapped on a 90° or 270° page. (2) A highlight's `quadrilateralPoints` are **relative to its `bounds` origin**: the same quad written in page coordinates landed exactly 100 pt off, the offset of its origin. (3) A highlight is drawn inset vertically by about a tenth of its height on each side (5 pt of 50), which is appearance only: nothing changed outside the rectangle. |
| What did pdf.js do that needs care? | This version has no `convertToViewportRectangle`: convert the four corners with `convertToViewportPoint` and take their extent (a 90° turn swaps the axes). A text item's `transform[4]` and `[5]` are raw and identical on every page. |
| `UserUnit`? | pdf.js scales its viewport by it (a `UserUnit 2` page shows twice as large); PDFKit ignores it. The stored rectangles are right either way and only the display scale differs. **My pick:** not handled; pages with a `UserUnit` other than 1 are rare. |

**What it changed in the plan:** the coordinate convention (above), and risk X2 is answered for stored rectangles.

**What it did not test:** a real multi-line selection (pdf.js's DOM range rectangles to raw space, and PDFKit's
`selectionsByLine`); rotated text; `/Rotate` or boxes inherited from the page tree; a crop box larger than the media box;
PDFKit on iPadOS (the same framework, but the UIKit conversions such as `PDFView.convert` were not run); pdf.js's pixels in
Chromium's canvas (the spike used a Node canvas, though the conversions are pure arithmetic); and the export itself (writing
`/QuadPoints` into a file, which is spike D).

## Spike D findings (2026-11-07)

The checks are in [`spikes/pdf-reader/export`](../spikes/pdf-reader/README.md#spike-d-which-library-writes-the-marks-into-a-pdf).
Each candidate writes the same marks (a highlight, an underline, a strikeout, a text note and an ink path, in raw user space)
onto the nine geometries of spike C, as native annotations and again flattened. The result is then drawn by pdf.js and by
PDFKit, and the check looks for each mark inside its own rectangle. On real PDFs, which already have colour on the page, it
compares against a render of the original instead: each mark must change pixels inside its rectangle and nothing outside the
rectangles of all the marks.

**Candidates.** `pdf-lib` (MIT; last release May 2022, 320 open issues, 31 million downloads a week), and two maintained forks
with the same API: `@cantoo/pdf-lib` 2.11.1 (MIT; released September 2026) and `@pdfme/pdf-lib` 6.2.8 (MIT; part of the pdfme
project). pdf.js's own `saveDocument()` was also tried. `mupdf` is AGPL and excluded. PDFium compiled to WebAssembly
(`@embedpdf/pdfium`, MIT) was **not tried**: it would mean driving PDFium's C interface by hand, and the forks already work.

| Question | Answer |
|---|---|
| Do the forks write native annotations that both viewers draw in the right place? | **Yes.** All three pdf-lib variants, native with hand-written appearance streams: 9 of 9 geometries pass in pdf.js and in PDFKit, and each viewer reads back `Highlight`, `Underline`, `StrikeOut`, `FreeText` and `Ink` as native annotations. Flattened: 9 of 9, with no annotation left in the file. |
| On real files? | **Yes.** Against the originals, native and flattened, in both viewers: the 183 MB, 4,351-page DaVinci Resolve manual (linearized, with object and cross-reference streams; pages 11, 21, 101 and 2001; all three variants), and two older files (Ghostscript 6.5 and dvipdfm output; `@cantoo`). The manual's own link annotations, outline (21 entries) and page labels survived. A small sample: four real files. |
| Are appearance streams needed? | **Yes, write them.** Without one (`pdf-lib`'s output), both viewers still draw highlights, underlines, strikeouts and ink from the annotation's own data, but pdf.js draws **no text note** and the highlight's shape then differs by viewer (PDFKit's inset). With an appearance stream they match. |
| Can pdf.js itself write the marks? | **No.** `saveDocument()` appends an incremental update, which is attractive, but this version can create only Highlight, FreeText, Ink and Stamp: **no Underline or StrikeOut**. PDFKit did not draw its Ink output, and it peaked at 1.5 GB on the 405 MB textbook (3.8 times the file) because it also builds a full copy. Rejected. |
| How big and how fast on a big file? | The synthetic 405 MB, 600-page textbook: 0.4 to 0.5 s and 0.9 GB for 20 marks; 0.8 s and 0.95 GB with 3,000 (every page); flattened on every page 0.5 s and 1.0 GB, and the file grows 11 MB. The real 183 MB manual: **`@cantoo` 8.5 s and 0.75 GB; `pdf-lib` and `@pdfme` 3.5 to 4.7 s and 0.8 GB.** So memory is about 2 to 4.5 times the file, and `@cantoo` is about twice as slow. At the 1 GB import limit that extrapolates to 2 to 4.5 GB (**not measured**). Minified, `pdf-lib` is 525 KB and `@cantoo` 614 KB. |
| Encrypted PDFs? | Tested with RC4 40-bit and 128-bit files (a restricted copy that opens without a password, and one that needs a user password). Plain `load` fails on every variant. **`ignoreEncryption: true` "works" but writes a file that still says it is encrypted with new unencrypted objects in it: never use it.** With the `password` option, only **`@cantoo` decrypts both sizes** and saves an unencrypted copy; `@pdfme` fails on the 40-bit file (a `TypeError`) and `pdf-lib` does not support it. pdf.js opens the no-password ones itself and raises `PasswordException` for the other. AES-256 was not tested (my generator could not make one). |
| Text notes in other scripts? | A standard PDF font holds WinAnsi only. `pdf-lib` and `@pdfme` throw on 日本語, Привет, ≤ and emoji; **`@cantoo` silently writes a `?` for each one**, which would lose a user's note without a sound. Embedding a font through `fontkit` 2.0.4 (MIT) with subsetting worked: "Café ≤ Привет 日本語" came out right, pdf.js read the same text back, and the page cost 13 KB (the font file was 22.7 MB; a local test font that cannot be shipped). |

**My pick:** `@cantoo/pdf-lib` plus `fontkit`, because it is maintained, has the original's API (so the original is a one-line
swap if the fork ever causes trouble) and is the only one that handles encrypted files. Always write appearance streams.
Export runs in a utility process with a progress bar (a full rewrite takes seconds on a big file and holds the whole file in
memory), never through `ignoreEncryption`, and never lets a text note reach a standard font: it embeds a font. The licence
notices gain `@cantoo/pdf-lib`, `fontkit`, their dependencies (all MIT, 0BSD, or MIT with Zlib) and the font.

**What it changed in the plan:** the writer is chosen ([Export annotated PDF](#export-annotated-pdf)), X9 is answered, and two
risks are new (X11, X12).

**What it did not test:** a digitally signed PDF (a full rewrite invalidates the signature; an incremental update would not,
and this is the cost of not writing one); AcroForms; AES-256; whether a text note on a rotated page reads upright (the check
saw glyph pixels inside the rectangle, not their orientation); PencilKit's textured strokes simplified to ink paths (that
part is on the iPad, which writes with PDFKit); opening the result in Acrobat (PDFKit is Preview's framework, so Preview
should match, but it was not opened there); a hostile or damaged PDF; more than four real files; and the utility process
itself in Electron.

## The iPad's build, 2026-11-09

Built on `claude/gate-p2-pdf-markup-fe640d` (from `claude/ipad-app-next-eeff80`, which has the import and the reader), by a session working for Gate P2, **in the iPad
Simulator and with `swift test` on a Mac; none of it has been on an iPad**. The picks below are mine, the owner's to change.

- **Where the code is.** The Swift package `apps/ios/CompositionCore` gained `PdfRefs` (the `pdf:` link format, escaping and quote blocks: a port of `pdfRefs.ts`
  replaying `fixtures/conformance/pdf-refs.json`, which `apps/ios/scripts/pdf-refs-oracle.mjs` writes from the desktop's own code and `conformance.sh` checks), `restoreAnnotations` (undo of a delete),
  `marksSearchText` and the `NoteStore` methods that put a PDF's owner note back in the search index when its marks change (its words follow the note's text, as the
  desktop's `noteToDocument` does), `notesForPdf`, `PdfMarkPaint` and `PdfMarkGeometry` (the five colours, a tap's mark, a new note's box) and `PdfMarkEditor` (the marks of one PDF with a serial queue and
  undo and redo, 200 deep, in memory). A **second package target, `CompositionPDF`** (PDFKit; the Xcode project links it): a selection turned into marks, marks drawn as annotations
  (`MarkAnnotations`, `MarkLayer`), and `AnnotatedExport`. It is a target of its own because the core promises to be Foundation and GRDB only; PDFKit is the same framework on a Mac, so
  its tests run under `swift test` against the nine page geometries of spike C (`fixtures/conformance/pdf-geometry.pdf`).
- **Typed markup** (Step 1). A long press selects words (PDFKit's own selection); a bar of the five colours and highlight, underline and strikethrough floats over the pages;
  each mark is stored in raw PDF user space, one per page with a rectangle per line (`SelectionMarks`, from `PDFSelection.selectionsByLine()`), and drawn as a PDFKit
  Highlight, Underline or StrikeOut annotation named by the mark's uuid (`/NM`). Checked on all nine geometries: a mark made from a selection of "ANCHOR TEXT" lands on the text on
  every page, rotated and cropped included. A typed note: the speech-bubble button, a tap on a page (its top-left corner), a box to type in, a FreeText annotation in a 200 by 56 point box at 12 points.
  A tap on a mark opens its card (recolour, a one-line comment, Quote, delete; a typed note can be retyped). Undo and redo are in the strip.
  **My picks:** the system's edit menu is not extended (a bar of our own is easier to test and to find); a mark's card is a **panel over the pages** (at the bottom of the pane, or the top when the mark is low) and not a popover, because a popover's buttons could not be tapped in the Simulator's UI tests and its arrow covers the page; a typed note cannot be moved, resized or given another font size yet; the colour last chosen
  is remembered (as on the desktop, but it is not shared with the editor's highlight menu); the card's comment is saved when the field is left.
- **The sidebar, quoting, citing and links** (Step 2). The reader's list button opens a popover with **Contents, Bookmarks, Highlights and Notes**. Highlights: every mark by page with its words and
  comment, a filter, a swipe to delete, a quote button, a quote icon on a mark a note already quotes (read from the notes' text), and a tap goes to the page and flashes a frame
  round the mark for 1.6 seconds. Notes: the PDF's own note first, then every note whose text contains `pdf:<uuid>`, with how many pages each cites, and **New note for this PDF**.
  Quote and Cite this page write into the note beside the PDF at its caret (the Markdown and Live tabs), or at the end of the note in the Preview tab. The preview follows a `pdf:` link:
  the PDF opens at the page and flashes the mark; from a note that does not own the PDF it opens **beside that note** and the note stays where it is. A link whose PDF is not here (a backup
  without it, or its note in the Trash Can) is struck through with "(PDF not on this device)" after it and is not tappable. **My picks:** the desktop's "paired note" (a PDF panel pinned to a note
  or following one) is, on the iPad, *the note shown beside the PDF*: choosing a note in the Notes tab, or following a link from one, shows the PDF beside it (kept while the app is open, not
  saved), so Quote goes to the note in view; the Live and Markdown tabs draw a `pdf:` link as any link and do not follow it (the desktop's preview-only rule).
- **Search by marks** (Step 3). The words of a PDF's marks (quotes, comments, typed notes' words) and bookmark labels are in its owner note's entry in the FTS5 index after the note's own
  text, never shown; any change to a mark or a bookmark, an undo, and the Trash Can and a restore keep it right; a rebuild includes them.
- **Export annotated PDF** (Step 4). The strip's share button opens a sheet: *Flatten markup* (off), the number of marks, *Export…*, then the share sheet (Save to Files, AirDrop). Native:
  PDFKit writes each mark as an annotation **with an appearance stream** (checked in the written file) carrying the mark's uuid, comment and bounds; flattened: PDFKit's own
  burn-in option. The copy is written next to its final name and renamed into place; the library's file is never written and a copy cannot be put over it. A protected PDF's copy is protected with the same
  password. **Not the desktop's behaviour:** text notes in any script work (PDFKit uses the system's fonts; the desktop stops at CJK and emoji); the original's limits on printing and copying are not carried; a flattened copy loses the PDF's own links (PDFKit's
  burn-in takes every annotation into the page; a test pins it); a typed note's border is drawn a little heavier once written. Ink is left out and counted, and when it exists textured strokes are simplified to paths (C21).
  **Not measured:** memory and time on a 300 MB book on the iPad (PDFKit holds a copy of the book while it writes it).

## Ink on the pages, 2026-11-10

Built on the same branch after PR #290 (spike B's lab, merged) brought `main` in, **in the iPad Simulator with a finger standing in for the Pencil, and with `swift test` on a Mac; none of it has been touched by a Pencil.** The picks are mine, the owner's to change. This builds the first of P19's "ink" steps (Pencil ink on PDFs); handwritten notes beside the PDF and standalone `<Ink>` pages are still not built.

- **What is stored.** One `pdf_annotations` row of kind `ink` per page (`color` `ink`, no rectangles, no quote), whose `body` is that page's stroke JSON in the D9 format (`CompositionInk`, [ink.md](architecture/ink.md)), **unchanged**: the strokes are in the canvas PencilKit gives for the page, in points, y down from the top-left corner of the page's **unturned crop box**, and `canvas` is that box's size. That is not raw user space like the other marks, but it is one flip away from it (`PdfInkGeometry`: user x = box.minX + x, user y = box.maxY - y), the desktop's `page.view` is the same box, and it keeps the D9 renderer able to draw a page's ink with no PDF at hand. Verified on the nine geometries of spike C (below). The row's `updated_at` moves on each save; its uuid and `created_at` stay. A merge that leaves two rows on a page is healed by the next save (the newest wins). There is no PencilKit blob (`inKP` is for a drawing's PNG): the canvas is rebuilt from the strokes.
- **Where it is kept out.** A page of ink is megabytes when dense, so `PdfMarkEditor.state`, the Highlights tab, the words a PDF's note is found by and the export's list of marks never read it (`annotations(withInk: false)`; `marksSearchText` fetches a body only for typed notes). It is read a page at a time (`inkPages`, `inkBody`, `setInk`, `forEachInk`) and is **not an undo step**: undo of a stroke is PencilKit's own, on the canvas.
- **In the reader** (`PdfInkLayer.swift`, the pencil button in the strip). PDFKit's overlay provider gives a `PKCanvasView` to each page near the screen, as in the lab. A canvas shows a page's stored ink whether or not the Pencil is drawing, and takes touches only while drawing. While drawing: the canvases are `.pencilOnly` (`.anyInput` with *Finger draws*, a switch in the banner, which makes two fingers scroll); **PDFKit's page view is told to take touches** (spike B: it takes none by default, so a canvas is never reached); the PDF's own scroll view stops accepting the Pencil; and the system's tool picker (`PKToolPicker`) shows, all canvases being its observers. A page's drawing is kept 1.2 s after its last stroke, at once when its page goes off the screen, on *Done*, when the app resigns active and when the pane disappears (with a background task); the conversion to the stroke format runs on a background queue **one page at a time, in order** (spike B: all at once peaked at about a gigabyte), and a canvas is **emptied when its page leaves** (spike B: 89 MB against 174 MB over 200 dense pages). The last eight pages' drawings are kept in memory so that scrolling back is instant, never one that is unsaved. The canvas is light-styled: the page is white in every scheme.
- **Export.** `InkAnnotations` writes a page's strokes as native `Ink` annotations, one for each run of neighbouring strokes with the same colour, average width and opacity; **textured strokes are simplified (C21)** to plain lines, a pen's change of width along a stroke is its average, `ink` is black and `accent` the brand colour. A flattened copy burns them in. `AnnotatedExport` takes the pages of ink and a function that reads one, so a book's strokes are never all in memory; it counts pages written and pages it could not read.
- **Checked** (all on a Mac under `swift test`, and in the Simulator): the store (one record per page, replaced in place, healed, refused when past the end or not an object, out of the lists, gone with the PDF); the export on **all nine page geometries**: a stroke from canvas (20, 20) to (120, 20) shows exactly where the unturned top-left corner of the crop box is on the turned page (top-left, top-right, bottom-right, bottom-left), native and flattened, scaled when the drawing's canvas is another size; the reader in the Simulator by seven UI tests (`PdfInkUITests`, a finger standing in for the Pencil, the page judged by its pixels because PDFKit does not show the canvas to the accessibility tree): a stroke and a second one, nothing drawn when the Pencil is up, the *Finger draws* switch, ink back after the app is ended, ink back after its page is scrolled far away and returned to, the Highlights tab's list and *Clear ink*, and export counting the page of ink. With the 13 marks tests and 7 of the 8 `PdfUITests` they pass (the eighth, `testAPageCanBeGoneToByNumber`, fails on the untouched baseline too).
- **Found while building it.** (1) **The overlay provider must be set before the document**: PDFKit asks for a page's overlay when it makes the page, so one set afterwards is never asked (no canvases at all); the lab does it in this order. (2) With that, and the page view told to take touches, **a finger reaches the canvas in the Simulator** (a hit test in the middle of a page lands on the canvas's own view, and a stroke begins and is recorded); the Pencil is still the iPad's to say. (3) **An empty `allowedTouchTypes` on a gesture recognizer allows no touch at all**: putting the Pencil down first set the scroll view's to `[]` and the book stopped scrolling; the layer now saves the scroll view's own settings and gives those back. (4) The canvas is not in the accessibility tree PDFKit shows, so its label (*Handwriting on page N*) is unverified for VoiceOver.
- **Not known until the iPad:** that a Pencil reaches a canvas through PDFKit's page view once the app has told it to take touches (item 294; the fallback is our own canvas layer); that the Pencil does not also scroll; palm rejection; latency; what the system's tool picker does over a PDF (where it docks, whether it follows the canvas the Pencil is on); memory and the time to leave a page with a dense drawing; the Pencil's double tap and squeeze.
- **Left out on purpose:** the desktop draws no ink yet (D11 says it will, view-only; it keeps and counts it); ink is not searched (handwriting recognition is the `<Ink>` Vision `alt` seam, Gate C); no per-stroke undo outside the picker; a damaged page of ink is left alone until the person draws on that page again; dark pages.

## Spike B status (2026-11-09)

**The instrument is built; the answers are the iPad's.** Nothing here was run with a Pencil or on an iPad. The lab was run in the iPad Simulator (iPadOS 26.4, a
Debug build, a finger standing in for the Pencil, the Mac's memory), which shows how the overlay approach is built and what it costs in shape, not what the numbers will be
on the iPad. The checklist to run on the iPad is [manual-tests/ipad.md](manual-tests/ipad.md#spike-b-the-pdf-ink-lab-m2-pencilkit-over-pdfkit), items 200 to 215.

**What was built.** A lab screen in the iPad app, `apps/ios/Composition/PdfInkLab*.swift`, reached from the notebooks column's *More* menu (*PDF ink lab (spike B)*) or with
`-openPdfInkLab 1`:

- a PDFKit `PDFView` whose `pageOverlayViewProvider` gives each page near the screen a PencilKit `PKCanvasView` (transparent, not scrolling, Pencil-only on an iPad), made when the page
  comes near and dropped when it leaves, with one ink record per page kept apart from the canvas and built into the D9 stroke format (`CompositionInk`) when the page leaves;
- a test book written on the device (500 pages of real, selectable text, a chapter title every tenth page and a drawn figure every seventh; or 30 pages; or 30 with the first nine
  turned and cropped as spike C's fixture does), and *Open a PDF from Files* for a real book;
- runs that go by themselves: scroll through every page at 4, 12 or 30 pages a second, and ink put on 5, 50 or 200 pages by code (a light or a dense page of strokes) and then
  back through the same pages; and a recording for what you do by hand (the touches the PDF sees, the frames and the memory);
- switches for the variants the build may have to choose between: canvases on or off, dropped or kept, off-screen ink held as PencilKit's drawing or its data, a canvas emptied when its
  page leaves, the stroke format built or not, the system tool picker, and PDFKit's page view told to take touches or not;
- a list of 18 cases to try by hand (each marked Fine or Problem, and in the report), *Where does a touch go?* (the view a touch reaches, what is above the canvas, the scroll
  view's touch types), and a *Report* to copy: the device, the settings, the cases, every run, and how each page's canvas sits on its page.

The runs can also be started from the command line, which is how they were exercised here (the app must have notes, or the More menu is not on screen):
`xcrun simctl launch <device> com.rushinglabs.composition.ipad.dev -openPdfInkLab 1 -pdfInkLabPages 500 -pdfInkLabRun scroll,draw5,draw50,draw200,where -pdfInkLabReport <file>`,
with `-pdfInkLabSpeed`, `-pdfInkLabFinger 0`, `-pdfInkLabKeep 1`, `-pdfInkLabHold data`, `-pdfInkLabConvert 0`, `-pdfInkLabEmpty 1`, `-pdfInkLabTouches 0`, `-pdfInkLabCanvases 0`,
`-pdfInkLabDensity light` and `-pdfInkLabTurned 1` for the variants (documented at the top of `runLaunchArguments` in `PdfInkLab.swift`).

**How to run it on the iPad** (the manual-test items are the same, in this order):

1. Install a **Release** build on the iPad (a Debug build is several times slower and its memory is not the app's). Open *More* ▸ *PDF ink lab (spike B)*; the first time it writes the 500-page book.
2. *By hand* ▸ *Where does a touch go?*, then open the *Report*: the line for the canvas must end with "the canvas gets it".
3. Work the *Cases to try* with the Pencil and your fingers (the *Pen* menu's *A finger draws* stays off), marking each.
4. *By hand* ▸ *Start recording*; write for a minute; *Stop recording*. Do the same in Notes and say which is quicker.
5. *Runs* ▸ *Scroll through every page* at 12 pages a second and at 30; once more with *Canvases on the pages* turned off.
6. *Runs* ▸ *Draw on 5 pages*, *50*, *200*; again with *Ink of pages off the screen* set to PencilKit's data, and with *Empty a canvas when its page leaves* on.
7. *Book* ▸ *Open a PDF from Files…* with your biggest book, and the scroll run and a few pages by hand on it.
8. Copy the report (*Report* ▸ the copy button) and send it with the cases marked.

**What each number is.**

| In the report | What it is |
|---|---|
| late, dropped frames, worst frame | From a display link: how the main thread kept up during the run. A canvas made, or ink put on one, on the main thread shows here. (The Simulator is 60 Hz; an iPad Pro is up to 120.) |
| memory, room left | `phys_footprint`, the figure Xcode's gauge shows, sampled four times a second; and `os_proc_available_memory`, how far the app is from the system ending it (the Simulator does not report it). |
| Pencil samples: hardware to the app, hardware to the soonest frame | From the touch's own timestamp: how long the app took to be given each sample (coalesced samples included), and until the first frame that was due after it had it. **This is not the ink's latency**: PencilKit draws, and predicts ahead of the tip, in a way the app cannot time. The real comparison is writing the same words in Notes. |
| making a canvas, putting a page's ink back | Main-thread time to make a `PKCanvasView`, and to set (or decode, with PencilKit's data) a stored page on a canvas that came back. |
| leaving a page with new ink | The stroke format built from PencilKit's drawing, and written as JSON, on one background queue, one page at a time (as the build will do it); the time the work itself takes. |
| a page's record | The JSON's size, zipped, and PencilKit's own data for the same page. |

**What the Simulator showed** (a finger, Debug, the Mac's memory: the shape of it, not decisions):

| Question | Answer |
|---|---|
| Can a canvas in a PDFKit overlay be touched at all? | **Not as PDFKit builds it.** The canvas sits in a `PDFPageView` that has `isUserInteractionEnabled` off, so a touch in the middle of the page reaches `PDFDocumentView`, never the canvas, with the canvas covering that spot. With the page view told to take touches (a change to a view PDFKit owns, which is the lab's *Let touches through* setting, on by default), the canvas gets it and draws. **This is the finding to check first on the iPad**, and the build has to decide whether to rely on it (it is a private view, so it may change) or to lay its own canvas over the `PDFView` and move it with the page. |
| Does the PDF's own scroll take the Pencil? | `PDFScrollView`'s pan accepts finger, Pencil and pointer (touch types 0, 2 and 3, as the lab reads them off it). With canvases on, in the Simulator a one-finger drag over a page scrolls it and draws nothing, as wanted. **Whether the Pencil draws, or scrolls, is the iPad's to say** (item 201). For a finger to draw in the Simulator the lab makes the PDF's pan need two fingers. |
| Where is a stroke, in the page's own space? | The canvas is the page's **unturned crop box** size in points, turned with the page by PDFKit, and canvas (x, y) is page space (crop box's minX + x, crop box's maxY − y) on every page tried: quarter turns, a crop box away from the origin (alone and with each turn), and a small crop. So ink stored as raw user space, as spike C settled for the marks, needs only the flip. Not tried: a media box with a negative origin, `UserUnit`, boxes inherited from the page tree. |
| Do overlays come and go with the pages? | Yes. A pass over 500 pages at 29 pages a second made and dropped 498 canvases with at most 4 to 6 on screen at once; making one took 0.6 ms (p95 1.1 ms); memory without ink stayed in a band over two passes (peaks of 135 and 209 MB, ending at 132 and 159 MB; the Simulator's, in a Debug build). |
| Does the ink come back? | Yes, on a fresh canvas: 1.5 ms (median) to put a page of 18,720 points back, with 200 dense pages restored in a second stretch over them (n = 200; the screenshots show the ink back on page 1, in portrait and in landscape). |
| What does ink cost in memory? | 200 dense pages (3.7 million points) added **232 MB** with the stroke format built and the drawing held, 190 MB with it held as PencilKit's data, 170 MB with the format not built, 174 MB with both, and **89 MB with the format not built, the data held and each canvas emptied as its page left** (against 174 MB without the emptying). So the held drawing and the format are not the main cost: a canvas that has drawn keeps about half of what it cost after its page has gone, unless it is emptied. (A page's record: 727 KB as JSON, 173 KB zipped, 283 KB as PencilKit's data.) |
| What does leaving a page cost? | Building the format took 4 ms and writing its JSON about 300 ms (Debug, off the main thread). **Building them all at once on a background queue was a mistake the lab caught:** 200 pages in parallel peaked at 1,021 MB; one at a time it peaked at 506 MB. The build converts one page at a time. |

**What it cannot see, and the iPad must answer:** whether the Pencil draws and does not scroll with the canvases in place (item 201), whether a long press still selects text and the handles still drag (the Simulator's input could not hold a press reliably, so this was not exercised: item 202), the latency next to Notes (208), palm rejection (204), whether a zoomed canvas stays sharp (205), the memory on the iPad with a real 500-page book and dense ink and which variants help (209 to 213), a stroke across the edge between two pages (204), the system tool picker (207), and every case in the list.

**What it decides for the build.** If the Pencil draws without scrolling and a finger still scrolls and selects, the overlay approach stands, with the page-view change guarded by a check at the first page (the lab's *Where does a touch go?* is the check) and a canvas emptied as its page leaves. If the Pencil scrolls the PDF, or the page-view change does not hold, the fallbacks are, in order: a *Draw / Read* toggle in the reader's strip that turns the canvases' touches on only while drawing; then one canvas laid over the `PDFView`, placed over the page in view by our own code (no change to PDFKit's views, at the price of keeping it in step with scroll and zoom). Risk X3 stays open until the iPad has run it.

## Risks and unknowns

| # | Risk | Mitigation |
|---|---|---|
| X1 | pdf.js is slow or heavy on a 300 MB, 600-page file. **Mostly answered by spike A:** it works under the CSP and opens in about 0.1 s reading about 10 MB, but memory trends toward the file's size over a long session (it keeps what it has read until the document closes). | Range transport, 16 KB chunks, render only visible pages; closing the panel frees it. Still untested: scrolling in a real window, a cold disk. |
| X2 | pdf.js and PDFKit place the same mark differently (crop box, rotation). **Answered by spike C** for stored rectangles: raw user space agrees on all nine test geometries. Open: real multi-line selections, and PDFKit on the iPad. | Raw user-space convention; the spike C checks in `spikes/pdf-reader/coords` as a regression test when the code exists. |
| X3 | PencilKit over PDFKit fights finger scrolling or text selection, or uses too much memory. **Spike B's lab is built; the Simulator found that a canvas is never reached unless PDFKit's page view is told to take touches** ([status](#spike-b-status-2026-11-09)); the iPad still decides the rest. | Spike B; Pencil-only input; overlays only on visible pages; empty a canvas when its page leaves. |
| X4 | Quoted text comes out jumbled on multi-column or odd PDFs (selection order), or a highlight's rectangles merge badly. | Keep the rectangles per line; test on a two-column paper and a scanned-then-OCR file; the user can correct the quote in the note. |
| X5 | A hostile PDF attacks the reader. | Pinned recent pdf.js (this version has no eval to turn off), no scripting, no form widgets, no WebAssembly, the file served only to our own pages. |
| X6 | A backup grows large and slow with textbooks; a Trash Can holds a large file for 60 days. | Counts in the Backup card and the Trash Can row; no cap beyond 1 GB per file. |
| X7 | The TypeScript and Swift implementations drift on the three tables. | The shared fixtures (the iPad design's [conformance corpus](ipad-app-design.md#keeping-two-implementations-honest)). |
| X8 | PDF in M2 widens v1 and the rewrite is already larger than v1 can afford (R3). | The order in P19; `<Ink>` pages are cut first. |
| X9 | The export writer is unmaintained, too big, or has the wrong licence. **Answered by spike D:** `@cantoo/pdf-lib` is MIT, maintained and 614 KB minified, and writes native and flattened marks that pdf.js and PDFKit draw in the right place. | Keep the original `pdf-lib` as a swap; the spike D checks in `spikes/pdf-reader/export` as a regression test when the code exists. |
| X10 | A native-annotation export looks different in another app (PencilKit textures). | Said in the dialog; Flatten is one checkbox away. |
| X11 | A text note in another script loses its characters on export: a standard font holds WinAnsi only, and `@cantoo` writes `?` without an error. **Answered by the owner, 2026-11-07:** Latin, Greek and Cyrillic only. | Noto Sans, and Noto Sans Math for the symbols it lacks (both OFL, bundled into the export worker); a note with a character neither can draw stops the export and is named. CJK and emoji are not supported. |
| X12 | Export of a big file uses 2 to 4.5 times its size in memory and takes seconds; it rewrites the whole file, so a signature in the original is lost and a linearized file is not. | A utility process with progress; say so in the dialog for a signed PDF; an incremental writer of our own is the way out if it ever bites (not built). |

## Not in scope

Shapes, stamps, signatures and form filling; inserted pages and a margin gutter; scanned PDFs and OCR; searching the full text
of every PDF; PDF sync before general sync ships; a reader in the web app or the CLI; the AI helper reading a PDF; iPhone.
The full-text and OCR rows are *later*, not *never*; the others are decisions to revisit only if you ask.

## Docs to change when it ships

All done with Step 6 (2026-11-07), except where a line says what is left.

- [feature-matrix.md](feature-matrix.md): a PDFs section (desktop ✅; web and CLI only the file and the note), and a line under "Shared data, uneven features".
- [architecture/data-model.md](architecture/data-model.md) (three tables, `documents/`, the uuid pass over nine tables) and
  [architecture/backup-restore.md](architecture/backup-restore.md): done with Step 1. [architecture/attachments.md](architecture/attachments.md)
  says a PDF is not an attachment. [architecture/search.md](architecture/search.md) says what a PDF's note is indexed with.
- [ui/panels.md](ui/panels.md) (the PDF panel and its pair), [ui/note-links.md](ui/note-links.md) (`pdf:` links),
  [ui/web-trash-can.md](ui/web-trash-can.md), and the shortcuts list (`shortcuts.ts`, done with Step 3).
- [ipad-app-design.md](ipad-app-design.md): M2's scope (this widens D13) and its exit criteria, a "PDFs (new)" tracker section (all ⬜), and
  compromises C20 and C21. **Left:** its build plan, when the iPad branch is on `main`.
- [cross-device-sync-design.md](cross-device-sync-design.md): documents and marks on the fast-follow list, with their records and hazards.
- [product-positioning.md](product-positioning.md): the attachment-search row.
- New: [ui/pdf.md](ui/pdf.md), [architecture/pdf.md](architecture/pdf.md), [manual-tests/pdf.md](manual-tests/pdf.md), and the line in [index.md](index.md).

## Change log

- 2026-11-07: first version, from a design session with the owner (P1 to P19). Nothing built.
- 2026-11-07: **spike A done** ([findings](#spike-a-findings-2026-11-07)). pdf.js works under the real CSP but does not use
  `Range` on `app://`: the reader needs a range transport, 16 KB chunks and a streaming handler. WebAssembly is blocked and
  pdf.js falls back to JavaScript; the CSP is left alone (my pick). Prototype in `spikes/pdf-reader`.
- 2026-11-07: **spike C done** ([findings](#spike-c-findings-2026-11-07)). pdf.js and PDFKit agree on where a stored rectangle
  goes on all nine test geometries when it is stored in **raw PDF user space**; the plan's first convention (relative to the
  crop box) fails on pages whose boxes do not start at 0,0 and is replaced. PDFKit's highlight quad points are relative to
  the annotation's bounds, and its `bounds(for:)` is unrotated.
- 2026-11-07: **spike D done** ([findings](#spike-d-findings-2026-11-07)). `@cantoo/pdf-lib` (MIT, maintained) writes native and
  flattened marks that pdf.js and PDFKit draw in the right place, on the nine geometries and on four real files including a
  183 MB, 4,351-page manual; pdf.js's own save cannot write underlines or strikeouts. Appearance streams are required for text
  notes. Two new risks: a text note in another script (a standard font writes `?` without an error) and export memory of 2 to
  4.5 times the file. Export drops encryption.
- 2026-11-07: **Step 1 built** (shared schema and core). The three tables, their repositories, the PDF file layer, the orphan sweep,
  backup and restore of `documents/`, the counts message and the conformance fixtures in `fixtures/conformance/pdf`. About
  110 new tests; the web suite (3,814 tests) and the desktop suite (706) pass, and so does everything in the CLI suite that
  passed before (it has 144 failures on a clean checkout too: it wants Node 26 for OpenTUI and this machine has 24). Picks made while building are listed under Step 1 in
  the [build order](#build-order). Nothing is user-visible yet.
- 2026-11-07: **Step 2 built** (import and the reader). The `DocumentsApi`, a streaming byte-range handler, the `pdf` panel kind
  with pdf.js's viewer components, the sidebar's Import PDF… button and PDF rows, the pair opening, the delete dialog and Trash
  Can row naming what is inside, and `pnpm smoke:pdf` (24 checks in the real app). New findings: pdf.js 6.5 has no eval option
  at all (X5's mitigation is moot), and its viewer needs `globalThis.pdfjsLib`. Dragging a PDF in and the File menu are not
  built.
- 2026-11-07: **Step 3 built** (text markup). Highlight, underline and strikethrough in five colors from a selection, typed text
  notes, the popover to recolor, comment on or delete a mark, the Highlights tab, undo and redo (while the app is open), and
  the keys, all stored in raw PDF user space with one record per page for a selection that crosses pages. 44 checks in the real
  app (`pnpm smoke:pdf`); the web suite has 4,009 tests and the desktop suite 754. The fixtures are unchanged (no schema
  change). Picks and findings are listed under Step 3 in the [build order](#build-order).
- 2026-11-07: **Step 4 built** (notes and links). `pdf:` links in the preview and following them to the page and mark, Quote and
  Cite this page into the paired note, the Notes tab, New note for this PDF, pin and follow, and the delete dialog's count of
  citing notes. 58 checks in the real app; the web suite has 4,119 tests and the desktop suite 754. The quote block now has
  an empty quoted line before its citation so that the preview shows it on its own line. Picks and findings are listed under
  Step 4 in the [build order](#build-order).
- 2026-11-07: **Step 5 built** (search and export). The owner note is found by the words of its marks and bookmarks, and the
  Highlights tab filters; **Export annotated PDF** writes a copy with native annotations or flattened, in a utility process, with
  text notes in an embedded font. X11 is answered by the owner (Latin, Greek, Cyrillic); Noto Sans lacks math symbols, so Noto
  Sans Math is bundled too. 63 checks in the real app; pdf.js renders of the writer's output pass on all nine geometries, native
  and flattened; the web suite has 4,198 tests and the desktop suite 774. Picks and findings are listed under Step 5 in the
  [build order](#build-order).
- 2026-11-07: **Step 6 done** (docs and the manual test). Three new pages (what you see and do, how it works inside, and the
  checklist for Gate P1) and updates to the feature matrix, panels, note links, the Trash Can, search, attachments, the iPad
  design (M2 scope, tracker rows, C20 and C21), the sync design (documents and marks on the fast follow) and the positioning
  page. Nothing in the code changed. **Next: Gate P1, which is yours** (`docs/manual-tests/pdf.md`, on a real textbook and a real
  manual); then the iPad's M2 work, which waits for the iPad branch.
- 2026-11-08: **Import gaps, item 1: dragging a PDF in** (P16). A `.pdf` dropped on a group (or Ungrouped) is imported into it; dropped anywhere else in
  the window, into the open group page or the notebook's top level, with a hint while it is over the window. **The owner's choice:** the preload
  script reads the dropped `File`'s path with `webUtils.getPathForFile` and sends it straight to the main process, so the page never names a
  path and a `File` it makes up has none; main checks it (absolute, `.pdf`, a real file, not inside the data folder) before the import's own
  checks and the duplicate question. One PDF at a time. The smoke test (`smoke:pdf`, now with the drag checks) drives it with Chromium's own
  drag events. Picks: a drop is taken ahead of a note editor, which would read a file as text; a text file dragged in is left alone. Still to do:
  the PDF's own title, the password prompt.
- 2026-11-08: **Import gaps, item 2: File > Import PDF…** (P16). A menu item at the top of the File menu (with a separator under it) brings the main
  window forward and tells its page to start the import its own button starts, into the group whose page is open or else the notebook's top level (the
  same place a window drop goes); the page asks the main process to open the picker, so no path is involved. Added to `appMenu.test.ts` (placement) and
  `importPdfRequest.test.ts` (the click), with `useImportPdfRequest.test.tsx` on the page side, and to `smoke:pdf` (menu content, top level, into an open group, cancel,
  duplicate) and the bridge list in `smoke.mjs`. Picks: no keyboard shortcut (none is free that the editor does not use); the item does nothing while the Settings page
  is showing; with no main window open it opens one and imports nothing. Still to do: the PDF's own title, the password prompt.
- 2026-11-08: **Import gaps, item 3: the PDF's own title** (P16). When the reader opens a PDF whose note still has the title made from the file's name, and the PDF's
  metadata has a sensible title (XMP `dc:title` first, then Info `Title`; not a placeholder, a file name, garbled, empty or over 200 characters), the note takes it,
  through the workspace store, in its frontmatter, saved like any edit. A title the user changed is never replaced. Pick: **no stored "done" marker**; the test
  is whether the note still has the file-derived title, which the change itself ends (a stored flag would have changed the view-state schema the iPad core
  reproduces). Checked in the real app by `smoke:pdf` (a title taken, XMP over Info, a placeholder passed over, a note renamed before its PDF first opened
  keeps its name); `pdf-fixture.mjs` can now write an Info title and an XMP title. Still to do: the password prompt.
- 2026-11-08: **Import gaps, item 4: a prompt for a password-protected PDF.** When pdf.js raises `PasswordException`, the reader asks for the password in a small dialog,
  tells a wrong one, and tries again; Cancel leaves the panel with an **Enter password…** button. The password is kept in memory only (the documents store, not in its
  snapshot), so reopening the PDF in the same session does not ask again and a restart does; it is never stored or logged (the smoke test searches every file the app wrote
  after quitting, and the console). **The owner's choice for export:** it takes the password and writes a copy **protected with the same password**, not an unprotected one:
  same user password, the original's permission flags (read from the encryption dictionary the library leaves behind once it has decrypted the file; a test pins that), a
  made-up owner password kept by no one, AES-256. Tested against pdf.js on AES-256, AES-128, RC4-128 and RC4-40 originals, and on a PDF that is only restricted (no password to
  open; it now exports too, with its limits kept, where it used to be refused as "password-protected"). Checked in the real app by `smoke:pdf` (dialog, wrong then right
  password, no second question, nothing written to disk, asked again after a restart, Cancel and Enter password…, export through the utility process read back). Picks:
  the password box is emptied as soon as it is sent; a wrong password is asked for again with no limit; a PDF opened with an *owner* password exports with that as the copy's
  password and keeps the original's limits. **With this, the four gaps Steps 1 to 6 left are built**; `docs/ui/pdf.md` no longer lists them as not built.
- 2026-11-09: **M2 on the iPad, third and fourth steps: import and the reader** (in the order of P19: the Swift core's tables and files, then the PDFKit reader and the split). *Import PDF* and a drag from Files make the owner note and copy the file in through `DocumentLibrary`; the reader is a PDFKit `PDFView` beside the note (side by side from 900 points, a switch below), with the system's find bar, the PDF's contents, bookmarks, go-to-page, a password prompt and the page and zoom kept per PDF; the Trash Can, deleting a group for good and the sweep at launch take a purged note's file with it. Run in the iPad Simulator only (seven UI tests, `scripts/pdf-flow-test.sh`); the status and what is not built are in the [iPad design's tracker](ipad-app-design.md#pdfs-new). Marks, the Notes tab, quoting, Pencil ink (spike B first) and export are the next steps.
- 2026-11-09: **The iPad's PDF work up to the ink, for Gate P2** ([details](#the-ipads-build-2026-11-09)). Typed markup (highlight, underline, strikethrough in the five colours from a selection, typed notes, a card to recolour, comment on, quote and
  delete a mark, undo and redo), the Highlights and Notes tabs, Quote, Cite this page, `pdf:` links followed from the preview (the PDF opens beside the note, the mark flashes) and drawn struck through when the PDF is not here, search finding a PDF's note
  by its marks, and Export annotated PDF (native with appearance streams, or flattened; share sheet), in the Swift packages (`PdfRefs` replaying `fixtures/conformance/pdf-refs.json`; the new `CompositionPDF` target tested on the nine page geometries) and the app.
  **Spike B's lab is built** (`More, PDF ink lab (spike B)`, `PdfInkLabUITests`) and run in the Simulator; the Pencil is not. **Checked in the Simulator and under `swift test` only; nothing was tried on an iPad and nothing in Gate P2 is ticked.** Not built: Pencil ink on a
  PDF, the Pencil's highlighter snapping to lines, handwritten notes beside the PDF, `<Ink>` pages, dark pages, moving a typed note. The checklist is items 180 to 214 of [manual-tests/ipad.md](manual-tests/ipad.md).
- 2026-11-10: **Pencil ink on a PDF** ([details](#ink-on-the-pages-2026-11-10)). `main` merged into the Gate P2 branch (spike B's lab, PR #290, replaces this branch's copy; manual-test items renumbered, Gate P2 was then 220 to 262, and is now 268 to 310). One ink row per page (D9 strokes, canvas coordinates), `PdfInkLayer` over PDFKit's overlays, the pencil button, *Finger draws*, the Highlights tab's *Ink* section, export as native `Ink` annotations (textured strokes simplified), checked on the nine geometries. Simulator with a finger and `swift test` only; no Pencil. Left: handwritten notes beside the PDF, `<Ink>` pages, the desktop drawing the ink.
- 2026-11-09: **spike B's lab is built and exercised in the Simulator; the iPad's answers are open** ([status](#spike-b-status-2026-11-09)). A PDF ink lab in the iPad app (`PdfInkLab*.swift`): a `PDFView` with a PencilKit canvas on each page near the screen, a book written on the device (or one of yours from Files), runs that scroll and draw by themselves and measure, a recording for what is done by hand, a list of cases and a report. Found in the Simulator: PDFKit's page view takes no touches, so a canvas in an overlay is never reached unless the page view is told to; the canvas is the page's unturned crop box in points with a plain flip to raw user space; overlays are cheap to make and drop; ink restores quickly; and ink's memory is mostly what a canvas keeps after it has drawn, so a canvas is best emptied as its page leaves. Manual-test items 200 to 215.
