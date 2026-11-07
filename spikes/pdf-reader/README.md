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
