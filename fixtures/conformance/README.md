# Conformance corpus

Files the TypeScript core and the Swift core (the iPad app) **both read**, so that the rules that exist twice cannot drift
apart without a test failing. This is the shared guard that [ipad-app-design.md](../../docs/ipad-app-design.md#keeping-two-implementations-honest)
describes. It starts with the PDF tables and the ink stroke format; the rest of the corpus that design proposes is not here yet.

A change to the TypeScript behaviour fails its test until the fixtures are regenerated, and regenerating them is the
prompt to change the Swift side to match:

```bash
cd apps/web
UPDATE_FIXTURES=1 pnpm exec vitest run src/lib/composition/pdfConformance.test.ts   # rewrites schema.json and scripts.json
pnpm exec vitest run src/lib/composition/pdfMarkup.test.ts                            # reads validation.json (written by hand)
```

## `pdf/`

The three tables of the PDF reader ([pdf-markup-plan.md](../../docs/pdf-markup-plan.md#the-data-model)): `documents`,
`pdf_annotations` and `pdf_bookmarks`.

| File | What it pins | How the Swift side uses it |
|---|---|---|
| `schema.json` | `columns`: each table's columns as `PRAGMA table_info` reports them. `objects`: the SQL of the tables, their indexes and their uuid triggers, spaces collapsed. | Create the schema, then compare the columns and the SQL of the indexes and triggers. A table's SQL ends `, uuid TEXT)` because the TypeScript adds that column with `ALTER TABLE ... ADD COLUMN`, as it does for every table that carries a uuid; do the same to get the same text, or compare columns only. |
| `validation.json` | What makes a mark, a bookmark label and a reading position valid, and what each is stored as. | Run every `input` through the matching function. `stored` is what must come out; `invalid: true` means it must be refused (the message is not compared). |
| `scripts.json` | Operation scripts over the repositories, each with what every step returned and what the three tables hold at the end. | Replay `steps` against a fresh database with the Swift repositories, and compare with `expect`. |

The Swift side is `PdfConformanceTests` in `apps/ios/CompositionCore/Tests/CompositionCoreTests/`, run by `swift test` there (these
files are committed, so it needs no fixture folder) and by `apps/ios/scripts/conformance.sh`, which first checks that the TypeScript
still writes them.

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
written on the Swift side first**: the TypeScript reader that the desktop's and the CLI's renderers need does not exist yet, so these files are what it is built against.

| File | What it pins | How a reader uses it |
|---|---|---|
| `validation.json` | What makes the stroke JSON readable, what a writer writes back after reading it, and what must be refused. Written by hand. | Run every `input` through the reader. `stored` is what writing the drawing again must give (compared as a value, so member order does not matter); `invalid: true` means it must be refused (the message is not compared). |
| `drawing.json` | The stroke JSON of a small page (a pen wave, a marker in a `<Mark>` colour, a fixed-colour monoline, an accent dot) as the Swift code writes it. | Read it and draw it: the shapes are in `InkSamples.page()` in the Swift tests. |
| `sample.png` | The same page rendered by the Swift renderer in the default scheme's ink colour, with `drawing.json` byte for byte in its `inKJ` chunk (the container is described in the format page). | Find the `inKJ` chunk, check its CRC, unpack the zlib stream after the version byte and the four-byte length, and compare with `drawing.json`. |

The Swift side is `InkConformanceTests` in `apps/ios/CompositionCore/Tests/CompositionInkTests/`, run by `swift test` there. `drawing.json` and `sample.png` are
rewritten by `UPDATE_FIXTURES=1 swift test --filter InkConformance`; `validation.json` is only ever edited by hand. Rounding is half away from zero on the
scaled number (`Math.round` rounds negative halves the other way, so the cases avoid them).
