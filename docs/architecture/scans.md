# Scanned notes: how pictures of pages become a note, and how their words reach Search

Source, shared rules and tables (TypeScript, the oracle): [`scanText.ts`](../../apps/web/src/lib/composition/scanText.ts) (the guard, how a
read line is stored, a page's search text), [`scansRepo.ts`](../../apps/web/src/lib/composition/scansRepo.ts), the `SCANS_SCHEMA` in
[`db.ts`](../../apps/web/src/lib/composition/db.ts). The iPad's Swift port: [`ScanText.swift`](../../apps/ios/CompositionCore/Sources/CompositionCore/Scans/ScanText.swift),
[`ScansStore.swift`](../../apps/ios/CompositionCore/Sources/CompositionCore/Scans/ScansStore.swift),
[`ScanImport.swift`](../../apps/ios/CompositionCore/Sources/CompositionCore/Scans/ScanImport.swift),
[`ScanPdf.swift`](../../apps/ios/CompositionCore/Sources/CompositionPDF/ScanPdf.swift) (pictures into a PDF, a page back into a picture, Vision), and
the app's [`AppModel+Scans.swift`](../../apps/ios/Composition/AppModel+Scans.swift) and
[`ScanImportSheet.swift`](../../apps/ios/Composition/ScanImportSheet.swift). Why it is shaped this way, the engines that were weighed, and the
open decisions: [scanned-notes-ocr-research.md](../scanned-notes-ocr-research.md).

**Built: the iPad's first slices** (research slices 1 and 2): scans in as a note you read and write beside, and the words Vision is sure of
found by Search. **Not built yet:** a view to review and correct the lines (slice 3), selecting, highlighting and quoting a line of
handwriting (slice 4), and anything on the desktop beyond the shared tables (it keeps a scan's rows through a backup and deletes them with the
PDF, but does not search them yet: slice D1).

## A scan is a PDF

A scan is **an image-only PDF made at import**, owned by a note like any PDF ([pdf.md](pdf.md)). So the reader, Pencil ink on the pages,
typed notes, highlights' neighbours (bookmarks, `pdf:` citations, the Notes tab), the Trash Can, export and backup all work on a scan
unchanged; nothing about a scan needs a reader of its own.

- **One page per picture, the size of the paper.** A picture whose density is believable (100 to 1,200 dots per inch, what scanners write) is
  drawn at that size: a 300 dpi US Letter scan is a 612 by 792 point page. Any other picture (a phone photo says 72) is drawn 11 inches on its
  long side. So a page is never 35 inches wide, and marks keep their usual convention: raw PDF user space.
- **A JPEG goes in as it is.** CoreGraphics embeds a JPEG-backed image without decoding and encoding it again, so a page costs what its JPEG
  costs (checked: a 1,275 by 1,650 JPEG made a PDF less than 8 KB larger). Any other picture (HEIC, PNG, TIFF) is made a JPEG at quality
  0.85 first.
- **Upright as it is seen.** The picture's EXIF orientation (all eight, mirrored ones too) and the quarter turns the person gave it in the
  import sheet are drawn into the page's content; the page itself has no `/Rotate`. Checked for all 32 pairs against what ImageIO shows for
  the same file.
- **The file is never written after import**, as for every PDF: what is read from it is kept beside it.

`documents` gains nothing. A PDF **is a scan because it has `scan_pages` rows**, one per page, made at import.

## What is stored

Two tables beside the PDF tables, in the shared schema (`SCANS_SCHEMA` in db.ts; `Schema.scans` in Swift), each with a `uuid` (fill trigger and
unique index) for sync:

| Table | One row per | Columns that matter |
|---|---|---|
| `scan_pages` | page of a scan | `document_id`, `page` (0-based; unique with the document), `engine` and `recognized_at` (null until the page has been read) |
| `scan_lines` | line read from a page | `document_id`, `page`, `line` (reading order), `rect` (JSON `[x0, y0, x1, y1]` in raw PDF user space, as marks), `text` (what the engine read), `confidence` (0 to 1, to a thousandth), `engine`, `status`, `corrected` |

- **Per line, not per page**, so that a hit can be shown on the page, a person corrects one line without retyping a page, the engine's
  confidence is kept where it gives it, and two devices' corrections can merge line by line.
- **`engine` names what read the line and on what**: `apple-vision/text/3/accurate/lc/iOS 27.1.0`. Vision reads differently on the iPad and on
  a Mac, and from one OS to the next (PR #301), so the rows say which.
- **Deleting a PDF deletes its scan rows** in the same transaction as its marks and bookmarks (`deleteDocument`, `deleteOrphanedDocuments`,
  both sides).
- **Backups carry them** with the rest of `composition.db`; the search index is never in a backup and is made again from these rows.

## The guard: what a person's notes and Search never get on a guess

A line's `status` is one of `unchecked`, `held`, `checked`, `corrected`. When a line is stored it is **`held`** if its confidence is under
**0.5** or it holds a word from a short list a program never writes on a guess; otherwise **`unchecked`**. **Confidence is not the safety**:
Vision read a cursive signature as a swear word at confidence 1.00 (Gate C item 263), because language correction snapped the marks to a
common word. The same rule guards a drawing's `alt` (`InkTranscript` now calls `ScanText`), so the two cannot drift apart.

| Status | Seen by a person | In Search | In the page's text |
|---|---|---|---|
| `unchecked` | no | yes (it passed the guard) | as read |
| `held` | no | **never** | **never** |
| `checked` | yes, and it is right | yes | as read |
| `corrected` | yes, with their words | yes | the person's words (nothing, if they cleared it) |

Searching unchecked lines is research decision 4, taken as the research's pick until the owner says otherwise. The other rules:

- **A line with no text is not kept**; text is made one line (runs of white space as one space); a box must be four finite numbers with an
  area; confidence is brought inside 0 to 1 and rounded to a thousandth, and the status comes from the rounded value.
- **Reading a page again never touches what a person has seen.** `storeRecognition` replaces a page's `unchecked` and `held` lines and keeps
  `checked` and `corrected` ones; a newly read line more than half under a kept line's box is left out. A new line's `line` is its place in
  what the engine gave.
- **Checking or correcting** (`checkScanLine`, `correctScanLine`): writing exactly what was read checks the line instead of correcting it.
  These are built and conformance-checked, and have no screen yet (slice 3).

## Reading the pages (iPad)

After a scan is made, `AppModel.readScans()` reads every page not read yet, oldest scan first, **one page at a time, in the background**:

1. The page is drawn grey on white, at most **3,300 pixels** on its long side (about 300 dpi for US Letter, 11 MB), with the transform that
   takes a pixel back to the page's PDF user space (`ScanPdf.pageImage`; checked on all nine page geometries of `pdf-geometry.pdf`).
2. Vision reads it: `VNRecognizeTextRequest`, the **accurate** path with **language correction** (the only path that reads handwriting at
   all). Every line's box comes back in the picture's normalized space and is taken back to PDF user space.
3. `storeRecognition` keeps the page's lines and marks the page read, in one transaction. A page is done once that commits, so **a quit
   loses at most the page being read**: the next launch picks up at the first page with no `recognized_at`.
4. The scan's text in Search is made again from its lines (`indexScanText`).

Nothing leaves the iPad: Vision runs on the device, so the privacy label stays **Data Not Collected**. A page that cannot be read (Vision
failed, or the file is gone) stops that scan until the app next opens; other scans go on.

## Search

A scan's text goes into **the same per-page index as a PDF's own text** ([search.md](search.md#the-text-of-a-pdf)): each page's lines that
Search may use, in reading order, one per line (`scanPageText`), then the PDF page-text rule (`pageSearchText`). So a hit says its page,
**In the scan, p. 3**, and opens the reader there. Like a PDF's text, scan text has **no typo tolerance** (the other half of decision 4,
left as PDFs have it).

The difference from a PDF's text: a PDF's text is read again from the file whenever it is needed; a scan's is **made from `scan_lines`**,
because it is slow to make, differs by device and carries a person's corrections. When the index is rebuilt (a restore, a new install), a
scan's pages are filled from its rows, not by reading the file again.

**In the reader**, PDFKit's find bar finds nothing on a picture, so a search hit on a scan marks the lines on that page whose text holds the
words (yellow frames for four seconds) instead of opening the find bar. A held line is never marked. The Contents tab says how far reading
has got ("Reading the handwriting: 2 of 3 pages read") and how many lines are kept out of Search.

## Getting the scans in (iPad)

**Import Scans** (the notes list's toolbar, beside Import PDF) opens a sheet:

- **Add from Files** takes several pictures at once and puts them in the order their names give, numbers compared as numbers (`scan_2`
  before `scan_10`); **Add from Photos** keeps the order they were chosen in; **Scan with the Camera** is the system's document camera
  (`VNDocumentCameraViewController`, on a device only).
- The pages are a list to drag into order, turn a quarter at a time and swipe away. The title is what the files' names share before their
  page numbers (`Physics 101 - 001.jpg` gives *Physics 101*), or *Scanned notes*.
- At most **1,000 pages** a scan (one per course or term; every PDF is also under the 1 GB import limit).
- The sheet keeps its own copies of the pictures in a temporary folder, removed when the scan is made or the sheet is cancelled.

For tests, `-importScan /path/folder` on the launch arguments makes a scan of every picture in that folder, in name order.

## How it is checked

- **Conformance** ([`fixtures/conformance/scan`](../../fixtures/conformance/README.md#scan)): `text.json` (written by hand: the guard on 25
  lines, 15 lines stored or refused, 6 pages' text, 7 cases of the covered rule), `schema.json` and `scripts.json` (5 scripts, 71 steps,
  written by `scanConformance.test.ts` from the TypeScript), replayed by `ScanConformanceTests` in Swift.
- **CompositionPDF** (`ScanPdfTests`): a JPEG embedded as it is, page sizes from density, page order, every EXIF orientation with every turn,
  boxes back to PDF user space on all nine geometries, and Vision reading a drawn page with its line landing where the words were drawn.
- **What is not conformed:** the engines' output, which differs by device and OS. How well Vision reads *your* handwriting is the spike
  in the research, still waiting for pages.
