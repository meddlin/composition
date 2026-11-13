# Scanned handwritten notes and OCR: research

Can the owner's scanned, handwritten loose-leaf college notes be imported into Benchnote, read with notes written beside them, and
made searchable by OCR, on the iPad and on the desktop? How well would it work, and what would it cost to build? Researched
2026-11-12 against first-party documentation, papers and model cards, and this repo. **Nothing here is built, and the spike on the
owner's own pages has not been run** (it waits for pages: [The spike](#the-spike-on-your-own-pages)). The feature is planned for
**after M3**.

Facts carry a bracketed source number (see [Sources](#sources)); repo facts cite a file. **Measured** means run on this Mac (Apple M4
Pro, 24 GB, macOS 27.0.1, Swift 6.4.2) on 2026-11-12. **Inference** is my reasoning from those facts, not something a source states;
**unverified** means I could not confirm it; **my pick** is a judgment the owner has not made; **my estimate** is a size I have not
measured. Vendors' pages move fast (several below changed in 2026), so re-check anything before building on it.

## Short answers

**Can it be built?** Yes on both, and most of it is already built. A scanned page is a picture of a page, and the app already has a
note that owns pages with marks beside them: the PDF ([pdf-markup-plan.md](pdf-markup-plan.md)). Turning page images into an
image-only PDF at import gives the reader, Pencil ink on the pages, typed notes, bookmarks, `pdf:` citations, the Notes tab, export,
the Trash Can and backup with no new reader. What is new is the recognised text: where it is stored, how it reaches search, and how a
person checks and corrects it.

**How well would it work?** **Nobody can say for your handwriting without trying it, and the sources do not say either.** Apple's
Vision documentation makes **no handwriting claim at all** [1][2][3][5][6][7]; Apple's handwriting claims are for its own apps (Live
Text finds "the picture of a handwritten family recipe" [11]; Notes searches handwriting and scanned documents [12]). Microsoft says of
its own on-device OCR that "Handwritten text recognition accuracy varies significantly based on writing style" [32]. The best published
numbers (TrOCR, 2.89 % character error on the IAM handwriting set [22]) are for single, clean, cropped lines of modern English, which a
fast college page is not. What this repo knows: on the owner's iPad on 2026-11-12, Vision read print-like handwriting ("How does this
work?") well and read a cursive signature as a swear word **at confidence 1.00**, because language correction snapped the marks to a
common word (PR #301). Apple's own WWDC talk names that hazard: language correction "can also get in the way", turning a code like
C001 into "cool" [5]. **Inference:** expect print-like handwriting to be good enough to search, and fast cursive to be poor. One catch:
a PDF's page text, which is where a scan's text would naturally be searched, has **no typo tolerance** by design
([architecture/search.md](architecture/search.md#the-text-of-a-pdf)), so a word misread by one letter is not found there (a decision
below). The spike settles it on your pages.

**What would it cost?** My estimate, after M3: **iPad, about 5 to 7 weeks** for the whole feature, with a **first useful slice in 2 to
3 weeks** (scans in as a note you read and write beside, and the text Vision is sure of made searchable). **Desktop, about 2 to 3 weeks
if it reads the text the iPad made** (through backup now, sync later) and recognises nothing itself; **plus about a week** for its own
OCR on a Mac (Vision again); **plus 2 to 4 weeks and a second spike** for its own OCR on Windows and Linux, where nothing good for
handwriting is built in. [Effort](#effort-risk-and-sequencing) has the slices.

**Recommendation:** feasible; **iPad first**, on Apple's Vision; the desktop reads the iPad's text before it recognises anything of its
own. The biggest risk is accuracy on your handwriting, and the smallest thing that settles it is the [spike](#the-spike-on-your-own-pages):
3 to 5 of your pages through Vision and three other engines on this Mac, then Vision on the iPad, scored against your own
transcription. Full reasoning in [Recommendation](#recommendation).

## What makes this hard

- **Scans are offline handwriting.** A drawing made in the app has strokes: the pen's path, in order, with time and pressure
  ([architecture/ink.md](architecture/ink.md)). A scan has only pixels. Apple's new handwriting recogniser in PencilKit reads strokes
  only ([below](#apple-on-the-ipad-and-the-mac)) and cannot help with a scan.
- **College notes are hard input**: fast cursive, abbreviations and course jargon, equations and diagrams mixed with text, crossings-out,
  ruled lines and margin notes, faint pencil, and the two-ring holes and shadows of loose-leaf paper.
- **Recognised text is a guess, and a wrong guess can be confident.** The Gate C bug is the lesson (PR #301): a confidence of 1.00 was
  wrong, so confidence alone cannot decide what goes into a person's notes, search, or what VoiceOver says. PR #301 (open, tried on the
  iPad) guards a drawing's `alt` with a confidence floor of 0.5 and a short never-guessed list in `InkTranscript`; scans need the same
  guard **and** a way for a person to review the text, because a page has hundreds of words where a drawing has a few.
- **The engines differ by device.** PR #301 found that "the iPad's Vision reads differently from the Mac's", so a result on the Mac is
  not a result on the iPad, and the text cannot be a conformance fixture (below).

## The candidates

### Apple, on the iPad and the Mac

| API | Since | What it gives | Handwriting, per the source |
|---|---|---|---|
| **`VNRecognizeTextRequest`** (the API the iPad uses today, in `InkTranscript.swift`) | iOS 13, macOS 10.15 [1] | Lines of text, each with up to 10 candidates "sorted by decreasing confidence score" [9], a "normalized confidence score" [8], and `boundingBox(for:)` for any range of a line's characters [8]; a fast path and an accurate path; language correction; `customWords`; `minimumTextHeight` [1][3] | Not mentioned [1][3][4][5] |
| **`RecognizeTextRequest`** (the Swift-concurrency form of the same request) | iOS 18, macOS 15 [2] | The same options [2] | Not mentioned [2] |
| **`RecognizeDocumentsRequest`** | iOS 26, macOS 26 [6] | A document's structure: "words, lines, or paragraphs", "tables and lists" [6], machine-readable codes and data such as URLs; words are not given for Chinese, Japanese, Korean and Thai [7] | Not mentioned [6][7] |
| **VisionKit `ImageAnalyzer`** (Live Text) | iOS 16, macOS 13 [10] | The system's Live Text interface over an image (select, copy, look up) and a single `transcript` string, with **no per-line positions or confidence** documented [10] | Not mentioned in the API [10]; Apple's marketing says Spotlight finds "handwriting in photos" with it [11] |
| **`PKStrokeRecognizer`** (PencilKit) | iOS, iPadOS, macOS, visionOS 27 [13] | Text from a `PKDrawing`'s **strokes**: the "single most likely result", an indexable form with "all the candidates concatenated together", and search; no confidence scores are described; "runs entirely on device" [13] | It is a handwriting recogniser, but for strokes only: **not usable on scans** |
| **Foundation Models**, image input and `OCRTool` | iOS 27 [14] | The on-device language model takes an image in a prompt; `OCRTool` "allows the model to extract structured text from images" and is "backed by the Vision framework" [14][15] | Not mentioned [14][15] |
| **`VNDocumentCameraViewController`** (VisionKit) | iOS 13; **not on macOS** [16] | The system's document scanner: "page by page", results are "images, by page number", which an app can "export … to PDF" [16] | n/a (capture, not recognition) |

**Measured on this Mac** (macOS 27.0.1): `VNRecognizeTextRequest` is at revision 3; its accurate path supports **33 languages** (English,
the main Western and Northern European languages, Polish, Czech, Romanian, Turkish, Russian, Ukrainian, Arabic, Thai, Vietnamese,
Indonesian, Malay, Hindi, Marathi, Chinese, Cantonese, Japanese, Korean), its fast path **6** (English, French, Italian, German,
Spanish, Portuguese). `RecognizeDocumentsRequest` is at revision 1 and lists the same 33 (WWDC25 said 26 [7]; the list has grown since).
`PKStrokeRecognizer.supportedLanguages` has 33 entries here (WWDC26 said 29 "as of iOS 27" [13]).

What the sources say that matters here:

- **Use the accurate path.** The fast path recognises character by character and is "meant for real-time reading"; the accurate path
  "uses a state-of-the-art neural network" that reads whole lines, with "much broader support" for rotated, perspective-skewed and
  stylised text, and Apple recommends it for reading natural language [5]. It is the default [3].
- **Language correction helps and hurts.** It "helps minimize common recognition errors" [3] and "can also get in the way" [5]; it
  costs time and memory [5]. `customWords` steers it toward domain words ("medical or technical terms") and is ignored when correction
  is off [3]. **Inference:** for course notes, `customWords` built from the words in your own typed notes is a cheap way to bias
  correction toward your subjects; the spike tries it.
- **Everything runs on the device.** "All of Vision's processing happens on the user's device" [3]; "all vision APIs run entirely
  on-device" [7]. Vision adds **no network use**, so the iPad's privacy label stays Data Not Collected
  ([ipad-app-design.md](ipad-app-design.md#v1-scope-and-milestones)).
- **Line positions come free.** `boundingBox(for:)` gives a box for a line or any part of it [8], which is what showing a search hit on the
  page needs. `RecognizeDocumentsRequest` adds paragraphs and lists [6][7], which would help a page of bullet notes read in order;
  whether it reads handwriting as well as the plain request is **unverified** (the spike compares them).
- **`ImageAnalyzer` is not the engine.** It is good for a "select and copy text in this picture" gesture, and gives no positions or
  confidence to store [10].
- **`PKStrokeRecognizer` is a side finding for drawings, not for scans.** It reads a drawing's strokes, which is exactly what a drawing's
  `alt` wants and what `InkTranscript` does today by rendering the strokes to a picture for Vision. It needs iPadOS 27 and gives no
  confidence. A follow-up for the ink work ([Side finding](#side-finding-pencilkits-stroke-recogniser-for-drawings)).
- **The on-device language model is not an OCR engine to trust with your notes.** It is generative. **Inference:** a generative model
  can write fluent words that are not on the page, which is the Gate C failure at the scale of a page; its context is a few thousand
  tokens (a code comment in the session prints 8192 [14]). It might later help someone *ask questions of* checked text, which is a
  separate feature.

### The desktop

| Engine | Where | Handwriting, per the source | Size, speed, licence | Fit |
|---|---|---|---|---|
| **Apple Vision** through a small Swift helper | Mac only (macOS 10.15 and later [1]) | Not claimed (above) | Part of macOS; nothing to bundle | **Good on a Mac**: the same engine as the iPad, run like the PDF export worker (a separate process, `utilityProcess`, [architecture/pdf.md](architecture/pdf.md#export)) (**Inference**). The native Mac app (Swift) gets it from `CompositionCore` directly |
| **Windows.Media.Ocr** (`OcrEngine`) | Windows 10 and later [31] | Not mentioned; it returns lines and words, each word with "text, size, and position" [31] | Part of Windows; language packs on the device [31] | **Unverified** on handwriting; the spike cannot try it on a Mac |
| **Windows AI Text Recognition** (`TextRecognizer`, Windows App SDK) | Windows 11, **NPU of a Copilot+ PC only** ("❌ Not supported" on GPU and CPU) [33] | "recognizing both printed text and common forms of handwritten text", accuracy "varies significantly based on writing style" [32] | Part of Windows; on-device, "No network connection is required" [32] | Good where it runs; most Windows PCs cannot run it [33] |
| **Tesseract** | Any; installed here (5.5.2, **measured**) | "won't work very well, as Tesseract is designed for printed text" (its own FAQ) [19]; training on your own lines is possible but its layout analysis "is still unable to recognize and separate lines of handwriting" [20] | Apache-2.0 [21] | **No** for handwriting; useful only as the spike's baseline and for page orientation (its `osd` data is installed here, **measured**) |
| **TrOCR** (Microsoft) | Any, through PyTorch or an ONNX export (**unverified**) | Handwriting is its strong point: 4.22 / 3.42 / 2.89 % character error on IAM for small / base / large [22] | 62M / 334M / 558M parameters [22] (base is about 1.3 GB as 32-bit floats, **Inference**); MIT [23][24] | Reads **"single text-line images"** only [23]: something else must find the lines (Vision on a Mac; a detector elsewhere). Trained on IAM, modern English [23] |
| **PaddleOCR PP-OCRv5** | Any; ONNX export **unverified** | "upgraded recognition capabilities for … complex Chinese and English handwriting" [26]; English handwriting scores 0.5806 (server model) against 0.2661 for v4, on the project's own test set with a metric the page does not define [26]; "slightly inferior to multimodal solutions in handwritten English recognition" [25] | 0.07B parameters [25]; 4.34 s a page on a Xeon CPU for the server model [26]; Apache-2.0 [27] | The best open, small, line-finding-included candidate; its own numbers say English handwriting is about half right by its measure |
| **PaddleOCR-VL** | Any | No handwriting claim in the abstract [28] | 0.9B parameters, 109 languages [28] | A document-parsing model; unproven on handwriting |
| **A local vision-language model through Ollama** (for example `qwen3-vl`) | Any machine that runs Ollama | Qwen3-VL claims OCR in "32 languages" and robustness to "low light, blur, and tilt"; no handwriting claim [29] | 1.9 GB (2B) to 6.2 GB (8B) downloads [30]; Apache-2.0 [29]; Ollama MIT [24] | The AI helper research already chose Ollama as the local model runner ([ai-helper-research.md](ai-helper-research.md)). Generative, so the same caution as Foundation Models; heavy to bundle, so only as an opt-in for someone who runs Ollama |

**Linux has no system OCR** that I could find (**unverified**: absence is hard to cite); Tesseract is what Linux tools use, and it is
the wrong tool for handwriting [19].

**What this means for the native-per-platform plan.** **Inference:** OCR does not lock the stack if the recognised text is stored as
plain rows that name the engine that made them (below). The iPad and a native Mac app in Swift would share Vision through `CompositionCore`; the
Electron app on a Mac can call the same Vision; Windows and Linux (Electron now, C# and Rust later) read text made elsewhere until a
second spike picks an engine for them.

### Cloud services, only to say what they would cost

All three big services read handwriting: Google's `DOCUMENT_TEXT_DETECTION` ("One specific use … is to detect handwriting") [34];
Azure Document Intelligence's Read model marks each line handwritten or not, with a confidence per word [35]; AWS Textract labels each
word `HANDWRITING` or `PRINTED` with a confidence [36], at **$0.0015 a page for the first million pages, 1,000 pages a month free**
[37] (so 2,000 pages is about $3, or $1.50 after the free pages). Google's and Azure's prices did not render for me (**unverified**).

The money is small; what they would cost is the product's promises:

- **The iPad's privacy label.** Apple's "collect" means "transmitting data off the device in a way that allows you and/or your
  third-party partners to access it for a period longer than what is necessary to service the transmitted request in real time" [18].
  Whether a provider keeps the pages longer than the request is that provider's terms, which I did not read; **Inference:** assume the
  label changes from Data Not Collected unless a provider's terms are read and found to fit. It would also be the iPad app's first
  network use since Follow the sun dropped its lookup ([ipad-app-design.md](ipad-app-design.md#v1-scope-and-milestones)).
- **Local-first** is the product's first promise ([product-positioning.md](product-positioning.md)); class notes can hold other
  people's names and private thoughts.
- **What an opt-in would take** (my pick, if ever): off by default; the person's own key (no account of ours); the desktop only; chosen
  per import with a plain statement of where the pages go; the result stored and reviewed exactly like local OCR. **Not recommended for
  the first version**: the local engines may be good enough, and the spike says whether they are.

## How well it would work: what is known

| Evidence | What it says | What it does not say |
|---|---|---|
| TrOCR on IAM [22] | 2.89 to 4.22 % of characters wrong | Your hand; whole pages; equations; only clean single lines of modern English |
| PP-OCRv5 [25][26] | English handwriting about 0.58 by its own (undefined) measure; behind multimodal models | Cursive specifically |
| Microsoft's platform card [32] | Handwriting accuracy "varies significantly based on writing style, legibility, and language" | Any number |
| Apple [5][11][12] | The accurate path handles stylised and skewed text better; Live Text and Notes find handwriting | Any number, or a handwriting claim for the developer API |
| The owner's iPad, 2026-11-12 (PR #301) | Print-like handwriting read well; a cursive signature misread as an offensive word at confidence 1.00 | A page of notes |

**Inference:** search forgives more than reading does. A word is found if it is read right once on a page; and a note's own text is
searched with typo tolerance (one or two wrong letters per word: C1 and S2 in [ipad-app-design.md](ipad-app-design.md#search)), though
a PDF's page text is not ([architecture/search.md](architecture/search.md#the-text-of-a-pdf)). So text that is not good enough to quote
can still be good enough to find a page, more so if scan text is given typo tolerance. The spike measures both: how much is right (for
reading), and how many of the words you would search for are found (for search), with and without one wrong letter allowed.

## The spike on your own pages

**Not run: it needs 3 to 5 of your pages.** Pick them to cover the range:

1. your neatest, most print-like page;
2. your fastest cursive;
3. a page with equations or a diagram among the words;
4. a faint (pencil) or crowded page;
5. if you wrote in a second language, one page of it.

**Keeping the pages private.**

- You put them in a folder **outside the repo** (my pick: `~/ocr-spike/pages/`). The harness and its results live beside them, not in
  the repo, like the panel spike's throwaway project ([panel-system-research.md](panel-system-research.md#how-the-spike-was-run)).
- Nothing about the pages is committed: this doc gets numbers and, only if you approve each one, a few short misreadings.
- When it is done, the folder is deleted (I list what is in it and you confirm first).
- **The ground truth is the catch.** Scoring needs the right text for each page. Either **you type it** (all of each page, or ten lines
  of each), or **I read the pages and draft it** for you to correct, which is quicker for you but **sends the page images to Anthropic's
  API** as part of this conversation. Your choice; the default is that you type it and I never look at the pages.

**What runs, on this Mac.**

| Candidate | Settings | Needs |
|---|---|---|
| Vision `VNRecognizeTextRequest` | accurate; language correction on, off, and on with `customWords` from your typed notes | Nothing (built in) |
| Vision `RecognizeDocumentsRequest` | default | Nothing (built in) |
| Tesseract 5.5.2 | `eng`, the baseline | Nothing (installed) |
| A local vision model | `qwen3-vl:8b` through Ollama, prompted to transcribe exactly | **A 6.2 GB download** [30] (I ask first) |
| TrOCR base, handwritten (optional) | on the lines Vision found | **About 1.3 GB** of weights and a Python environment (I ask first) |

**What it reports**, per page and engine, as a table in this doc:

- **Character and word error** against your transcription (edit distance, after folding case and spacing), the usual measures.
- **Search words found:** of the words you would search for on that page (you name ten), how many each engine got right.
- **Confident wrong words** (the Gate C measure): words wrong while their line's confidence is at or above the 0.5 floor, and any line the
  never-guessed list would have held.
- **Invented words** (for the vision model): words in its output that are on no line of the page.
- **Speed and memory:** seconds per page cold and warm, and peak memory (`/usr/bin/time -l`).
- **Then Vision on the iPad**, because the iPad's Vision differs from the Mac's (PR #301): the same pages through the same request on the
  device, from a debug-only screen on a throwaway branch that reads a folder you pick in Files and shows the numbers, stores nothing,
  and is never merged. The Mac run picks the candidates; the iPad run is the result for the iPad.

**Cost:** about a day to write the harness, an hour to run, and your time to transcribe. **What it decides:** whether Vision alone is
good enough for the iPad (and so for the whole first version), whether `RecognizeDocumentsRequest` or `customWords` is worth it, and
whether the desktop needs an engine of its own soon.

## Product shape

### A note that owns scanned pages

| | **A. Images become an image-only PDF at import** (my pick) | **B. A new "page set" note type** |
|---|---|---|
| Reader, zoom, sidebar, bookmarks | The PDF reader, as built on both | New, on both |
| Pencil ink on a page, typed text notes | Built (iPad ink; desktop shows it) | New |
| `pdf:` citations, Quote, the Notes tab, Trash Can, export, backup | Built | New, or each extended |
| Highlight a line of handwriting | **New either way**: an image-only page has no PDF text, so pdf.js and PDFKit select nothing; highlight and Quote work from the recognised lines' boxes instead | New |
| Cost | A converter at import, and a flag that the PDF is a scan | A second reader on each platform |

**Making the PDF:** on the iPad, PDFKit makes a page from an image (`PDFPage(image:)`, iOS 11) [17]; the document camera's own output is
meant to be exported "to PDF" [16]. On the desktop, `@cantoo/pdf-lib` is already bundled for export
([architecture/pdf.md](architecture/pdf.md#export)) and can embed a JPEG page as it is (**Inference** from its API; not tried). Each page
keeps the scan's own size, so the marks' convention (raw PDF user space, [pdf-markup-plan.md](pdf-markup-plan.md#the-data-model)) holds
unchanged. **The file is still never written after import** (decision P3): recognised text is kept beside it, not baked in. A
`documents` row would say it is a scan (a column, my pick; the name is a build-time choice), so the reader knows to draw the recognised
lines and offer review.

**One thing to measure on the desktop:** its CSP blocks WebAssembly, so pdf.js decodes images with its JavaScript decoders, and the PDF
plan already noted "revisit when scans and OCR come" ([pdf-markup-plan.md](pdf-markup-plan.md#reading)). A 300-page scan is all images.

### Where the recognised text lives

A table beside the PDF's marks, one row per recognised line (a sketch; names are build-time choices):

```sql
CREATE TABLE scan_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    page INTEGER NOT NULL,          -- 0-based, as pdf_annotations
    line INTEGER NOT NULL,          -- reading order on the page
    rect TEXT NOT NULL,             -- JSON: the line's box in raw PDF user space, as marks are stored
    text TEXT NOT NULL,             -- what the engine read
    confidence REAL NOT NULL,       -- 0 to 1, as the engine gave it
    engine TEXT NOT NULL,           -- e.g. "apple-vision/text/3/accurate/lc", with the OS version
    status TEXT NOT NULL,           -- unchecked | held | checked | corrected
    corrected TEXT,                 -- the person's text, when status is corrected
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    uuid TEXT                       -- fill trigger and unique index, like every other table
);
```

- **Per line, not per page**, so that a hit can be shown as a box on the page, a person corrects one line without retyping a page,
  confidence is kept where the engine gives it, and two devices' corrections merge line by line.
- **The guard, shared with drawings.** A line is `held` when its confidence is under the floor or the never-guessed list matches
  (`InkTranscript`'s rule, PR #301). A held line is never searched, never spoken and never quoted until a person checks or corrects it.
  **Confidence alone is not the safety** (1.00 was wrong); review is.
- **Search.** Since PRs #302 and #303 (2026-11-12 and 13), a PDF's own text is searched **a page at a time** on both devices: a result
  says *In the PDF, p. 212* and opens the reader at that page with its find bar on the query's words, and a scan today is in the `noText`
  state, shown as *No searchable text (scanned)* ([architecture/search.md](architecture/search.md#the-text-of-a-pdf)). My pick: a scan's
  lines become its pages' text in that same per-page index, so a hit on a scan says its page like any PDF's: **checked and corrected
  lines always; unchecked lines above the floor only if you choose so** (an open decision, with whether scan text gets the typo
  tolerance a PDF's text does not have). **The difference from a PDF's text:** that text is read again from the file whenever it is
  needed and is kept only in the search index, never in the database or a backup; recognised text cannot be, because it is slow to
  make, differs by device and carries a person's corrections, so it lives in `scan_lines` and the index is built from it. Two reader
  changes follow: the find bar must look in `scan_lines` on a scan (pdf.js and PDFKit find nothing on an image page), and the search
  oracles (`pdf-text-search.json` already has a scan in it) gain scans with lines.
- **Re-running OCR never touches a checked or corrected line.** A newer engine replaces `unchecked` and `held` lines only.
- **Size:** **Inference:** a page of notes is a few hundred words, about 2 KB of text, so 5,000 pages is about 10 MB in the database and
  the index.

**The conformance corpus ("no port without an oracle").** The TypeScript side defines the table, the rules (a line's box, confidence in
0 to 1, the statuses and their moves), which lines go into search, and the guard, and writes fixtures under `fixtures/conformance/scan`
that the Swift core replays, as for the PDF tables ([architecture/pdf.md](architecture/pdf.md#how-it-is-checked)). So **even the
iPad-first plan starts with a small TypeScript step.** The guard exists in Swift only today, so it gains a TypeScript port and a shared
fixture of cases (the floor and the list). **What is not conformed:** the engines' output, which differs by device and OS; tests feed
both sides a recorded list of lines instead.

### Reviewing and correcting

My pick, for a person to trust what is in their notes:

- **A review view per page:** the scan with each line's box tinted by status (unsure, held, checked), and the lines as a list beside it.
  Tap a line to correct it; **Check page** marks every unchanged line on it as read and right; a filter shows only unsure and held
  lines across the whole document. Nothing is ever accepted for you.
- **VoiceOver** reads a page as "Scanned page 3 of 40, 24 lines, 20 checked" and reads checked text only; unchecked text is behind an
  explicit action that says it is unchecked. A held line is never read aloud (the Gate C lesson again).
- **Quote** from a line uses its checked or corrected text; quoting an unchecked line asks first.
- **Export** could add an invisible text layer of the checked lines, so other apps can search the copy (Azure offers the same kind of
  "searchable PDF" [35]); my pick is later.

### Backup, restore and sync

- **Backup and restore** need nothing new: the PDF is in `documents/` and the rows are in `composition.db`, which every backup already
  carries ([architecture/backup-restore.md](architecture/backup-restore.md)). Scans make backups large (below).
- **Sync** (designed, not built, [cross-device-sync-design.md](cross-device-sync-design.md)): the PDF is a blob on the attachments fast
  follow, as any PDF; the lines are small records with a `uuid`, like marks. **My pick: sync the text, do not re-run OCR on each
  device**, since the engines differ and a person's corrections must follow them. A line corrected on two devices is last-writer-wins, as
  a mark is. The search index is never synced: it is "Derived data; each device rebuilds its own", so each device indexes the synced
  lines itself.

## Getting the scans in

- **Bulk import in order.** Scanners name files in order (`scan_001.jpg` …). My pick: sort by name with numbers compared as numbers,
  show the pages in a strip to drag into order, rotate and delete, then make the PDF. JPEG, PNG, HEIC and TIFF in; a multi-page PDF from a
  scanner app is imported as a PDF and flagged as a scan if its pages have no text.
- **On the iPad:** the Files picker (several at once), Photos, and the document camera (`VNDocumentCameraViewController`, iOS 13, page by
  page [16]), which suits a few pages at a time; a stack of hundreds is better scanned elsewhere and imported. Whether the camera
  straightens pages is not on its documentation page [16] (**unverified** there, though its interface is Apple's Notes scanner).
- **Rotation and skew.** Vision's accurate path copes with rotated and skewed text [5], so recognition needs no straightening; the
  stored page should still be upright for reading. My pick: honour the image's EXIF orientation, offer rotate by 90°, and suggest a
  rotation where a sideways page reads better turned (Tesseract's orientation detection could do it on the desktop; **unverified** on
  handwriting). Deskewing a few degrees is a nicety, not needed for OCR.
- **Size.** **Inference:** a US Letter page at 300 dpi is 2,550 by 3,300 pixels; as JPEG, roughly 0.5 to 1.5 MB (not measured). 2,000
  pages would be 1 to 3 GB in `documents/` and in every backup (risk X6), a test of the iPad's large-archive backup (R10), and each PDF
  stays under the 1 GB import limit (P9) by being one per course or term. **How many pages do you have?**
- **Time.** Making the PDF is a copy. OCR is the slow part: a Vision run on a Mac took "about 30 seconds" the first time and "well under a
  second" after on a small picture ([architecture/ink.md](architecture/ink.md#search)); a full page is unmeasured (the spike measures
  it). It would run in the background, page by page, with progress, and pick up where it stopped after a quit (pages with no rows yet).

## Effort, risk and sequencing

### iPad (after M3)

| Slice | What | My estimate |
|---|---|---|
| 0 | The spike (Mac, then the iPad check) | 1 to 2 days, plus your transcription |
| 1 | **Scans in:** the TypeScript schema, rules and fixtures first; then import in order (Files, Photos, document camera), rotate, make the PDF, the owner note; read and write beside it with everything the PDF reader has | About 1 week |
| 2 | **Searchable:** OCR in the background, `scan_lines`, the shared guard, search text into FTS5, resume after a quit | 1 to 1.5 weeks |
| 3 | **Review and correct:** the review view, statuses, the unsure filter, VoiceOver | 1.5 to 2 weeks |
| 4 | **Use it:** the find bar over a scan's lines, highlight and Quote from a line, export with a text layer | 1 to 2 weeks |

**First useful slice: 1 and 2**, in 2 to 3 weeks: your pages are notes you can read and write beside, and the text Vision is sure of
finds them. Until slice 3, unsure and held lines are kept and not searched.

### Desktop

| Slice | What | My estimate |
|---|---|---|
| D1 | Read scans (they are PDFs), import images to a PDF, `scan_lines` and its search text (the TypeScript is the oracle, so much of this is slice 1 and 2's first step), **text that arrives from the iPad by backup** | 1 to 1.5 weeks |
| D2 | The review view on the desktop | 1 to 1.5 weeks |
| D3 | OCR of its own on a Mac: Vision in a signed helper run as a separate process | About 1 week, mostly release engineering (signing and notarising a second executable) |
| D4 | OCR of its own on Windows and Linux | 2 to 4 weeks and a second spike: no good built-in engine except on Copilot+ PCs [33] |

### Risks

| # | Risk | Mitigation |
|---|---|---|
| O1 | Vision reads your cursive too poorly to be useful | The spike first. If only print-like pages read well, the feature still gives scans as notes you read and write beside, with search on what reads |
| O2 | Confident wrong or offensive words reach notes, search or VoiceOver (Gate C) | The floor and never-guessed list, held lines kept out of everything, review, nothing auto-accepted |
| O3 | The iPad's and the Mac's Vision differ, and OS updates change results (PR #301; forum reports of a change in the accurate path in iOS 27 betas, **unverified**) | Record the engine and OS on each line; never re-run over checked lines; the spike's iPad step |
| O4 | A large library: backup size, the 1 GB file limit, the iPad's storage | One PDF per course or term; counts in the Backup card; test a multi-gigabyte backup (R10) |
| O5 | The desktop reader is slow on all-image PDFs (WebAssembly blocked) | Measure on a scan in slice D1; allowing `'wasm-unsafe-eval'` is the plan's own fallback |
| O6 | Selecting text on a scan needs new code in both readers | Lines' boxes drive highlight and Quote; budgeted in slice 4 |
| O7 | Desktop OCR on Windows and Linux has no good engine | Read the iPad's or Mac's text; a second spike when it matters |
| O8 | Two devices correct the same line | Last-writer-wins per line, as marks |

### Decisions to make first

1. **Pages for the spike, and who writes the ground truth** (you, or I draft from the images, which sends them to Anthropic's API).
2. **Shape:** an image-only PDF at import (my pick) or a new page-set note.
3. **Desktop OCR in the first version:** none, reading the iPad's text (my pick); the Mac only; or every platform.
4. **Unchecked text in search:** searchable above the floor, or only once checked; and whether scan text is searched with typo tolerance,
   unlike a PDF's text.
5. **Cloud OCR as an opt-in:** never, or later on the desktop with your own key.
6. **Scale and content:** roughly how many pages, which languages, and how much maths.

### Where it fits

After M3, on the iPad first, since the reader, the Pencil, Vision and the guard are all there. **Next to the native-per-platform plans:**
a native Mac app in Swift, when it comes, would inherit the iPad's OCR through `CompositionCore` (**Inference**); the Windows and Linux designs need
nothing for it until D4, because the text arrives as rows that name their engine. It is the PDF plan's "scanned PDFs and OCR … later,
not never" ([pdf-markup-plan.md](pdf-markup-plan.md#not-in-scope)).

## Recommendation

**Feasible, iPad first.** The iPad already has an on-device engine (Vision), an import-and-read path (the PDF reader), Pencil ink on
pages, and a guard for recognised text; nothing there touches the network. The desktop should first read and search the text the iPad
makes, and recognise nothing itself; a Mac can add Vision cheaply later, and Windows and Linux wait for a second spike.

**The biggest risk is accuracy on your handwriting, especially cursive, and no source can settle it.** The smallest thing that does is
the spike: 3 to 5 of your pages, kept outside the repo and deleted after, through Vision (three settings), its document request,
Tesseract and optionally a local vision model on this Mac, then Vision on the iPad, scored against your own transcription for
character and word error, search words found, confident wrong words and speed. If Vision reads your pages well enough to find them,
build slices 1 and 2; if it reads only your print-like pages, the same slices still give you scans as notes, and the decision is how
much to spend on review and on better engines.

## Side finding: PencilKit's stroke recogniser for drawings

`PKStrokeRecognizer` (iPadOS 27) reads handwriting from a drawing's **strokes**, on the device, in 29 languages (33 listed on this Mac)
[13], which is the right input for a drawing's `alt` and better suited than rendering the strokes to a picture for Vision, as
`InkTranscript` does. It gives a single best reading and an "indexable" form that concatenates every candidate (search only, never for
`alt` or VoiceOver), and **no confidence** [13], so PR #301's floor would need another rule. It needs iPadOS 27. A follow-up for the ink
work, not part of this feature.

## Sources

1. Apple, [`VNRecognizeTextRequest`](https://developer.apple.com/documentation/vision/vnrecognizetextrequest): overview, properties, revisions, availability (iOS 13, macOS 10.15).
2. Apple, [`RecognizeTextRequest`](https://developer.apple.com/documentation/vision/recognizetextrequest): the Swift form, iOS 18 and macOS 15.
3. Apple, [Recognizing text in images](https://developer.apple.com/documentation/vision/recognizing-text-in-images): the fast and accurate paths, on-device processing, language correction, `customWords`.
4. Apple, [`VNRequestTextRecognitionLevel`](https://developer.apple.com/documentation/vision/vnrequesttextrecognitionlevel).
5. Apple, WWDC19 session 234, [Text Recognition in Vision Framework](https://developer.apple.com/videos/play/wwdc2019/234/) (transcript): the two paths, language correction "can also get in the way" (C001 and "cool"), `customWords`, `minimumTextHeight`, memory.
6. Apple, [`RecognizeDocumentsRequest`](https://developer.apple.com/documentation/vision/recognizedocumentsrequest): iOS 26 and macOS 26; words, lines, paragraphs, tables and lists.
7. Apple, WWDC25 session 272, [Read documents using the Vision framework](https://developer.apple.com/videos/play/wwdc2025/272/) (transcript): 26 languages, no words for CJK and Thai, on-device.
8. Apple, [`VNRecognizedText`](https://developer.apple.com/documentation/vision/vnrecognizedtext): `string`, `confidence`, `boundingBox(for:)`.
9. Apple, [`VNRecognizedTextObservation.topCandidates(_:)`](https://developer.apple.com/documentation/vision/vnrecognizedtextobservation/topcandidates(_:)): at most 10, by decreasing confidence.
10. Apple, [`ImageAnalyzer`](https://developer.apple.com/documentation/visionkit/imageanalyzer) and [`ImageAnalysis`](https://developer.apple.com/documentation/visionkit/imageanalysis): Live Text, iOS 16 and macOS 13; `transcript`.
11. Apple Newsroom, [iOS 15 brings powerful new features…](https://www.apple.com/newsroom/2021/06/ios-15-brings-powerful-new-features-to-stay-connected-focus-explore-and-more/) (June 2021): Live Text, "handwriting in photos".
12. Apple Support, [Search through your notes on iPad](https://support.apple.com/guide/ipad/search-notes-ipad64863a98/ipados): handwritten text and text in scanned documents.
13. Apple, WWDC26 session 203, [Read between the strokes with PencilKit](https://developer.apple.com/videos/play/wwdc2026/203/) (transcript): `PKStrokeRecognizer`, 29 languages, on-device, strokes.
14. Apple, WWDC26 session 241, [What's new in the Foundation Models framework](https://developer.apple.com/videos/play/wwdc2026/241/) (transcript): image input, `OCRTool`.
15. Apple, WWDC26 session 237, [What's new in image understanding](https://developer.apple.com/videos/play/wwdc2026/237/): Vision tools for the model.
16. Apple, [`VNDocumentCameraViewController`](https://developer.apple.com/documentation/visionkit/vndocumentcameraviewcontroller): iOS 13, no macOS; pages as images; export to PDF.
17. Apple, [`PDFPage.init(image:)`](https://developer.apple.com/documentation/pdfkit/pdfpage/init(image:)): iOS 11.
18. Apple, [App privacy details on the App Store](https://developer.apple.com/app-store/app-privacy-details/): the meaning of "collect".
19. Tesseract, [FAQ](https://tesseract-ocr.github.io/tessdoc/FAQ.html): handwriting.
20. tesseract-ocr/tesstrain, [issue #276, Question on handwriting OCR](https://github.com/tesseract-ocr/tesstrain/issues/276): training on lines; layout cannot separate handwritten lines.
21. [tesseract-ocr/tesseract](https://github.com/tesseract-ocr/tesseract): Apache-2.0 (GitHub API, 2026-11-12).
22. Li et al., [TrOCR: Transformer-based Optical Character Recognition with Pre-trained Models](https://arxiv.org/abs/2109.10282) (arXiv:2109.10282 v5, 2022; tables read at [ar5iv](https://ar5iv.labs.arxiv.org/html/2109.10282)): IAM CER 4.22 / 3.42 / 2.89, 62M / 334M / 558M parameters.
23. Hugging Face, [microsoft/trocr-base-handwritten](https://huggingface.co/microsoft/trocr-base-handwritten): fine-tuned on IAM, "single text-line images", MIT, about 0.3B parameters.
24. [microsoft/unilm](https://github.com/microsoft/unilm) (MIT) and [ollama/ollama](https://github.com/ollama/ollama) (MIT): licences (GitHub API, 2026-11-12).
25. Cui et al., [PaddleOCR 3.0 Technical Report](https://arxiv.org/abs/2507.05595) (arXiv:2507.05595, July 2025): PP-OCRv5 handwriting, 0.07B parameters.
26. PaddleOCR, [Introduction to PP-OCRv5](http://www.paddleocr.ai/main/en/version3.x/algorithm/PP-OCRv5/PP-OCRv5.html): per-scenario scores, speeds on a V100 and a Xeon Gold 6271C.
27. [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR): Apache-2.0 (GitHub API, 2026-11-12).
28. [PaddleOCR-VL](https://arxiv.org/abs/2510.14528) (arXiv:2510.14528, October 2025): 0.9B, 109 languages.
29. Hugging Face, [Qwen/Qwen3-VL-8B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct): Apache-2.0, OCR in 32 languages.
30. Ollama, [qwen3-vl](https://ollama.com/library/qwen3-vl): tags and download sizes.
31. Microsoft, [`OcrEngine` class (Windows.Media.Ocr)](https://learn.microsoft.com/en-us/uwp/api/windows.media.ocr.ocrengine): Windows 10, lines and words with positions.
32. Microsoft, [Platform card: Text Recognition (OCR)](https://learn.microsoft.com/en-us/windows/ai/cards/text-recognition-ocr-platform-card) (updated 2026-07-15): handwriting, on-device, limitations.
33. Microsoft, [What are Windows AI APIs?](https://learn.microsoft.com/en-us/windows/ai/apis/) (updated 2026-11-12): Text Recognition on the NPU of Copilot+ PCs only.
34. Google Cloud, [Detect handwriting in images](https://docs.cloud.google.com/vision/docs/handwriting).
35. Microsoft, [Document Intelligence Read model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/read): handwritten style per line, confidence per word, searchable PDF.
36. AWS, [Textract: Lines and words of text](https://docs.aws.amazon.com/textract/latest/dg/how-it-works-lines-words.html): `HANDWRITING` and `PRINTED`.
37. AWS, [Textract pricing](https://aws.amazon.com/textract/pricing/): Detect Document Text, $0.0015 a page, 1,000 pages a month free.
