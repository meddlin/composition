# Ink (drawings)

Source: the iPad app's [`CompositionInk`](../../apps/ios/CompositionCore/Sources/CompositionInk) package and the screens that use it
([`InkCanvas.swift`](../../apps/ios/Composition/InkCanvas.swift)); the shared corpus is
[`fixtures/conformance/ink`](../../fixtures/conformance/README.md#ink). The design is the iPad page's
[Ink and the Pencil](../ipad-app-design.md#ink-and-the-pencil) and decision D9.

A drawing is a PNG in `app_data/` that **carries its own strokes**, and `<Ink src="app_data/…" />` in a note shows it, the way `<Drawio>` does for a
diagram. **Status (2026-11-09): drawn on the iPad only, in the Simulator with a finger (the Pencil has never touched it), and shown (view only) on the web, desktop and CLI. The format is
still D9's proposal: Gate C is NOT passed.** Everything that does not need the iPad and the Pencil is built and checked (the six format questions the desktop's reader raised
are decided, a new page is cut to what was drawn, the words in a drawing go into `alt`, and a backup the iPad made restores and draws on the desktop in every scheme);
what is left is the Pencil's own part: [What Gate C still needs](#what-gate-c-still-needs). [Desktop and CLI](#desktop-and-cli) says what they do.

```mdx
<Ink src="app_data/trip-plan-drawing-3f9c2a71b0de.png" alt="Drawing" />
```

A new drawing's tag has no `width`, so the drawing is shown at the size of its page (never wider than the column), which is its ink and a margin ([How big a page is](#how-big-a-page-is)).
`width="50%"` or `width="300"` narrows it, as for `<Image>`.

## The drawing (the stroke JSON)

```json
{ "format": "composition-ink", "version": 1,
  "canvas": { "width": 834, "height": 1194 },
  "fields": ["x", "y", "t", "force", "altitude", "azimuth", "width", "height", "opacity"],
  "strokes": [ { "ink": "pen", "color": "ink", "points": [[10.5, 20, 0, 1, 1.571, 0, 3, 3, 1], …] }, … ] }
```

| Part | Meaning |
|---|---|
| `canvas` | The drawing's own coordinates, in points, y down. A new drawing's page is **cut to its ink** with a margin ([How big a page is](#how-big-a-page-is)). |
| `fields` | The columns of every point, **named once** instead of once per point (names would be most of a dense page's text). A reader maps columns by name, so another order, or a column left out (it takes its default), reads fine. `x` and `y` are required. |
| point | `x`, `y` in points; `t` in milliseconds since the stroke began; `force`; `altitude` and `azimuth` in radians (π/2 is the Pencil upright); `width` and `height`, the nib's size there (PencilKit's `size`); `opacity` 0 to 1. Defaults: `t` 0, `force` 1, `altitude` 1.571, `azimuth` 0, `width` and `height` 3, `opacity` 1. |
| `ink` | PencilKit's kind of ink, as text: `pen`, `pencil`, `marker`, `monoline`, `fountainPen`, `watercolor`, `crayon`. A name a reader does not know is **kept** and drawn like a pen. |
| `color` | A **name the scheme resolves** (`ink`, `accent`, or a `<Mark>` colour: `yellow`, `green`, `blue`, `pink`, `orange`) or a fixed `#rrggbb`. Black ink is `ink`, so it turns white on a dark scheme. |

**`transcript`** (a member of the drawing, optional, text): the words Vision read from the strokes when the iPad last saved the drawing (C11, [Search](#search)). The note's `alt` starts
as these words. A reader that does not know the member keeps it, like any other.

**Numbers are rounded** to a hundredth (`x`, `y`, `width`, `height`, the canvas), a millisecond (`t`) or a thousandth (`force`, `altitude`, `azimuth`,
`opacity`), half away from zero, and written the way JavaScript writes them, so the same drawing is the same text on every platform. PencilKit itself keeps the
angles, the opacity and the nib size in less precision than that (measured: a size of 3 comes back as 2.99975).

**Unknown things are kept.** A member of the drawing or of a stroke, or a column named in `fields`, that a reader does not know goes back out when it writes,
so a later or another platform's additions survive an edit. A column a stroke lacks is written as `null`. **A change a reader would misdraw bumps `version`**;
a reader refuses a newer one (and shows the PNG's pixels). An addition it can skip does not.

**Limits** (a damaged or hostile file must not use all the memory): 100,000 strokes, 5,000,000 points, 100,000 points of canvas, points within 1,000,000 of
the origin, 256 MB of JSON text. What is refused, and what is written back, is pinned by
[`validation.json`](../../fixtures/conformance/ink/validation.json) (41 cases).

### Rules both readers share (decided 2026-11-09)

The TypeScript reader, written against the Swift one, found six places where the page said nothing. Each is decided here, in both readers and in the corpus, so the two cannot drift:

1. **`null` is not absent.** A stroke's `ink` or `color`, or the drawing's `fields`, set to `null` is **refused**: only a member that is missing takes its default. In a point,
   a `null` in a *known* column is that column's default, and a `null` in a column the reader does not know is kept as `null`. (`validation.json`: three refusals and one case.)
2. **A colour name is spelled** with lower case letters, digits and dashes, 1 to 32 characters (`ink`, `accent`, `yellow`, `dark-blue-2`). `Red`, `dark_blue`, an empty name and a name of
   33 characters are refused; a `#rrggbb` is read in either case and written in lower case. (`validation.json`: five refusals and one case.)
3. **Two `inKJ` chunks:** the last one that reads wins, and one that does not read (a bad CRC, a newer version, a stream that does not unpack) is reported and passed over, so
   a good earlier one is still used. The writer here never writes two (it replaces both), so this only decides what a program that appended its own chunk gets.
   (`containers.json`: `two-chunks.png`, `second-chunk-damaged.png`.)
4. **A drawing too wide for 8,192 pixels** (over 4,096 points a side) is stored at less than 2 pixels to a point, and the PNG says so in the standard `pHYs` chunk (pixels to a
   metre; 72 dots to an inch is a pixel to a point), so a reader that cannot use the strokes, and any image viewer, draws the picture at the size of its canvas.
   A reader takes the density as `pHYs × 0.0254 ÷ 72`, to a hundredth, and **2 when there is none** (as every drawing was before the chunk was written), or one not in metres or not square.
   (`containers.json`: `wide.png` is 1.64.)
5. **Colours chosen on a dark canvas** are stored as PencilKit holds them and drawn as PencilKit shows them: see [Colours and schemes](#colours-and-schemes).
6. **No renderer is normative.** The data is the strokes. The CoreGraphics and SVG renderers differ in antialiasing and in how many samples they take along a stroke (the web one thins
   the control points and stops at 60,000), and neither is PencilKit's own picture. What they must agree on is a table: how much of its colour each ink shows, which inks are one width,
   the five `<Mark>` hues, and that a name nobody knows is ink. [`renderer.json`](../../fixtures/conformance/ink/renderer.json) pins it and both test suites read it.

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
that does not unpack is reported and the PNG is shown as a picture with no editing. A writer replaces both chunks and leaves every other chunk where it was. The PNG's `pHYs` chunk (a safe-to-copy one: it describes the pixels, and stays right) states how many pixels a point has; see the rules above.

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

PencilKit has no names. Going in, **black and near black** (every channel 26 of 255 or under) is `ink`; every other colour is stored as chosen, which is the colour in
`PKInk.color` (the *light-style* colour: see below). The canvas takes the scheme's style (`overrideUserInterfaceStyle`) and PencilKit flips black ink to white itself in a dark style.
Going out, the iPad rebuilds PencilKit's drawing from the strokes with `ink` as black.

**How PencilKit shows a colour in a dark style (R12): measured 2026-11-09.** The Simulator (iPadOS 26.4) draws a stroke under a dark trait collection and the pixels say: PencilKit
**reverses the lightness of the colour in HSL** (`L' = 1 − L`) and keeps hue and saturation. Black is white and white is black; a red, a blue or a yellow of middling lightness stays
as it is; a navy `#0d2680`-ish turns a light blue. The formula is within 0 of every channel for 40 random colours and for all seven inks (the textured ones change only their opacity),
and `PKInkingTool.convertColor` gives the same numbers. The strokes keep the colour PencilKit holds (the light style's), so **a dark scheme draws a fixed colour as PencilKit would**
(the iPad's `InkPalette.darkStyle`, the web's `light-dark(stored, shown)` which each scheme's `color-scheme` decides), and a light scheme draws it as stored. The pairs are
in [`renderer.json`](../../fixtures/conformance/ink/renderer.json) and both sides test them. Names are not changed by this: `ink` and `accent` are the scheme's, a `<Mark>` hue is its hue.
**Still the iPad's to answer:** what the *tool picker* shows and hands in while the canvas is in a dark style (the Simulator's picker was not driven), and so whether a colour a person
picks there is what they meant: manual item 164.

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
close this is to PencilKit's own rendering has not been compared yet (needs the iPad and a side-by-side). The renderers' shared tables are in
[`renderer.json`](../../fixtures/conformance/ink/renderer.json), and a stroke's fixed colour on a dark scheme is [PencilKit's own](#colours-and-schemes).

## How big a page is

A new drawing is drawn on a canvas as big as the screen, and **stored cut to what was drawn** (decided 2026-11-09; before, the whole screen was stored, which made a tall blank picture for a
small sketch). [`InkCrop`](../../apps/ios/CompositionCore/Sources/CompositionInk/InkCrop.swift): the ink's bounds are every point grown by half its nib; the page is those with **16 points**
round them and at least 48 points a side (a lone dot is still something to tap); the strokes are moved so the page starts at 0, 0. PencilKit's own drawing is moved by the same amount
(`PKDrawing.transformed`), so the blob in the PNG and the strokes stay the same drawing. A drawing with no ink keeps its page.

- The tag has **no `width`**, so a small sketch is shown at its own size and a wide one is brought down to the column: 1 point of the drawing is 1 point of the note. (With the old
  `width="80%"` a small sketch would have been blown up to four fifths of the column.)
- **Opened again to be edited,** the canvas gives the drawing 48 points of room on every side and is never smaller than the screen, so there is room to add to it on every side; **Done cuts it
  to the ink again**, and the page comes back as it was if nothing was added (checked: cutting a cut drawing changes nothing).
- This is the policy for an inline sketch. A **handwritten page** (a note that is one tall `<Ink>`, not built) will want a page of fixed size, and will keep it instead of cutting.

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

- **Image menu → Drawing…** opens PencilKit's canvas full screen, with its tool picker, on a blank page; Done cuts the page to the ink ([How big a page is](#how-big-a-page-is)), stores the PNG under the
  note's title and a hash of its bytes (like any stored image) and writes the `<Ink>` tag at the caret as a paragraph of its own, with the words Vision read from the drawing as its `alt`
  (or "Drawing" when it read none). A blank page is a cancel.
- **Tap a drawing in the preview** opens the canvas on its strokes (PencilKit's blob when it is current, else rebuilt from the strokes), with room round it. Done stores the new PNG under its new
  name and names it in the note in place of the old; the old file is left for the orphan sweep, as for any image the note no longer names. The `alt` is refreshed to the new words **only while it is
  still the words read last time, empty, or "Drawing"**: words a person wrote or changed are theirs.
- `NoteScanner.components` has `Ink`, so a note with an `<Ink>` shows it on the iPad, and, now that the web side knows the tag ([Desktop and CLI](#desktop-and-cli)), shows no "Unknown
  component" notice on the desktop. Neither the iPad nor the desktop offers completions, props or a snippet for `<Ink` yet (a drawing is made with the canvas, not typed): the conformance suite compares the two catalogues (`MdxCompletions.swift`, `MdxProps.swift` against `completions.ts`, `props.ts`), so `Ink` goes into both together or into neither, and it is in neither.

## Search

Handwriting is opaque to search, so [`InkTranscript`](../../apps/ios/CompositionCore/Sources/CompositionInk/InkTranscript.swift) reads the words out of a drawing when it is saved (compromise C11, risk R11).
It draws the writing in black on white at 2 pixels to a point (a long page is brought to 4,096 pixels; the marker and the watercolour are left out, since a highlighter over writing only makes
it harder to read), hands the picture to something that reads text, and turns the lines it gets back into one line (white space collapsed, quotes and angle brackets dropped, at most 300
characters, cut at a word). The reader is behind a seam, `InkTextRecognizing`; `VisionTextRecognizer` is the real one (`VNRecognizeTextRequest`, accurate level, language correction on), and
the words also go into the drawing's `transcript` so that an edit knows whether `alt` is still those words.

**Checked:** the picture a recognizer is given (colours, the marker left out, the size), what is done with the lines, the tag's `alt` refresh, and that Vision reads a picture of typed
words (the test draws "Meeting notes" with Core Text; the first Vision run on a Mac takes about 30 seconds, the rest well under a second). **Not known: how well Vision reads real
handwriting.** That is manual item 263, and it is the only answer that matters for C11.

## Desktop and CLI

**Status (2026-11-09): built, view only; checked in the browser pane on the web build in every colour scheme, and in the CLI's own preview. The desktop runs the same renderer code as the
web build (its renderer is the web app's static export) and has not been run by hand. A backup the iPad's Swift code wrote, with a drawing in it, was restored by the desktop's own `stageBackup`
and shown in the browser pane in all five schemes (2026-11-09).** A note's `<Ink>` shows its drawing, and the "Unknown component <Ink>" notice is gone.

| Where | What it does |
|---|---|
| Reader: [`ink.ts`](../../apps/web/src/lib/composition/ink.ts) | The stroke JSON, read and written back exactly as [`validation.json`](../../fixtures/conformance/ink/validation.json) says (all 41 cases, and writing it again changes nothing), and `drawing.json` written back to the same text byte for byte. Unknown members and point columns are kept. |
| Container: [`inkPng.ts`](../../apps/web/src/lib/composition/inkPng.ts) | Finds `inKJ`, checks its CRC and version byte, unpacks the zlib stream (the platform's `DecompressionStream`, stopping at the length the chunk says) and requires it to be that long. A damaged chunk, a newer one, a stream that does not unpack, or JSON of a newer drawing is reported, and the PNG shows as the ordinary picture it is, at the density its `pHYs` chunk states. `sample.png`'s chunk is `drawing.json` byte for byte; `containers.json` is run too (two chunks, a damaged second, a wide drawing). |
| Renderer: [`inkSvg.ts`](../../apps/web/src/lib/composition/inkSvg.ts) | The strokes as SVG shapes made at render time (never a stored file: `images.ts` refuses SVG on purpose). One filled outline per stroke, swept by its nib as `InkRenderer` does it, at one opacity (marker 0.45, pencil 0.8, watercolour 0.4, crayon 0.9 of the colour and of the points' own opacity; a monoline one width). `ink` is `var(--foreground)` and `accent` is `var(--brand)`, so a scheme restyles a drawing already on screen; a `<Mark>` colour name is its hue; `#rrggbb` is as stored on a light scheme and as PencilKit shows it on a dark one (`light-dark(stored, shown)`, which each scheme's `color-scheme` chooses; [Colours and schemes](#colours-and-schemes)); a name it does not know is ink. |
| Preview: [`mdx/Ink.tsx`](../../apps/web/src/components/notes/mdx/Ink.tsx), loaded by [`inkDrawings.ts`](../../apps/web/src/lib/composition/inkDrawings.ts) | Fetches the stored PNG from where the build serves images, reads the strokes, draws the SVG as big as its canvas (or at `width`, as `<Image>`). Without strokes it is the PNG, drawn at the density its `pHYs` chunk states (2 pixels to a point when it states none). A drawing from a web address is just the picture, at 2. |
| Live tab: [`liveInk.ts`](../../apps/web/src/components/notes/liveInk.ts) | The same drawing in place of the tag, and beside it while the caret is in the tag, as for `<Image>`. |
| Editor | `<Ink>` is in the allowlist and offered after a `<`, with `src`, `alt`, `title` and `width` as for `<Image>`. |
| Desktop's protocol | `app://composition/app_data/…` answers a fetch from the dev server's origin too (the page is another origin under `next dev`). |
| CLI: `mdx.ts` | `<Ink>` is the same block as `<Image>` and `<Drawio>`: the PNG, decoded by the existing image path (the private chunks are skipped), shown in the colours of the scheme it was saved in. |

The renderer **thins the control points** (it drops one closer than a quarter of its nib to the last kept) and keeps a drawing to 60,000 samples, so a dense page's path is some hundreds of
kilobytes of SVG, not tens of megabytes; the Swift renderer draws a sample for about every half nib width and has no such cap. The pictures differ from the iPad's by that, and by the
antialiasing; neither is compared with PencilKit's own render (that is Gate C's).

**What the reader found ambiguous** (`null`, colour names, two chunks, a wide drawing, dark colours, the renderers' differences) is decided in [Rules both readers share](#rules-both-readers-share-decided-2026-11-09)
and pinned by the corpus. One difference is left, on purpose: the 256 MB limit is on the text's *bytes* in Swift and on its length in UTF-16 units in JavaScript, which is never more, so JavaScript is a
little looser for non-ASCII text. A real drawing is ASCII.

## What is not built

- **Editing off Apple.** The web, desktop and CLI show a drawing and do not change one (decision D11): no canvas, no re-save, no `pencilKit` digest written.
- **The iPad's Live tab** draws `<Ink … />` as the text it is; the Preview shows the drawing. **Looked at 2026-11-09 and left, because it is not a small step:** (1) the Live model
  (`LiveScan`/`LiveModel`) reads `<Image … />` only, and the web's reads `<Ink>` separately, so the iPad's would grow a parallel list and the Live corpus (which the desktop's code generates)
  would need `<Ink>` cases; (2) the picture is drawn by a TextKit layout fragment from a file's thumbnail, so a drawing needs its own cache that reads the strokes in the background and draws
  them in the scheme in force; (3) **a tap on the drawing has to open the canvas**, but in the Live tab a tap puts the caret in the hidden tag, which is how it is shown as text, and
  intercepting that without breaking typing and selection in the editor (the part Gate L passed) needs its own design and a try on the iPad. The desktop's Live tab does draw it.
- **Handwritten pages and ink on PDFs.** A handwritten page is a note whose body is one tall `<Ink>`; ink on a PDF uses this stroke format, one record per page
  ([pdf-markup-plan.md](../pdf-markup-plan.md)). Neither is built, and PDF ink waits for the PDFKit reader.
- **The inline canvas** (a drawing edited in the text).
- **The accuracy of the transcript** ([Search](#search)): built, not known.

## What Gate C still needs

**Gate C is not passed, and the format stays *proposed* until it is.** Seven things were on its list; this is where each stands (2026-11-09), and the Pencil's part of each is in
[the manual test page](../manual-tests/ipad.md#drawings-m2-s5-the-stroke-format-and-the-canvas) (items 160 to 171 and 263 to 267, with a checklist of what to bring).

| # | Gate C item | Done without the iPad | Only the iPad and the Pencil can say |
|---|---|---|---|
| 1 | Real handwriting: a dense page by hand, strokes, PNG and re-edit agree | The writer, reader, blob/strokes digest and the size measurements, on synthetic pages; the cut page and the room round it | A real page: that the three agree, how long Done takes, how big the file is (items 162, 167, 168) |
| 2 | Latency next to Notes (N7); the tool picker with a big canvas | Nothing: it is hardware | Items 160, 264 |
| 3 | Dark schemes | **How PencilKit shows a colour in a dark style: measured in the Simulator** (HSL lightness reversed), and both renderers follow it | What the tool picker shows and hands in in a dark style (item 164) |
| 4 | Every ink, then the renderer's picture beside PencilKit's | The renderers agree with each other (`renderer.json`) | The comparison with PencilKit's own render, including the grain (item 163) |
| 5 | The pixel eraser on a long stroke | The mask rule, probed on macOS | On the iPad (item 165) |
| 6 | Vision on real handwriting for `alt` | The recognizer, its picture, the `alt` it writes and refreshes, behind a seam; Vision reads typed words | **How well it reads yours** (item 263) |
| 7 | A backup restored on the desktop shows the strokes in every scheme | **Done with a backup the Swift code wrote**, restored by the desktop's real code and drawn in all five schemes (`inkBackup.test.ts`, the browser pane) | A backup of a drawing made with the Pencil (items 169, 266) |

Once the Pencil items are answered, the format is frozen: what changes after that bumps `version`.
