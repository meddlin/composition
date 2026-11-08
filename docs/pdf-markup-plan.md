# PDF reading, markup and notes: design and build plan

Import a PDF, mark it up (on the iPad, with the Apple Pencil), keep bookmarks, and read it with your notes beside it. On the
desktop the same PDF opens next to a note you type while you read. Status: **design only. Nothing is built, and nothing here has
been tried in code or on a device.** Decided with the owner on 2026-11-07, in a question-by-question session (the decisions are
in [What is decided](#what-is-decided)). Anything marked **my pick** is a judgment the owner has not made; **Inference** is
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
an embedded font, never a standard one. Export of a password-protected PDF writes an **unprotected** copy (the writer
decrypts it), and asks for the password if the file needs one.

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
     500 pages. It runs at the start of M2 and gates the iPad's ink, not the desktop's work.
1. **Shared schema and core (TypeScript).** The three tables with uuids, repos, `removeOrphans` for documents, backup and
   restore of `documents/`, the counts message, tests as each earlier schema opened (the intent of `db.test.ts`), and fixtures
   the Swift core will replay.
2. **Import and the reader.** Importing, serving bytes, the `pdf` panel kind, the PDF row in the tree, the pair opening, outline,
   bookmarks, resume, find, dark pages, the new delete dialog and Trash Can row.
3. **Text markup.** Highlight, underline, strikethrough, typed text notes, the Highlights tab, undo and redo.
4. **Notes and links.** `pdf:` links (preview, editor, Live tab), Quote, Cite this page, link following, the Notes tab, New note
   for this PDF, pin and follow.
5. **Search and export.** The owner note's search entry, and Export annotated PDF.
6. **Docs and the manual test.** [Docs to change](#docs-to-change-when-it-ships) and `docs/manual-tests/pdf.md`.
7. **Gate P1 (yours):** the manual test by hand on a real textbook and a real manual.
8. **iPad M1 finishes** as planned (not part of this plan).
9. **M2, in order:** the Swift core's three tables against the shared fixtures; the PDFKit reader and the split; typed markup,
   bookmarks, the Notes tab and import from Files; spike B; **Gate C** (the ink stroke format, including one ink record per
   page); Pencil ink on PDFs; handwritten notes beside the PDF; export on the iPad; then standalone `<Ink>` pages.
10. **Gate P2 (yours):** the iPad manual test, extending `docs/manual-tests/ipad.md`.

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

## Risks and unknowns

| # | Risk | Mitigation |
|---|---|---|
| X1 | pdf.js is slow or heavy on a 300 MB, 600-page file. **Mostly answered by spike A:** it works under the CSP and opens in about 0.1 s reading about 10 MB, but memory trends toward the file's size over a long session (it keeps what it has read until the document closes). | Range transport, 16 KB chunks, render only visible pages; closing the panel frees it. Still untested: scrolling in a real window, a cold disk. |
| X2 | pdf.js and PDFKit place the same mark differently (crop box, rotation). **Answered by spike C** for stored rectangles: raw user space agrees on all nine test geometries. Open: real multi-line selections, and PDFKit on the iPad. | Raw user-space convention; the spike C checks in `spikes/pdf-reader/coords` as a regression test when the code exists. |
| X3 | PencilKit over PDFKit fights finger scrolling or text selection, or uses too much memory. | Spike B; Pencil-only input; overlays only on visible pages. |
| X4 | Quoted text comes out jumbled on multi-column or odd PDFs (selection order), or a highlight's rectangles merge badly. | Keep the rectangles per line; test on a two-column paper and a scanned-then-OCR file; the user can correct the quote in the note. |
| X5 | A hostile PDF attacks the reader. | Pinned recent pdf.js, eval off, no scripting, file served only to our own pages. |
| X6 | A backup grows large and slow with textbooks; a Trash Can holds a large file for 60 days. | Counts in the Backup card and the Trash Can row; no cap beyond 1 GB per file. |
| X7 | The TypeScript and Swift implementations drift on the three tables. | The shared fixtures (the iPad design's [conformance corpus](ipad-app-design.md#keeping-two-implementations-honest)). |
| X8 | PDF in M2 widens v1 and the rewrite is already larger than v1 can afford (R3). | The order in P19; `<Ink>` pages are cut first. |
| X9 | The export writer is unmaintained, too big, or has the wrong licence. **Answered by spike D:** `@cantoo/pdf-lib` is MIT, maintained and 614 KB minified, and writes native and flattened marks that pdf.js and PDFKit draw in the right place. | Keep the original `pdf-lib` as a swap; the spike D checks in `spikes/pdf-reader/export` as a regression test when the code exists. |
| X10 | A native-annotation export looks different in another app (PencilKit textures). | Said in the dialog; Flatten is one checkbox away. |
| X11 | A text note in another script loses its characters on export: a standard font holds WinAnsi only, and `@cantoo` writes `?` without an error. | Embed a font through `fontkit`, bundle one the app may redistribute (an OFL one such as Noto Sans), and decide how far its coverage goes (CJK and emoji are large). Test a note in each script. **Open.** |
| X12 | Export of a big file uses 2 to 4.5 times its size in memory and takes seconds; it rewrites the whole file, so a signature in the original is lost and a linearized file is not. | A utility process with progress; say so in the dialog for a signed PDF; an incremental writer of our own is the way out if it ever bites (not built). |

## Not in scope

Shapes, stamps, signatures and form filling; inserted pages and a margin gutter; scanned PDFs and OCR; searching the full text
of every PDF; PDF sync before general sync ships; a reader in the web app or the CLI; the AI helper reading a PDF; iPhone.
The full-text and OCR rows are *later*, not *never*; the others are decisions to revisit only if you ask.

## Docs to change when it ships

- [feature-matrix.md](feature-matrix.md): a PDF section (desktop ✅; web and CLI only the file and the note).
- [architecture/data-model.md](architecture/data-model.md) (three tables, `documents/`, the uuid pass over nine tables),
  [architecture/backup-restore.md](architecture/backup-restore.md), and [architecture/attachments.md](architecture/attachments.md)
  (one line saying a PDF is not an attachment).
- [ui/panels.md](ui/panels.md) (the PDF panel and its pair), [ui/note-links.md](ui/note-links.md) (`pdf:` links), and the
  shortcuts list.
- [ipad-app-design.md](ipad-app-design.md): the tracker rows, M2's scope (this widens D13), and new compromise rows (markup is
  invisible to other apps until exported; annotated export simplifies textured ink). Plus its build plan, when the iPad branch
  is on `main`.
- [cross-device-sync-design.md](cross-device-sync-design.md): documents and marks on the fast-follow list.
- [product-positioning.md](product-positioning.md): the attachment-search row.
- New: `docs/ui/pdf.md`, `docs/architecture/pdf.md`, `docs/manual-tests/pdf.md`, and a line in [index.md](index.md).

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
