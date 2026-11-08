# PDF reader spikes

Throwaway prototypes that answer questions in [docs/pdf-markup-plan.md](../../docs/pdf-markup-plan.md). Not part of any app;
nothing here is imported by the apps and it is not in a workspace.

## Spike A: pdf.js in the desktop app's real scheme and CSP

Question: does pdf.js work under `app://composition`, the CSP in
[`protocol.ts`](../../apps/desktop/src/main/protocol.ts), and a handler that serves a 300 MB PDF with `Range`? The findings
are in the plan's [Spike A findings](../../docs/pdf-markup-plan.md#spike-a-findings-2026-11-07).

`main.js` is a minimal Electron main process with the same scheme privileges and the same CSP string (plus
`CSP_WASM=1` to add `'wasm-unsafe-eval'`), and a streaming handler that serves `/documents/textbook.pdf` with `Range`.
`web/spike.js` runs the phases (open, first page, outline and page labels, jumps, 100 sequential pages, text of every
page, WebAssembly, a JPEG 2000 page) and reports time, bytes requested and CSP violations. `trace.mjs` is the same
question without Electron: which byte ranges does pdf.js read to open a file, for a given `rangeChunkSize`.

```bash
npm ci
python3 -m venv .venv && .venv/bin/pip install reportlab pillow numpy
.venv/bin/python gen/gen.py /tmp/textbook.pdf 600 1 96     # pages, a figure every N pages, JPEG quality: about 405 MB
.venv/bin/python gen/jpx.py /tmp/jpx.pdf                   # one JPEG 2000 page

# the app's CSP, pdf.js handed a Range transport (what the plan proposes)
env -u ELECTRON_RUN_AS_NODE SPIKE_PDF=/tmp/textbook.pdf SPIKE_JPX=/tmp/jpx.pdf \
  SPIKE_QUERY='?range=1&chunk=16384' npx electron .

# the same, with WebAssembly allowed
env -u ELECTRON_RUN_AS_NODE CSP_WASM=1 SPIKE_PDF=/tmp/textbook.pdf SPIKE_JPX=/tmp/jpx.pdf \
  SPIKE_QUERY='?range=1&chunk=16384' npx electron .

# no Electron: bytes read to open, per chunk size
node trace.mjs /tmp/textbook.pdf 16384
```

Leave `SPIKE_QUERY` out to let pdf.js open the URL itself, which is the case that does **not** use `Range` on `app://`.
Pinned: Electron 45.2.1 (the desktop app's locked version) and `pdfjs-dist` 6.5.438. `unset ELECTRON_RUN_AS_NODE` matters
if your shell sets it.

## Spike C: do pdf.js and PDFKit agree on where a mark goes

Question: if a highlight is stored as a rectangle, does it land on the same spot in both viewers, including on pages that are
rotated, cropped or have a media box that does not start at 0,0? The findings are in the plan's
[Spike C findings](../../docs/pdf-markup-plan.md#spike-c-findings-2026-11-07).

`gen/geometry.py` writes a nine-page PDF with the same two landmarks in raw user space on every page (a red square and the text
ANCHOR TEXT) and only the page geometry changed. `coords/pdfjs.mjs` (Node, no Electron) and `coords/pdfkit.swift` (macOS, a
command-line program on the same PDFKit the iPad uses) each report where they draw the landmarks and what a raw-space
rectangle covers; `coords/compare.mjs` checks that they agree and exits 1 if not. It needs macOS with Xcode for the Swift half.

```bash
.venv/bin/python gen/geometry.py /tmp/geometry.pdf
node coords/pdfjs.mjs /tmp/geometry.pdf > /tmp/pdfjs.json
swiftc -O coords/pdfkit.swift -o /tmp/pdfkit-check && /tmp/pdfkit-check /tmp/geometry.pdf > /tmp/pdfkit.json
node coords/compare.mjs /tmp/pdfjs.json /tmp/pdfkit.json        # all checks pass

# a control that should fail on the pages whose boxes do not start at 0,0: the rectangle relative to the crop box, used as raw
SPIKE_NEGATIVE=1 node coords/pdfjs.mjs /tmp/geometry.pdf > /tmp/pdfjs-negative.json
node coords/compare.mjs /tmp/pdfjs-negative.json /tmp/pdfkit.json
```

## Spike D: which library writes the marks into a PDF

Question: which library can write highlights, underlines, strikeouts, text notes and ink into a PDF as native annotations, or
burn them in (Flatten), with a licence we can ship, and does the result look right in both viewers and on a big file? The
findings are in the plan's [Spike D findings](../../docs/pdf-markup-plan.md#spike-d-findings-2026-11-07).

`export/marks.mjs` holds the marks (raw user space, one colour per kind). `export/adapters/pdflib.mjs` writes them with any of
the three pdf-lib variants (`pdf-lib`, `@cantoo/pdf-lib`, `@pdfme/pdf-lib`), native with hand-written appearance streams or
flattened; `adapters/pdfjs.mjs` tries pdf.js's own `saveDocument()`. `export/write.mjs` runs one adapter and prints time and
peak memory. `export/pdfkit-render.swift` renders the result with PDFKit and lists the annotations PDFKit reads, and
`export/check.mjs` looks for each mark inside its own rectangle in a pdf.js render and a PDFKit render (exit 1 on a failure).
`export/run.sh` does all three. `export/encrypted.mjs` and `export/unicode.mjs` are the encryption and text-in-other-scripts
checks, and `export/verify-big.mjs` checks that a big file's pages, outline, labels and annotations survive.

```bash
swiftc -O export/pdfkit-render.swift -o /tmp/pdfkit-render
export PDFKIT_RENDER=/tmp/pdfkit-render

# the nine geometries of spike C (see above for geometry.pdf), native and flattened, for each variant
export/run.sh @cantoo/pdf-lib /tmp/geometry.pdf /tmp/export native
export/run.sh @cantoo/pdf-lib /tmp/geometry.pdf /tmp/export flatten
export/run.sh pdfjs /tmp/geometry.pdf /tmp/export native          # fails: pdf.js cannot write underline or strikeout

# a real PDF: mark only some pages, and compare with the unmarked file instead of looking for colours
MARK_PAGES=10,20 DIFF=1 export/run.sh @cantoo/pdf-lib /path/to/real.pdf /tmp/export native

# time and memory on the 405 MB textbook of spike A
MARK_PAGES=0,99,299,599 /usr/bin/time -l node export/write.mjs @cantoo/pdf-lib /tmp/textbook.pdf /tmp/marked.pdf native

node export/encrypted.mjs encrypted.pdf ""                        # what each variant does with a password-protected file
node export/unicode.mjs /path/to/a-font-with-coverage.ttf /tmp/unicode.pdf
```

`noap` as a fifth argument to `run.sh` leaves the appearance streams out.
