# PDFs: how reading, marking, citing and exporting work

Source: [`documentsApi.ts`](../../apps/web/src/lib/composition/documentsApi.ts) (what the page may ask),
[`documentsRepo.ts`](../../apps/web/src/lib/composition/documentsRepo.ts),
[`pdfMarkupRepo.ts`](../../apps/web/src/lib/composition/pdfMarkupRepo.ts),
[`pdfMarkup.ts`](../../apps/web/src/lib/composition/pdfMarkup.ts) (the rules a mark must meet),
[`documents.ts`](../../apps/web/src/lib/composition/documents.ts) (the files),
[`main/documents.ts`](../../apps/desktop/src/main/documents.ts), [`main/rangeResponse.ts`](../../apps/desktop/src/main/rangeResponse.ts),
[`main/exportProcess.ts`](../../apps/desktop/src/main/exportProcess.ts), [`worker/exportWorker.ts`](../../apps/desktop/src/worker/exportWorker.ts),
[`pdfExport.ts`](../../apps/web/src/lib/composition/pdfExport.ts), [`pdfRefs.ts`](../../apps/web/src/lib/composition/pdfRefs.ts),
and the reader in [`components/pdf/`](../../apps/web/src/components/pdf/). What you see and do: [ui/pdf.md](../ui/pdf.md). The design,
the spikes that decided it, and the risks: [pdf-markup-plan.md](../pdf-markup-plan.md).

**Desktop only.** The reader, the import, the marks and the export are the desktop app's. The shared data layer (tables, repositories,
validation, citations, the writer) is plain TypeScript in `apps/web/src/lib/composition`, so the iPad's Swift core can reproduce the
tables and rules from the conformance fixtures in [`fixtures/conformance/pdf`](../../fixtures/conformance/README.md).

## What is stored

A PDF is **a note that owns a PDF**: one row of `documents` per owner note (a unique index on `note_id`), a file in `documents/` in the
application data folder, and the marks and bookmarks beside it in `pdf_annotations` and `pdf_bookmarks`. The three tables and their
columns are in [data-model.md](data-model.md#the-pdf-tables); the backup of the folder in [backup-restore.md](backup-restore.md).
All three tables carry a `uuid` (a fill trigger and a unique index, like every other table that sync will move), which is what a citation names.

- **The file is never written after import.** It is copied in, hashed (SHA-256), and kept under a name made of 12 random hex digits and
  the original name made safe. The marks are rows, not changes to the file; **Export** makes a new file.
- **An attachment is not a PDF.** An attachment is a file that is never displayed and never opened by the app; a reader needs the opposite,
  so a PDF has its own table, its own folder and its own serving path, and the attachment rules are unchanged.
- **Rectangles are in raw PDF user space**: the numbers a PDF's own annotation `/Rect` and `/QuadPoints` use, in points, unrotated,
  whatever the page's crop box, media box, rotation or `UserUnit`, rounded to a thousandth. Each viewer maps them to its screen with its own
  call (pdf.js's page viewport here, PDFKit on the iPad), and the export writes the same numbers back out. Spike C found pdf.js and PDFKit agree
  on nine awkward geometries this way and disagree on boxes that do not start at 0,0 if the numbers are made relative to the crop box.
- **A selection that crossed pages** is one record per page tied by a `group_uuid`; deleting one deletes them all.
- **A page count of 0** means the reader has not counted yet; a mark may be on any page until it has, and only on a real one after.

## Import

The renderer never names a path. `importPdf(target)` makes the **main process** open the system's file picker
(`DocumentUi.pickPdf`), and `service.importPdf` then copies the file into `documents/`, checks that its first 1 KB holds a `%PDF-` header and
that it is at most 1 GB, hashes it, makes a note in the group and notebook the sidebar was on, and gives that note the PDF. A failure
leaves no note behind. If the same bytes are already in the library the answer is `duplicate`, carrying a **random token** that stands for the
picked path, which the main process holds (at most four, newest kept); **Import a separate copy** sends the token back, so the page never
learns where the file is. The reader counts the pages on first open and tells the store, which saves the count.

**A password.** `openPdf(id, password?)` hands the password to pdf.js, which raises `PasswordException` with a code (1: needed, 2: wrong); that becomes a
`PdfPasswordError(incorrect)`, whose message says nothing of the password. `usePdfViewer` catches it, shows a `password` phase (`PdfPasswordDialog` in the reader) and
tries again with what is typed, until the PDF opens. The password that worked goes to the **documents store** (`rememberPassword`), a `Map` that is not part of the
snapshot, so it is not in what every panel reads, in React state, in storage, or in the database, and a panel opened again, in any window (they share the store), is
offered it first. It is in memory only: nothing writes it, and the smoke test looks for it in every file the app wrote after quitting. It leaves the renderer in
exactly one place: an export sends it to the main process (`ExportPdfOptions.password`, checked by `exportOptions` in `validate.ts`: a non-empty string of at most 1,024
characters, never named in an error), which hands it to the export's utility process in the job message and nowhere else.

**The PDF's own title.** The note is first titled from the file's name (`pdfTitleFromFileName`). When the reader opens the file, `usePdfViewer` asks pdf.js
for its metadata and passes the title up (`onTitle`, through `PdfReader` to the panel, which calls `store.retitleFromPdf`). `pdfTitle.ts` holds the rules,
as pure functions: the XMP `dc:title` is read before the Info dictionary's `Title` (as pdf.js's own viewer orders them); a title is *sensible* if it has
a letter or digit, is one line of at most 200 characters, and is not a placeholder, a file name or garbled; and `retitleFromPdf` says whether to change
the note, which it does only when the note's current title is exactly the one the file's name gives (so a title the user typed is never replaced) and
differs from the PDF's. The store changes the title in the owner note's frontmatter and saves it through `editNote`, like any edit; the server reads the
title column back from it. There is **no stored marker** of having done it: after the change the note no longer has the file's title, so the next open
finds nothing to do. (The one case that would repeat it: the user types the file-derived title back by hand.)

**File > Import PDF…** carries no path either. `importPdfMenu.ts` puts the item (id `import-pdf`) at the top of Electron's default File menu, found by role
(`fileMenuIndex` in `appMenu.ts`), and its click runs `requestImportPdf` (`importPdfRequest.ts`): it brings the main window forward and pushes
`IMPORT_PDF_CHANNEL` to that one window's page, with no payload (with no main window it opens one, as the Dock icon does, and starts no import). The
preload's `onImportPdfRequest(listener)` delivers it; `useImportPdfRequest` in `NotesApp` runs the same `onImportPdf` the sidebar button runs, with the target
the page already knows (the open group page, else the notebook's top level), so the main process opens the picker as ever. The main window is tracked in
`index.ts` (`mainWindow`), since a pop-out has no workspace of its own to answer.

**A dropped file** is the other way in, and the path still never comes from the page. The page's drop handler (`usePdfDrop` for the window,
`DropZone` in `GroupTree.tsx` for a group row) hands the drop's `File` to `importDroppedPdf(file, target)`. A `File` cannot cross the bridge, so
that one method is written by hand in the preload script: it reads the path with Electron's `webUtils.getPathForFile` and sends only that to the
main process (the page never sees it, and a `File` the page makes up has no path, which the preload sends as an empty string). The main process
then checks it before `service.importPdf` looks inside the file (`droppedPdf.ts`): an absolute path, a name ending in `.pdf`, a real file (the link
is followed, not a folder), and not inside the application data folder, which would copy the library into itself. A duplicate is answered with a
token exactly as the picker's is. `DocumentsApi.importDroppedPdf` takes a `File` while the main process implements `DocumentsHost`, the same
interface with a path in its place. The window's handler runs in the capture phase, so it sees the drop before a note editor (which would take
a dropped file as text); a group row marks itself `data-pdf-drop-zone`, and the window's handler leaves drops on it to the row.

`removeOrphans` (the sweep that runs when the app opens and clears the Trash Can of expired notes, and when a note is deleted for good by hand) deletes the file, marks and bookmarks
of any PDF whose owner note is gone for good, next to the attachments' own sweep; each is swept on its own, so one failing does not skip the other.

## Serving the bytes

pdf.js is given the PDF as a URL on the app's own scheme, `app://composition/documents/<id>`, served by the main process from the file on
disk with `Range` support (`rangeResponse.ts`; the handler for images and attachments reads whole files, which a 400 MB textbook cannot
afford). Three findings of spike A shaped the reader:

- pdf.js **does not use `Range` itself on a non-HTTP URL**, so the reader hands it a `PDFDataRangeTransport` that fetches ranges from that
  route, with a **16 KB chunk size** (a 405 MB, 600-page file opened reading about 10 MB, where 512 KB chunks read 297 MB).
- The route answers only the app's own pages, sends `nosniff`, and is never navigable.
- The app's CSP has `object-src 'none'` and `connect-src 'self'`, so Chromium's built-in PDF viewer is out and pdf.js draws to canvases from
  these bytes. WebAssembly is blocked by the CSP (no `'wasm-unsafe-eval'`); pdf.js is told `useWasm: false` and uses its JavaScript
  decoders. pdf.js 6.5 has no `eval` to turn off, and no PDF scripting or form widgets are loaded.

The scheme is registered with `corsEnabled`, and the response carries an `Access-Control-Allow-Origin` header only for the development
server's own origin, so `next dev` can fetch the bytes as well as the built app.

## The reader

`usePdfViewer` loads pdf.js with a dynamic import (it is large, and only a PDF panel needs it) and drives its own viewer components
(`pdf_viewer.mjs`), which need `globalThis.pdfjsLib` set before they load. The worker, CMaps, standard fonts and ICC profiles are copied from the
pinned `pdfjs-dist` into `public/pdfjs/` by `pnpm copy:pdfjs` (the desktop build and dev loop run it; the folder is not committed) and served by the
app scheme. pdf.js builds a page's text layer and canvas as it scrolls into view and builds them again when it redraws, so everything laid over a
page is rebuilt on the viewer's `pagerendered`, `textlayerrendered` and `scalechanging` events.

Marks are drawn by `PdfMarkLayers` into two layers on each page: an **under** layer right after the page image (highlights multiply into the
page, or screen on dark pages, where multiplying by black would hide them) and an **over** layer for text notes, the popover and the catcher that
places a note. Neither takes the mouse, so the text layer under them stays selectable; a click on a mark is found by testing the stored rectangles.
**Dark pages** is a CSS filter on the page images only.

A selection becomes marks in `selectionMarks.ts`: the range's rectangles, taken relative to the page's content area (inside its border), merged to
one per line, converted to raw user space through the page's viewport (`pdfGeometry.ts`), with the words as the quote (a line break, which pdf.js
writes as a `<br>` with no space, reads as a space).

## Marks and undo

The renderer calls `DocumentsApi` over IPC: `listAnnotations`, `addAnnotations`, `updateAnnotation`, `deleteAnnotation`, `restoreAnnotations`
(and the bookmark and document methods). The validators (`validate.ts`) accept ids and plain records only, at most 500 marks in a call; the
repository then checks each mark with `pdfMarkup.ts` (a kind, one of five color names for text marks, a one-line comment up to 500 characters,
rectangles that have an area, a text note's body) and against the PDF's page count. Writes are one transaction: all or none.

`documentMarks.ts` is the renderer's controller: a serial queue per PDF, the marks as the page sees them, and an **undo and redo** history of
create, delete and update steps (200 deep, kept in memory only). A delete is undone with `restoreAnnotations`, which puts the rows back with the same
`uuid`, group and times, so a note's citation of a deleted mark works again. The documents store (`documentsStore.ts`) lives with the workspace, so
every panel showing the PDF, in any window, agrees.

## Panels, the pair and citations

A `pdf` panel's saved state is `{ documentId, noteId, follow }`: the PDF, and the note it is paired with, pinned or following the note in use
(`pdfSubject`, `setPdfFollow` and `openNoteForPdf` in `panelsState.ts`, modelled on the AI helper's `assistantSubject`). A followed link adds `goTo`
(a page, a mark's uuid and a sequence number) to the panel's state; the reader shows it once it is open and its marks are read, flashes the mark, and
asks the store to drop it (`clearPdfGoTo`, by sequence number, so a newer request is not lost). It is not saved.

A citation is `pdf:<uuid>#p=<page>&a=<mark uuid>` in the note's Markdown (`pdfRefs.ts`: the format, a parser that drops a damaged part and keeps the
rest, the writers, and the scan for which pages and marks a note cites). The preview's URL allowlist lets `pdf:` through and still drops unsafe
schemes; the preview's link component asks `usePdfLinks` whether the PDF is here (its note is live) and follows it with `openLinkedPdf`.
**Nothing in the database records links**, so a PDF's notes are found by reading note text: the Notes tab and the Highlights tab's "quoted" marker
read it from the notes the workspace already holds in memory (`citationsFor`), which follows what is typed at once, and the delete dialog's count
uses the same scan in `documentsRepo.listCitations` (a `LIKE` on the PDF's uuid, then the same parse).

**Quote** and **Cite this page** write into the paired note through a registry of open editors (`noteInsertions.ts`): each note panel registers an
`insertMarkdown` function (the editor's own control, which places the text at the caret, or at the end if the user has not been in the editor, never in
the frontmatter, and spaces a block quote with blank lines), and a note that is not open is appended to through the workspace store. Quoted words go
through `escapeMarkdown`, so a `*`, `<` or `{` in a textbook starts no Markdown or MDX.

## Search

[Search](search.md) holds one document per note. A note that owns a PDF is indexed with the words of its PDF's marks (quotes, comments, text notes)
and its bookmarks' labels appended to its content (`marksSearchText`), so a search for a word in a highlight finds the note. Only ids come back from a
search, so the added words are never shown. Any change to a mark or bookmark re-indexes the owner note afterwards without the caller waiting
(`reindexOwnerSoon`: while one pass is running, further changes ask for exactly one more). The full text of the PDF is **not** indexed.

## Export

`exportDocument(documentId, { flatten })` is a method like the others, but the main process orchestrates it (`main/documents.ts`): it fetches the file's
path and the marks from the service, opens the **save dialog** itself, refuses a target that is the library's own file, and hands a job
`{ sourcePath, targetPath, marks, flatten }` to a **utility process** (`exportProcess.ts`; `utilityProcess.fork`, started for each export and ended when
it answers or exits). A full rewrite of a PDF holds two to four and a half times its size in memory, and the main process is every window's.

The worker (`worker/exportWorker.ts`) is bundled by `scripts/build-main.mjs` into `dist/export-worker.js` with the writer, fontkit and the two
fonts (esbuild's `binary` loader), and unpacked from the app archive (`asarUnpack`) because a child process starts from a real file; `workerPath`
finds the unpacked copy. It reads the PDF, writes the copy as `<target>.part` and renames it into place, and answers `{ ok, written, skipped }` or an error.

`pdfExport.ts` uses `@cantoo/pdf-lib` (spike D: the maintained fork, MIT, the only one that decrypts RC4 files) and `fontkit`:

- **Native:** `Highlight`, `Underline`, `StrikeOut` and `FreeText` annotations, each with `Rect`, `QuadPoints` (one quad per line), a color and
  opacity, `Contents` (the comment), `NM` (the mark's uuid), `M` (its change time) and a **hand-written appearance stream** (without one pdf.js draws no
  text note and the highlight's shape differs by viewer). **Flattened:** the same appearance forms are invoked from the page's content, no annotation
  added. Existing annotations (links, say) survive.
- **Text notes** are laid out here (`layoutNote`: newlines kept, wrapping at spaces, a word wider than the line broken) and written in Noto Sans, or
  Noto Sans Math for a character the first lacks (both SIL OFL, subsetted per export, embedded only when a note needs them). On a page whose `/Rotate`
  is 90, 180 or 270 the appearance carries a matrix that turns it back, so it reads upright, as the reader shows it. A note with a character neither font has
  **refuses the export**, naming it, rather than letting the library write a `?`.
- **Protected PDFs.** `PDFDocument.load` is given the password (an empty one when none was sent, which opens a PDF that is only restricted). A PDF that needs one that was not
  given, or a wrong one, is refused with a reason that does not repeat it. **The copy is protected the way the original was** (`originalProtection`, `protectCopy`): the library
  decrypts a file it was given the password of and leaves its encryption dictionary behind as an unused object, which is where the permission flags (`/P`) are read, so the
  copy has the same limits on printing, copying and so on; it is encrypted with the same password (AES-256, whatever the original used) and a made-up owner password that is
  kept by no one, so the limits cannot be lifted. A test pins that behaviour of the library (an upgrade that changes it fails the test instead of writing an unprotected copy).
  `ignoreEncryption` is never used, since it writes a file that still says it is encrypted. A file that is not protected is not protected by the export, even if a password was sent.
- **Refused:** a file that cannot be read, a PDF whose password was not given or is wrong, and a note with a character no font can draw.
  **Left out and counted:** ink (its stroke format is not final, D9) and a mark on a page the PDF does not have.
- **Lost by a full rewrite:** a digital signature, and a linearized file's linearization.

## Hostile and damaged files

A restored database can come from someone else, so a PDF is treated as untrusted. pdf.js is pinned to a release well past the 2024 script-execution
fix, loads no scripting, form widgets or WebAssembly, and gets only bytes served by the app scheme. The renderer never supplies a path (the main process holds picked paths and tokens), a restored backup's `documents/` names are
checked against the stored-name pattern, and the export reads only the library's file and writes only where the system's save dialog said.

## How it is checked

- Unit tests beside each module (validation, the repositories against a real database, the store and its undo, geometry, selection to marks, the layers,
  the reader with a fake viewer, the pairing and link following, the export's structure on nine geometries, the process runner).
- [`fixtures/conformance/pdf`](../../fixtures/conformance/README.md): the schema, the validation rules and operation scripts that the Swift core must reproduce.
- `pnpm --dir apps/desktop smoke:pdf` drives the real app (import, dragging PDFs in with Chromium's own drag events and importing through the File menu, ranges under the CSP, the reader, marks, undo, citations and following, the Notes tab,
  export native and flattened read back, delete and the Trash Can, restart). `smoke.mjs` checks the bridge's members and, for a packaged app, that the
  export worker is unpacked.
- `spikes/pdf-reader/export/app-writer-check.mjs` renders the writer's output with pdf.js on the nine geometries (native and flattened) and compares it
  with the original; the other spike checks (`coords`, `export`) are the PDFKit side, run on a Mac.
- The manual test: [manual-tests/pdf.md](../manual-tests/pdf.md).

## Known limits

Links inside a PDF (a contents page, a cross-reference) are followed by pdf.js's link service; how a link to a web address inside a PDF behaves has not
been checked. The reader needs the whole app (a web build has none); undo history is not stored; a followed link works from the preview only; a note open in two panels
takes a quote in the later editor; export is checked against pdf.js (not yet Acrobat or PDFKit's reading of this writer), has not been measured near the
1 GB limit, and has not been started from a packaged app in CI (only that its file is unpacked). Ink, handwritten notes, the full text of a PDF and
scans are not built ([the plan](../pdf-markup-plan.md#not-in-scope)).
