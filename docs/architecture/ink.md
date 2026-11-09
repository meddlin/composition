# Ink (drawings)

Source: the iPad app's [`CompositionInk`](../../apps/ios/CompositionCore/Sources/CompositionInk) package and the screens that use it
([`InkCanvas.swift`](../../apps/ios/Composition/InkCanvas.swift)); the shared corpus is
[`fixtures/conformance/ink`](../../fixtures/conformance/README.md#ink). The design is the iPad page's
[Ink and the Pencil](../ipad-app-design.md#ink-and-the-pencil) and decision D9.

A drawing is a PNG in `app_data/` that **carries its own strokes**, and `<Ink src="app_data/…" />` in a note shows it, the way `<Drawio>` does for a
diagram. **Status (2026-11-09): drawn on the iPad only, in the Simulator, and shown (view only) on the web, desktop and CLI; the format is still D9's proposal until Gate C**
(which needs the real iPad and Pencil: [What Gate C still needs](#what-gate-c-still-needs)). [Desktop and CLI](#desktop-and-cli) says what they do.

```mdx
<Ink src="app_data/trip-plan-drawing-3f9c2a71b0de.png" alt="Drawing" width="80%" />
```

## The drawing (the stroke JSON)

```json
{ "format": "composition-ink", "version": 1,
  "canvas": { "width": 834, "height": 1194 },
  "fields": ["x", "y", "t", "force", "altitude", "azimuth", "width", "height", "opacity"],
  "strokes": [ { "ink": "pen", "color": "ink", "points": [[10.5, 20, 0, 1, 1.571, 0, 3, 3, 1], …] }, … ] }
```

| Part | Meaning |
|---|---|
| `canvas` | The drawing's own coordinates, in points, y down. A new drawing is as big as the screen it was opened on. |
| `fields` | The columns of every point, **named once** instead of once per point (names would be most of a dense page's text). A reader maps columns by name, so another order, or a column left out (it takes its default), reads fine. `x` and `y` are required. |
| point | `x`, `y` in points; `t` in milliseconds since the stroke began; `force`; `altitude` and `azimuth` in radians (π/2 is the Pencil upright); `width` and `height`, the nib's size there (PencilKit's `size`); `opacity` 0 to 1. Defaults: `t` 0, `force` 1, `altitude` 1.571, `azimuth` 0, `width` and `height` 3, `opacity` 1. |
| `ink` | PencilKit's kind of ink, as text: `pen`, `pencil`, `marker`, `monoline`, `fountainPen`, `watercolor`, `crayon`. A name a reader does not know is **kept** and drawn like a pen. |
| `color` | A **name the scheme resolves** (`ink`, `accent`, or a `<Mark>` colour: `yellow`, `green`, `blue`, `pink`, `orange`) or a fixed `#rrggbb`. Black ink is `ink`, so it turns white on a dark scheme. |

**Numbers are rounded** to a hundredth (`x`, `y`, `width`, `height`, the canvas), a millisecond (`t`) or a thousandth (`force`, `altitude`, `azimuth`,
`opacity`), half away from zero, and written the way JavaScript writes them, so the same drawing is the same text on every platform. PencilKit itself keeps the
angles, the opacity and the nib size in less precision than that (measured: a size of 3 comes back as 2.99975).

**Unknown things are kept.** A member of the drawing or of a stroke, or a column named in `fields`, that a reader does not know goes back out when it writes,
so a later or another platform's additions survive an edit. A column a stroke lacks is written as `null`. **A change a reader would misdraw bumps `version`**;
a reader refuses a newer one (and shows the PNG's pixels). An addition it can skip does not.

**Limits** (a damaged or hostile file must not use all the memory): 100,000 strokes, 5,000,000 points, 100,000 points of canvas, points within 1,000,000 of
the origin, 256 MB of JSON text. What is refused, and what is written back, is pinned by
[`validation.json`](../../fixtures/conformance/ink/validation.json) (33 cases).

## The container (the PNG)

The pixels are the drawing, rendered on transparent in the colours of the scheme it was saved in, as any PNG: everything that shows an image (a backup's
viewer, the CLI, the desktop for now) sees them and ignores what follows. Two **private chunks** sit before `IEND`:

| Chunk | Holds | Read by |
|---|---|---|
| `inKJ` | The stroke JSON: a version byte (1), the length of the text in four bytes (big endian), then the text as a zlib stream | the Swift and web renderers, any platform |
| `inKP` | PencilKit's own blob (`PKDrawing.dataRepresentation()`): a version byte (1), then the bytes | the iPad only, for a lossless re-edit |

The chunk names follow the PNG rules for private chunks: ancillary (first letter lower case), private (second lower case), the reserved bit upper case, and
**unsafe to copy** (last letter upper case): an editor that changes the pixels drops them instead of carrying strokes that no longer match what is drawn.
(`iTXt`, which a draw.io-style file would use, is *safe* to copy and would go stale.) Each chunk has its CRC; a bad CRC, a chunk of a newer version, or a stream
that does not unpack is reported and the PNG is shown as a picture with no editing. A writer replaces both chunks and leaves every other chunk where it was.

**A stale PencilKit blob.** Another program may change the strokes and keep the blob. So the stroke JSON has a member `"pencilKit": {"strokes": <SHA-256 of
the strokes as written>}`, which a reader that does not know it keeps. The iPad edits from the blob only while that digest still matches the strokes; once it does
not, it edits from the strokes. (This is why an edit elsewhere never silently loses the iPad's re-edit: it costs the blob, not the drawing.)

**Where it is read in the app:** [`InkPNG`](../../apps/ios/CompositionCore/Sources/CompositionInk/InkPNG.swift) writes and reads the chunks, and
[`InkTag.contents(ofFileAt:)`](../../apps/ios/CompositionCore/Sources/CompositionInk/InkTag.swift) asks a stored file whether it carries ink, from its chunk headers
and with the pixels memory-mapped. `images.ts` sniffs bytes, so a PNG with extra chunks needs no allowlist change on the desktop.

## Colours and schemes

The semantic names are what make a drawing readable on every scheme: the renderer maps `ink` to the scheme's text colour and `accent` to its brand colour
([`InkPalette`](../../apps/ios/CompositionCore/Sources/CompositionInk/InkRenderer.swift)), and a `<Mark>` colour to its hue. The preview draws a stored drawing **from its
strokes in the scheme in force**, so a drawing made on a light scheme is white-on-dark on a dark one; the baked pixels are the fallback for everything else.

PencilKit has no names. Going in, **black and near black** (every channel 26 of 255 or under) is `ink`; every other colour is stored as chosen. The canvas takes the
scheme's style (`overrideUserInterfaceStyle`) and PencilKit flips black ink to white itself in a dark style. **Not known yet** (needs the iPad: R12): how PencilKit
shows the *other* colours in a dark style, and so whether a colour chosen in a dark style should be stored as drawn or converted
(`PKInkingTool.convertColor`). Going out, the iPad rebuilds PencilKit's drawing from the strokes with `ink` as black.

## What PencilKit gives and what it hides

Only the control points cross. A `PKDrawing` is a list of strokes, each an ink and a path of control points; the format keeps exactly those. What PencilKit keeps beyond
that is baked in on the way out:

- **A stroke's transform** moves its points, and scales the nib sizes by the square root of the determinant.
- **The pixel eraser** leaves a stroke with a *mask* (the part that still shows). `PKStroke.maskedPathRanges` is **the ranges of the path that show, not the ones that
  are erased**, which its name does not say (probed on macOS 27: an unmasked stroke of eleven points reports `0...10`; a mask over the middle reports
  `3...6.001`; a mask over the two ends reports `0...3` and `6.001...10`). Each range becomes a stroke of its own, with the cut point interpolated. A stroke
  erased entirely disappears.

## The renderer

[`InkRenderer`](../../apps/ios/CompositionCore/Sources/CompositionInk/InkRenderer.swift) draws the strokes with CoreGraphics, with no PencilKit, so it serves the PNG's pixels, the preview and anything
that needs a picture. It is **simplified**: each stroke is the outline swept by its nib (a Catmull-Rom curve through the control points, a sample about every half nib
width, the convex hull of two neighbouring ellipses) filled once at one opacity, so overlapping parts do not darken. The textured inks are approximated by opacity
alone (marker 0.45, pencil 0.8, watercolour 0.4, crayon 0.9 of the colour) and **their grain and bleed are not reproduced**; a monoline is one width, the mean of its points'. How
close this is to PencilKit's own rendering has not been compared yet (needs the iPad and a side-by-side).

## How big a drawing is

Measured in a Release build on a Mac with synthetic pages (arcs with a Pencil's variation in force, tilt and time at 240 samples a second; real handwriting is less regular
and compresses less, so **these numbers are a floor**). `INK_DENSITY=1 swift test -c release -Xswiftc -enable-testing --filter InkDensity` repeats them.

| Page | Strokes · points | JSON | zlib (the chunk) | PNG file | write | read | render + PNG |
|---|---|---|---|---|---|---|---|
| a page of handwriting | 500 · 20,000 | 0.97 MB | 0.17 MB | 0.80 MB | 169 ms | 20 ms | 329 ms |
| dense | 3,000 · 180,000 | 8.75 MB | 1.47 MB | 3.96 MB | 1,360 ms | 133 ms | 2,873 ms |
| extreme | 10,000 · 800,000 | 38.95 MB | 6.48 MB | 9.50 MB | 6,103 ms | 568 ms | 11,012 ms |

The zlib stream is 17 % of the text at every size. **A chunk of a few megabytes is acceptable** (the dense page is 4 MB in all, 1.5 MB of it strokes), so the strokes ride in the
PNG and no sidecar file is needed. *Write* is the slow side, mostly building and printing the numbers; the app does it off the main thread, and it can be made faster if a real page
is as dense as these. In a debug build the same measures are about five times slower.

## In the iPad app

- **Image menu → Drawing…** opens PencilKit's canvas full screen, with its tool picker, on a blank page; Done stores the PNG under the note's title and a hash of its bytes
  (like any stored image) and writes the `<Ink>` tag at the caret as a paragraph of its own. A blank page is a cancel.
- **Tap a drawing in the preview** opens the canvas on its strokes (PencilKit's blob when it is current, else rebuilt from the strokes). Done stores the new PNG under its new
  name and names it in the note in place of the old; the old file is left for the orphan sweep, as for any image the note no longer names.
- `NoteScanner.components` has `Ink`, so a note with an `<Ink>` shows it on the iPad, and, now that the web side knows the tag ([Desktop and CLI](#desktop-and-cli)), shows no "Unknown
  component" notice on the desktop. The iPad has no completions or snippets for `<Ink` yet.

## Desktop and CLI

**Status (2026-11-09): built, view only; checked in the browser pane on the web build in every colour scheme, and in the CLI's own preview. The desktop runs the same renderer code as the
web build (its renderer is the web app's static export) and has not been run by hand.** A note's `<Ink>` shows its drawing, and the "Unknown component <Ink>" notice is gone.

| Where | What it does |
|---|---|
| Reader: [`ink.ts`](../../apps/web/src/lib/composition/ink.ts) | The stroke JSON, read and written back exactly as [`validation.json`](../../fixtures/conformance/ink/validation.json) says (all 33 cases, and writing it again changes nothing), and `drawing.json` written back to the same text byte for byte. Unknown members and point columns are kept. |
| Container: [`inkPng.ts`](../../apps/web/src/lib/composition/inkPng.ts) | Finds `inKJ`, checks its CRC and version byte, unpacks the zlib stream (the platform's `DecompressionStream`, stopping at the length the chunk says) and requires it to be that long. A damaged chunk, a newer one, a stream that does not unpack, or JSON of a newer drawing is reported, and the PNG shows as the ordinary picture it is. `sample.png`'s chunk is `drawing.json` byte for byte. |
| Renderer: [`inkSvg.ts`](../../apps/web/src/lib/composition/inkSvg.ts) | The strokes as SVG shapes made at render time (never a stored file: `images.ts` refuses SVG on purpose). One filled outline per stroke, swept by its nib as `InkRenderer` does it, at one opacity (marker 0.45, pencil 0.8, watercolour 0.4, crayon 0.9 of the colour and of the points' own opacity; a monoline one width). `ink` is `var(--foreground)` and `accent` is `var(--brand)`, so a scheme restyles a drawing already on screen; a `<Mark>` colour name is its hue; `#rrggbb` is fixed; a name it does not know is ink. |
| Preview: [`mdx/Ink.tsx`](../../apps/web/src/components/notes/mdx/Ink.tsx), loaded by [`inkDrawings.ts`](../../apps/web/src/lib/composition/inkDrawings.ts) | Fetches the stored PNG from where the build serves images, reads the strokes, draws the SVG as big as its canvas (or at `width`, as `<Image>`). Without strokes it is the PNG, drawn at half its pixels. A drawing from a web address is just the picture. |
| Live tab: [`liveInk.ts`](../../apps/web/src/components/notes/liveInk.ts) | The same drawing in place of the tag, and beside it while the caret is in the tag, as for `<Image>`. |
| Editor | `<Ink>` is in the allowlist and offered after a `<`, with `src`, `alt`, `title` and `width` as for `<Image>`. |
| Desktop's protocol | `app://composition/app_data/…` answers a fetch from the dev server's origin too (the page is another origin under `next dev`). |
| CLI: `mdx.ts` | `<Ink>` is the same block as `<Image>` and `<Drawio>`: the PNG, decoded by the existing image path (the private chunks are skipped), shown in the colours of the scheme it was saved in. |

The renderer **thins the control points** (it drops one closer than a quarter of its nib to the last kept) and keeps a drawing to 60,000 samples, so a dense page's path is some hundreds of
kilobytes of SVG, not tens of megabytes; the Swift renderer draws a sample for about every half nib width and has no such cap. The pictures differ from the iPad's by that, and by the
antialiasing; neither is compared with PencilKit's own render (that is Gate C's).

**Found ambiguous or unpinned while reading it** (the Swift reader is what these follow; nothing here changed the Swift side, and the format is D9's proposal until Gate C):

- **`null` is not absent.** A stroke's `ink` or `color` set to `null`, or `fields: null`, is refused, since only a missing member takes the default. A `null` in a *known* point column takes the default; in an extra column it is kept. No case in `validation.json` pins either; adding one would stop the platforms drifting.
- **A colour name's spelling** (lower case letters, digits and dashes, up to 32 characters) is in `InkColor.init` and shown by the corpus (`Red` is refused), but not in this page's colour table.
- **Two `inKJ` chunks:** the last one that reads wins, as in `InkPNG.contents`; the page does not say.
- **A drawing too wide for 8,192 pixels** is stored at less than 2 pixels to a point (`InkRenderer.image`), so the picture a reader without strokes shows is drawn at the wrong size for it (the web assumes 2x). The format does not record the scale.
- **A colour chosen on a dark scheme** is a fixed colour on every scheme (the open R12 above): the web draws it as stored, so it looks the same on a light page.
- **The 256 MB limit** is on the text's bytes in Swift; JavaScript has the text's length in UTF-16 units, which is never more than that, so it is a little looser for non-ASCII text. A real drawing is ASCII.

## What is not built

- **Editing off Apple.** The web, desktop and CLI show a drawing and do not change one (decision D11): no canvas, no re-save, no `pencilKit` digest written.
- **The iPad's Live tab** draws other tags as text; a drawing there waits for the Live work to land (the desktop's Live tab draws `<Ink>`: [Desktop and CLI](#desktop-and-cli)).
- **Handwritten pages and ink on PDFs.** A handwritten page is a note whose body is one tall `<Ink>`; ink on a PDF uses this stroke format, one record per page
  ([pdf-markup-plan.md](../pdf-markup-plan.md)). Neither is built, and PDF ink waits for the PDFKit reader.
- **Search.** The text Vision recognises goes into `alt` on save (C11): not built, and its accuracy on real handwriting is not known.
- **The inline canvas** (a drawing edited in the text) and the **crop policy**: a new drawing is as big as the screen it was opened on, and is not cropped to what was drawn.

## What Gate C still needs

All of it needs the iPad and the Pencil, and the format stays *proposed* until it is done:

1. **Real handwriting:** draw a dense page by hand, and see that the stroke JSON, the PNG and a re-edit from the blob and from the strokes give the same drawing.
2. **Latency** next to Apple's Notes on the same iPad (N7), and the feel of the tool picker with a stage-sized canvas.
3. **Dark schemes:** how PencilKit shows non-black colours in a dark style (above), and a drawing made on a light scheme opened on a dark one.
4. **Every ink**, through the canvas, then the renderer's version beside PencilKit's own render of the same strokes.
5. **The pixel eraser** on a long stroke (the mask rule above is probed on macOS, not on the iPad).
6. **Vision on real handwriting** for the `alt` transcript (C11).
7. A **backup restored on the desktop** shows the PNG; with the web side built, the strokes in every colour scheme.
