# Conformance corpus

Files the TypeScript core and the Swift core (the iPad app) **both read**, so that the rules that exist twice cannot drift
apart without a test failing. This is the shared guard that [ipad-app-design.md](../../docs/ipad-app-design.md#keeping-two-implementations-honest)
describes. It starts with the PDF tables; the rest of the corpus that design proposes is not here yet.

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
