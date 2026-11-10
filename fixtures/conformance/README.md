# Conformance corpus

Files the TypeScript core (the desktop's data layer) and the native cores (the Swift core of the iPad app; any later one) **all
read**, so that the rules that exist more than once cannot drift apart without a test failing. This is the shared guard that
[ipad-app-design.md](../../docs/ipad-app-design.md#keeping-two-implementations-honest) describes. This folder is its one home: the
cases and scripts below, and the PDF tables in `pdf/` and the ink stroke format in `ink/`.

Two kinds of file meet in a run:

- **The corpus (committed, this folder).** Inputs that people wrote (`*-cases.json`, the two scripts, the queries, the notes) and
  answers that cannot be regenerated cheaply or that pin a rule by hand (`search-expected.json`, `document-names.json`, `pdf/`).
- **What the desktop makes from it (generated, never committed).** The generator, `apps/web/scripts/conformance-fixtures.test.ts`,
  runs the desktop's real code over the corpus and writes databases, real backups and the `*-expected.json` files into a folder
  you name, with a copy of most inputs beside them. A native core is then pointed at that one folder:

```bash
mkdir /tmp/conformance
(cd apps/web && COMPOSITION_FIXTURE_DIR=/tmp/conformance node node_modules/vitest/vitest.mjs run scripts/conformance-fixtures.test.ts -t "writes ")
(cd apps/ios/CompositionCore && COMPOSITION_CONFORMANCE_DIR=/tmp/conformance swift test)
```

`apps/ios/scripts/conformance.sh` does this, in both directions, and is what CI runs. Without `COMPOSITION_CONFORMANCE_DIR` the suites
that need generated files are reported as skipped, never as passed. `COMPOSITION_FIXTURE_LARGE_MB` sets the size of the large backup
(100 by default), `COMPOSITION_REGENERATE_SEARCH` and `COMPOSITION_UI_RUN_DIR` switch on the two cases that are not part of a plain run.

Until 2026-11-09 the corpus was `apps/ios/conformance/` and the generator `apps/web/scripts/ios-conformance-fixtures.test.ts`, with
`IOS_FIXTURE_DIR`, `IOS_FIXTURE_LARGE_MB`, `IOS_REGENERATE_SEARCH` and `IOS_UI_RUN_DIR` for what are now `COMPOSITION_FIXTURE_DIR`,
`COMPOSITION_FIXTURE_LARGE_MB`, `COMPOSITION_REGENERATE_SEARCH` and `COMPOSITION_UI_RUN_DIR`.

## The notes and their rules

The Swift suites are in `apps/ios/CompositionCore/Tests/CompositionCoreTests/`. Each file's own `comment` or `about` says what it holds.

| File | What it pins | Swift suite |
|---|---|---|
| `store-script.json` | Operations on notes, groups and notebooks, with what the desktop's real `service.ts` did at every step (every row afterwards). | `StoreConformanceTests` |
| `trash-script.json` | The Trash Can: trash, restore, purge, expiry, with what the real `trashRepo.ts` did at every step. | `TrashConformanceTests` |
| `search-queries.json`, `search-expected.json` | 274 queries in 18 groups, and what a real Meilisearch answered for each over the generated notes (committed; `apps/ios/scripts/regenerate-search-expected.sh` rewrites it, with a hash of the notes so it cannot go stale unnoticed). The desktop's `parseSearchQuery` is run over the queries too. | `SearchQueryConformanceTests`, `SearchConformanceTests` |
| `mdx-notes.json` | Notes for the Markdown and MDX layer: valid or not, the components with their props, the headings and the footnotes the desktop's preview pipeline makes of each. | `MdxConformanceTests`, `HighlightModelTests` |
| `component-cases.json` | Inputs for the helpers behind the components (chart CSV, repo and YouTube addresses, image width and path). | `MdxComponentTests` |
| `frontmatter-cases.json` | Frontmatter through the desktop's `frontmatter.ts`: parse, generate, header image, tag helpers. | `FrontmatterConformanceTests` |
| `settings-cases.json` | Favorites, themes and saved cities through `parseWebSettings`. | `SettingsConformanceTests` |
| `editing-cases.json` | The typing aids (completions, props, snippets, indentation, emphasis, note links) at every caret place. | `EditingConformanceTests` |
| `images-cases.json` | Sniffing, naming and storing images, alt text, Markdown and tags, the stored-image picker. | `ImagesConformanceTests` |
| `organization-cases.json` | The sidebar's pure rules: navigation history, where a drop lands, a group's listing. | `OrganizationConformanceTests` |
| `live-cases.json` | The Live view: texts with the caret and selections tried on each, and what the desktop's `liveDecorations` hid, showed, styled, drew and tinted. | `LiveConformanceTests` |
| `document-names.json` | PDF file names and their checks. Made by `apps/ios/scripts/document-names-oracle.mjs` from the desktop's `attachmentNames.ts` and `documentNames.ts`, and committed: `conformance.sh` checks the desktop still makes it. | `DocumentNamesConformanceTests` |
| `sun.json` | Follow the sun: how light it should be (`sunSchedule.ts`), the pairs (`sunPairs.ts`), the city lookup and the sun-time cache driven with canned Open-Meteo answers (`sunTimes.ts`), today's times in a city's zone, the stand-in times in fourteen zones, and every pair's palette and surface blend read from `globals.css`. Made by `apps/web/src/lib/composition/sunConformance.test.ts` and committed: `conformance.sh` checks the desktop still makes it (`UPDATE_FIXTURES=1 pnpm exec vitest run src/lib/composition/sunConformance.test.ts` rewrites it). | `SunConformanceTests` |
| `reflow.json` | Reflow and the ruler's settings: `reflowAtCaret` over 605 lines, `changedSpan`, the live editor's filter (`liveReflow`, through the real CodeMirror state) over single changes with each kind of event, and `parseWritingSettings` / `validateWritingSettings`. Made by `apps/web/src/components/notes/reflowConformance.test.ts` and committed in the same way. | `ReflowConformanceTests` |
| `logic-subset.json` | Not a case file: the judgement of how much of `apps/web/src/lib/composition` the Swift core has to carry, read by `apps/ios/scripts/measure-logic-subset.mjs`. | |
| `preview-showcase/` | One note that uses every component the preview draws, with its two pictures. The Live cases use it, and `apps/ios/scripts/make-test-backup.sh` and `ui-test.sh` put it on the iPad. | |

## `pdf/`

The three tables of the PDF reader ([pdf-markup-plan.md](../../docs/pdf-markup-plan.md#the-data-model)): `documents`,
`pdf_annotations` and `pdf_bookmarks`.

| File | What it pins | How the Swift side uses it |
|---|---|---|
| `schema.json` | `columns`: each table's columns as `PRAGMA table_info` reports them. `objects`: the SQL of the tables, their indexes and their uuid triggers, spaces collapsed. | Create the schema, then compare the columns and the SQL of the indexes and triggers. A table's SQL ends `, uuid TEXT)` because the TypeScript adds that column with `ALTER TABLE ... ADD COLUMN`, as it does for every table that carries a uuid; do the same to get the same text, or compare columns only. |
| `validation.json` | What makes a mark, a bookmark label and a reading position valid, and what each is stored as. | Run every `input` through the matching function. `stored` is what must come out; `invalid: true` means it must be refused (the message is not compared). |
| `scripts.json` | Operation scripts over the repositories, each with what every step returned and what the three tables hold at the end. | Replay `steps` against a fresh database with the Swift repositories, and compare with `expect`. |

A change to the TypeScript behaviour fails its test until these are regenerated, and regenerating them is the prompt to change the
Swift side to match:

```bash
cd apps/web
UPDATE_FIXTURES=1 pnpm exec vitest run src/lib/composition/pdfConformance.test.ts   # rewrites schema.json and scripts.json
pnpm exec vitest run src/lib/composition/pdfMarkup.test.ts                            # reads validation.json (written by hand)
```

The Swift side is `PdfConformanceTests`, run by `swift test` in `apps/ios/CompositionCore` (these files are committed, so it needs
no generated folder) and by `apps/ios/scripts/conformance.sh`, which first checks that the TypeScript still writes them.

Reading the files:

- **`{"$repeat": ["a", 501]}`** stands for 501 letters `a`: JSON has no way to write a long string, and the 500-character
  and 200-character limits are tested at their edges. Expand it before using the value.
- **In `scripts.json`**, a step is `{"op": ..., ...arguments}`. The ops are `setNotes` (make exactly these note ids live and
  these in the Trash Can: the scripts need the ids, not the notes), then the repository functions by name:
  `addDocument`, `setPageCount`, `setViewState`, `deleteDocument`, `deleteOrphanedDocuments`, `addAnnotation`,
  `addAnnotationGroup`, `updateAnnotation`, `deleteAnnotation`, `addBookmark`, `renameBookmark`, `deleteBookmark`.
  A step's expected result is `{"ok": value}` or `{"error": true}`: a refused mark, an out-of-range page, a note that
  already has a PDF, a note that is gone. A refused step changes nothing, not even the next id.
- **Placeholders.** No two runs share a uuid or a time, so they are written `"<uuid>"` and `"<time>"` (the value must be a
  real uuid, 32 lowercase hex characters, or a real time, but is not compared). A group uuid is `"<group-1>"`, `"<group-2>"`
  and so on in order of first use, so that the rows of one selection can be seen to share one.
- **JSON columns are compared as values, not as text.** `rects`, `body` and `view_state` hold JSON; compare them parsed.
  Coordinates are stored rounded to a thousandth of a point (`pdfMarkup.ts`), which both sides must do before storing.
- **Ids** come from `AUTOINCREMENT` and are never reused, which the last script checks.

## `ink/`

The stroke format of a drawing ([architecture/ink.md](../../docs/architecture/ink.md); the iPad's design decision D9, proposed until Gate C). **This corpus was
written on the Swift side first**; the TypeScript reader (`apps/web/src/lib/composition/ink.ts` and `inkPng.ts`, run against these files by `ink.test.ts`, `inkPng.test.ts`, `inkSvg.test.ts` and `inkBackup.test.ts`) was built against it.

| File | What it pins | How a reader uses it |
|---|---|---|
| `validation.json` | What makes the stroke JSON readable, what a writer writes back after reading it, and what must be refused (41 cases: `null` is not absent, colour-name spelling, limits, structure). Written by hand. | Run every `input` through the reader. `stored` is what writing the drawing again must give (compared as a value, so member order does not matter); `invalid: true` means it must be refused (the message is not compared). |
| `drawing.json` | The stroke JSON of a small page (a pen wave, a marker in a `<Mark>` colour, a fixed-colour monoline, an accent dot) as the Swift code writes it. | Read it and draw it: the shapes are in `InkSamples.page()` in the Swift tests. |
| `sample.png` | The same page rendered by the Swift renderer in the default scheme's ink colour, with `drawing.json` byte for byte in its `inKJ` chunk and its density (2 pixels to a point) in `pHYs` (the container is described in the format page). | Find the `inKJ` chunk, check its CRC, unpack the zlib stream after the version byte and the four-byte length, and compare with `drawing.json`. |
| `containers.json` | What a reader must find in `sample.png`, `two-chunks.png` (two `inKJ` chunks: the last wins), `second-chunk-damaged.png` (the last has a wrong CRC: the first is used and the damage is reported) and `wide.png` (a drawing 5,000 points wide, stored at 1.64 pixels to a point): the drawing's width, the problems reported, the density. Written by hand. | Read each PNG; compare the three. |
| `renderer.json` | What the renderers must agree on: each ink's share of its colour and whether it is one width, the `<Mark>` hues, what a name nobody knows is, and how a fixed colour is shown on a dark scheme (PencilKit's dark style reverses the HSL lightness; the pairs were measured in the iPad Simulator). Written by hand. | Check the renderer's own tables and colour function against it. |
| `backup.tar.gz` | A real backup the Swift code made: one note, "Trip plan", with an `<Ink>` tag and the drawing's PNG in `app_data/`. | Restore it with the real restore code; the note has its tag, the PNG is among the images, its strokes are `drawing.json`'s. |

The Swift side is `InkConformanceTests` and `InkBackupTests` in `apps/ios/CompositionCore/Tests/CompositionInkTests/`, run by `swift test` there. `drawing.json`, the PNGs and `backup.tar.gz` are
rewritten by `UPDATE_FIXTURES=1 swift test --filter Ink`; `validation.json`, `containers.json` and `renderer.json` are only ever edited by hand. Rounding is half away from zero on the
scaled number (`Math.round` rounds negative halves the other way, so the cases avoid them).
