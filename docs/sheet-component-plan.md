# Spreadsheets in notes: design and plan

A note can hold data that is best read as a spreadsheet: a budget, a comparison, a range copied from an Excel
workbook. A Markdown table is not enough for it (no formulas, no sorting, awkward to edit, no way to bring a
range in from Excel). This page is the design for a **`<Sheet>` MDX component**: a grid you can edit, with
formulas, whose data stays in the note's text. Built so far: the read-only grid and the formula engine (Steps 1 and 2 of
the [build order](#build-order)); not yet: editing, Excel import and export. Dates are 2026-11-07 and 2026-11-08.

**In scope:** author a sheet in a note; bring a range in from an Excel workbook and refresh it later; formulas
(including `SUMIFS` and column-name references); export; the terminal app drawing it.
**Out of scope for v1:** a live link to a file, a native pivot component, cell formatting (colors, borders,
column widths), several sheets in one tag, the iPad drawing it. See [Non-goals](#non-goals-and-future-work).

## What is decided

Decided by the owner on 2026-11-07, in conversation:

| # | Decision | Who |
|---|---|---|
| S1 | **Formulas: yes.** | Owner |
| S2 | **A live link to an Excel file is deferred.** The first version is a snapshot you can refresh, not a link. | Owner |
| S3 | **Data usually comes from Excel files the owner keeps editing**, and a sheet can also start in the note. | Owner |
| S4 | **The workbooks are heavy:** `SUMIFS`, Excel tables and pivot tables. | Owner |
| S5 | **An import brings values by default**, with formulas kept only where they can be trusted ([the idea](#the-idea-values-first-formulas-where-they-can-be-trusted)). | Owner |
| S5a | **Excel compatibility is wanted, eventually:** import a sheet, edit its formulas, and have it still work in Excel. The wish is the owner's; the three levels and their timing ([below](#toward-excel-compatible-formulas)) are my picks. | Owner (the wish) |
| S7 | **Formulas live in a ` ```formulas ` block beside the CSV values**, and a formula we cannot calculate is carried, not thrown away ([S7](#decisions-to-make)). Revised after the Excel-compatibility question. | Owner |
| S8 | **Our own formula engine**, with no fallback library. It owns criteria matching, coercion, lookups, dates and errors ([S8](#decisions-to-make)). Revised at Gate A. | Owner |
| S11 | **Size limits:** warn when the note passes 100,000 characters, refuse an import over 5,000 rows, and always draw the grid with virtual scrolling ([S11](#decisions-to-make)). Revised at Gate A. | Owner |

Everything below is my reading of those. Anything marked **my pick** is a judgment, not something the
owner decided.

## Goal and rule

**A note stays Markdown text.** A sheet is not a file beside the note, it is text inside it. That keeps
search, backup, sync, end-to-end encryption, the terminal app and the iPad working with no new storage, and
it is why this is a component and not an attachment (see [Why not a file](#why-not-a-stored-xlsx)).

**The numbers on screen must agree with Excel's.** The worst failure of this feature is a number that is
quietly wrong, so every choice below prefers "show what Excel computed" over "recompute it ourselves".

## What the code does today

- [`<Chart>`](ui/mdx-components.md#chart) already keeps a table as a ` ```csv ` block inside its tag, read by
  [`parseCsv`](../apps/web/src/components/notes/mdx/chartData.ts), which the terminal app shares. Props are
  plain strings and nothing is evaluated (the desktop CSP has no `unsafe-eval`), and a fenced block is the one
  place a note can hold a table that Markdown will not rewrap. A sheet uses the same trick.
- [`<Drawio>`](architecture/diagrams.md) is the editing pattern: an **Edit** button on the preview, a dialog,
  and a save that rewrites the tag in the note as one undo step ([`drawioSrc.ts`](../apps/web/src/components/notes/mdx/drawioSrc.ts)
  finds the tag and leaves code blocks alone).
- `<Toc>` and `<Footnotes>` are note-wide components, so a component that reads other parts of the note
  (a later `<Chart from="…">`) has precedent.
- Notes are a `TEXT` column in SQLite; only pasted images and attachments are files
  ([data-model.md](architecture/data-model.md)). Adding a component is a short checklist
  ([mdx-components.md](ui/mdx-components.md#adding-a-component)).
- The iPad design draws the same ten components natively and ports shared rules with test vectors
  ([ipad-app-design.md](ipad-app-design.md)). A formula engine is a rule that must exist there too, eventually.

## What I checked

Facts, not assumptions (checked 2026-11-07; the package checks unpacked each tarball and grepped it, nothing
was run):

- **HyperFormula 3.5.0 is `GPL-3.0-only`** on npm, or a purchased proprietary license
  ([licensing](https://hyperformula.handsontable.com/docs/guide/licensing.html)). That does not fit a
  closed-source, one-time-purchase app (see [Risks](#risks), item 7). **Univer** keeps import and export
  in its Pro tier ([docs](https://docs.univer.ai/guides/sheets/pro-features/introduction)).
- **`chevrotain` 7.1.2 contains `eval(...)` and `new Function(...)`.** `fast-formula-parser` 1.0.19 (MIT, last
  published 2023-10) depends on `chevrotain ^7`, and HyperFormula on `^6.5`. The desktop CSP is
  `script-src 'self' 'unsafe-inline'`, so a parser built on them needs a run under the CSP before it is
  trusted (whether the normal parse path reaches those calls is untested). `chevrotain` 13.2.0 has none.
- **`@formulajs/formulajs` 4.6.1** (MIT, last published 2026-07, depends on `bessel` and `jstat`) is a
  function library, not a parser. Its only `eval` is in `bin/cli.js`. It is 2.3 MB unpacked but 143 KB
  minified (Gate A), and would be loaded on demand. **`xlsx-calc` 0.9.2** (MIT, no dependencies, last published 2024-08) has no `eval`, works
  on SheetJS cell objects and takes formulajs as its function library.
- **SheetJS Community Edition is Apache-2.0**, with official builds at [cdn.sheetjs.com](https://cdn.sheetjs.com).
  A cell carries its formula text (`f`) and its **cached value** (`v`); **it does not evaluate formulas** (a
  calculator is a Pro add-on, and the maintainers call an engine out of scope: [issue #3218](https://git.sheetjs.com/sheetjs/sheetjs/issues/3218)).
  **Pivot tables are not supported** in the Community Edition ([issue #894](https://git.sheetjs.com/sheetjs/sheetjs/issues/894),
  open): a pivot arrives as the plain cells it was drawn with.
- **Not verified:** SheetJS's bundle size and whether it runs under the desktop CSP; whether the Community
  Edition reads Excel table definitions (nothing found); whether a write keeps both `f` and `v`; formulajs's
  `SUMIFS` family against Excel's criteria rules; which npm source for SheetJS is current (the unscoped `xlsx`
  package or the CDN tarball); how big a sheet the preview and editors cope with. Step 0 settles each.

## The idea: values first, formulas where they can be trusted

The owner's workbooks are heavy, and Excel has already done the work: every formula cell in an `.xlsx` carries
the value Excel computed. Re-creating `SUMIFS` over structured table references, named ranges and pivots is
reinventing Excel. So:

- **A range imported from Excel arrives as its values.** What is on screen is what Excel showed. Pivot tables
  need nothing special: a pivot is its cells.
- **A sheet written in the note computes.** Type `=SUM(B2:B9)` and it works, with a defined set of functions.
- **A formula comes across from Excel if it stays inside the sheet.** If we support its functions and our
  engine reproduces Excel's cached value, we recalculate it from then on. If not, we **carry** it (S7): the text
  is kept, the value is Excel's, and the cell says so. Our number never replaces Excel's where they disagree.
  A formula that points outside the imported range becomes a value. The import summary lists them all ("14
  cells: 9 carried, 5 kept as values because they point outside the range"). Excel's own answers are a free
  test suite for the engine.

## How it behaves

The text in the note:

````mdx
<Sheet title="Q3 budget" source="budget.xlsx" sheet="Q3" range="A1:F40">

```csv
Region,Product,Units,Price,Revenue
West,Widget,120,9.5,1140
East,Widget,80,9.5,760
Total,,200,,1900
```

```formulas
E2 =C2*D2
E3 =C3*D3
C4 =SUM(C2:C3)
E4 =SUM(E2:E3)
```

</Sheet>
````

The first block holds what is shown. The second, optional, holds the formula of each cell that has one (S7).

- **Viewing.** The preview draws a grid: frozen header row, column letters and row numbers, numbers right-aligned,
  an error such as `#DIV/0!` in the cell it came from. Sorting and filtering change the view only, never the text.
  The terminal draws a text table and shares the parser and engine; it cannot edit.
- **Editing.** An **Edit sheet** button on the preview (like **Edit diagram**) opens a grid dialog: arrow, Tab and
  Enter move between cells, a formula is typed into the cell and shows its result when you leave it, rows and
  columns can be added and removed, and a range pasted from Excel fills cells. **Save sheet** rewrites the CSV block
  as one undo step. Nobody edits the block by hand, though they can.
- **Starting one.** From the `<` completion menu, from a shortcut, by promoting a Markdown table to a sheet (as
  Cmd+Shift+X promotes an image to `<Image>`), or by **pasting a range copied from Excel**, which is offered as
  a sheet and otherwise stays text, as today.
- **Importing.** **Import from Excel…** takes an `.xlsx`, asks which sheet and range, shows the size and the
  formula summary above, and inserts the tag with its provenance props. The file is chosen with a plain
  `<input type="file">`, which the shared notes UI already uses for the header image
  ([`HeaderImageDialog.tsx`](../apps/web/src/components/notes/HeaderImageDialog.tsx)), so the page gets the
  file's bytes and never a path.
- **Refreshing.** **Re-import** asks for the file again, reads the same sheet and range, and replaces the data.
  The tag keeps `imported="<hash>"`, a hash of what the last import wrote; if the grid no longer matches it, you are
  told you changed it and asked before it is overwritten. The live link, later, is this same idea without the
  file picker.
- **Exporting.** **Export…** writes `.xlsx` (formulas as formulas, with values) or CSV.

## Toward Excel-compatible formulas

Asked 2026-11-07: can you import a spreadsheet, edit its formulas, and still have it work in Excel? **Yes for the
grid you imported, in three levels. Not soon, for the rest of the workbook.** The rule underneath is that
**Excel is the spec**: formulas are written in Excel's own syntax, each function is added with fixtures taken from
Excel's cached values, and nothing is added that Excel lacks (S9's column-name references compile down to
ordinary ranges on export).

| Level | You can | What it takes | When |
|---|---|---|---|
| **1. Same dialect** | Type or edit a formula the way you would in Excel, **Export…** a new `.xlsx` of the sheet, and open it in Excel with the formulas calculating. | Translation on export. Functions newer than Excel 2007 are stored in the file with a `_xlfn.` prefix (`FILTER` and `SORT` with `_xlfn._xlws.`) and show `#NAME?` in Excel without it ([XlsxWriter's notes](https://xlsxwriter.readthedocs.io/working_with_formulas.html)); `[Revenue]` becomes a range like `$E$2:$E$40`; dates become serial numbers with a date format. Each formula is written with its value. | Step 5 |
| **2. Carry what we cannot calculate** | Import a workbook, change a formula our engine knows, export, and the formulas it does not know (`XLOOKUP`, before we support it) come out as they went in. | S7: a formula's text and Excel's value stored side by side, as in the `.xlsx` itself. Without that, a formula we cannot evaluate has to be thrown away on import. | Decide now (S7); built in Step 4 |
| **3. Back into the original workbook** | Write the edits into the file you imported from, with its other sheets, styles, pivot tables and charts intact. | Not a library call. SheetJS Community Edition drops styles on a read-then-write ([#3214](https://git.sheetjs.com/sheetjs/sheetjs/issues/3214), [#2952](https://git.sheetjs.com/sheetjs/sheetjs/issues/2952)); ExcelJS is reported to lose charts and to handle pivots only in part (secondhand, unverified). The dependable way is to patch only the changed cells inside the file's zip and copy every other part untouched. | After v1, with the live link |

**What cannot be made compatible, plainly:** a formula that reaches another sheet or workbook (a `<Sheet>` is one
grid, so it would be `#REF!` in the export), named ranges, dynamic-array functions (`FILTER`, `SORT`, `UNIQUE`,
`LET`), and pivots as pivots. A formula that stays inside the sheet is kept, calculated or carried; one that
leaves it becomes a value, and the import and export summaries say which cells and why.

**Why decide S7 now:** the engine can grow function by function, but the shape of what a note stores cannot
change cheaply once people have notes in it. A format that pairs a formula with its value can reach level 3; one
that stores `=` text alone cannot carry anything it cannot calculate.

Untested: whether SheetJS Community Edition writes a date number format. Step 0 checks.

## Decisions to make

Recommendations are mine. S5, S7, S8 and S11 are decided (owner, 2026-11-07); the rest I will proceed on unless you object.

| # | Decision | Recommendation | Why / what it costs |
|---|---|---|---|
| S5 | **What an import brings by default:** values, or formulas. | **Decided (owner, 2026-11-07): values, with formulas kept only where they can be trusted;** S7 says what "kept" means. | A number that disagrees with Excel is worse than a number that cannot be edited. The cost: an imported sheet is less "live" than Excel until the engine covers more. |
| S6 | **One format.** A sheet is a `<Sheet>` tag holding a ` ```csv ` block of values, as `<Chart>` does, and optionally a ` ```formulas ` block (S7). | **Yes.** | Reuses `parseCsv`, survives every other app, is searchable, and diffs. |
| S7 | **Where formulas live.** *Revised 2026-11-07, after the Excel-compatibility question; the first draft stored `=` text in the CSV and nothing cached.* | **Decided (owner, 2026-11-07).** **The CSV block holds values (what Excel showed, or what we calculated). An optional ` ```formulas ` block holds the formula of each cell that has one, in Excel's own syntax (`E2 =C2*D2`).** A formula we can evaluate is recalculated when drawn. One we cannot is **carried**: its text is kept and its value is the one Excel computed, marked "calculated by Excel". A formula that points outside the sheet is not carried; it becomes a value. | An `.xlsx` stores a formula and its cached value side by side, so this maps 1:1 on import and export, and it is the only shape that can keep a formula we cannot yet calculate. It also removes the first draft's cost: search, the assistant, `<Chart>`, the terminal app and the iPad all read numbers from the CSV block. **Costs:** two blocks to keep in step (the editor writes both); a carried formula's value is "as of import" and goes stale if you change a cell it depends on; and it must be settled before the first release, since it is what ends up in users' notes. |
| S8 | **The engine.** *Revised at Gate A, 2026-11-07.* | **Decided (owner, 2026-11-07).** **Our own parser and evaluator, behind one function (`evaluate(grid)` returning values and errors). It owns criteria matching (the `SUMIFS` family), range and text coercion, lookups, dates as serial numbers and error values. formulajs may supply a function body only where it matches the Excel fixtures.** | We own the semantics, so the terminal app and, later, Swift agree by shared vectors; and no parser toolkit with `eval`. The evaluator is the small part; the long tail is `SUMIFS`-family criteria (`">=5"`, `"<>"`, wildcards), lookups, coercion and error values. A function we lack shows `#NAME?`, never a guess. **Gate A:** formulajs matched Excel on 15 of 34 cases and `xlsx-calc` on 6 to 12, so there is no fallback: the long tail is the work, and [`excel-verified-cases.json`](../spikes/sheet/excel-verified-cases.json) is its first test suite. |
| S9 | **Excel tables.** The header row of a sheet is its table, so formulas may use column names: `=SUM([Revenue])`, `=SUMIFS([Revenue],[Region],"West")`, `=[@Units]*[@Price]`. | **Yes, after the core engine** (Step 4). A formula that names a table we do not have stays a value on import. | It is the part of Excel's tables that makes formulas readable, and it fits a one-table sheet exactly. Structured references in the Excel dialect are a subset; the rest stay values. |
| S10 | **Pivot tables.** | **A pivot imports as its cells; Re-import after refreshing it in Excel.** A native `<Pivot from="…">` over note data is a later component if you want to pivot data you author here. | Nothing in the library reads pivot definitions, and values are what you see anyway. A native pivot is the first step toward reinventing Excel; wait for a reason. |
| S11 | **Size.** *Revised at Gate A, 2026-11-07.* | **Decided (owner, 2026-11-07).** **Warn when the note passes 100,000 characters (about 800 to 1,600 rows, depending on columns; past that the editor stops colouring the note), refuse an import over 5,000 rows with a suggestion to narrow the range, and always draw the grid with virtual scrolling.** | A note is one `TEXT` value that is saved, searched, synced and parsed whole. Past the cap the honest answer is a linked file, which is S2's deferred feature, so the cap is what makes deferring it safe. |
| S12 | **Numbers, dates and formats.** | **Numbers are stored raw, dates as `YYYY-MM-DD`, everything else as the text Excel showed. No cell styles in v1.** Currency and percent display is a later per-column hint. | CSV carries no types. Storing the formatted text would break arithmetic; storing Excel's date serials would be unreadable. Step 0 tries both on real workbooks. |
| S13 | **The grid control.** *Decided in Step 3, 2026-11-08: our own, no library.* | **Choose in Step 3 between our own and a headless MIT/Apache table library. Virtual scrolling is required** (Gate A: an un-virtualized grid took 397 ms at 5,000 rows, a 60-row window about 4 ms). | Heavy data needs virtualization. The test is the same as for the engine: licence, CSP, and one `<Sheet>` costing nothing in a note that has none (loaded on demand). |
| S14 | **iPad.** | **Not in v1.** Until it has a Swift port the iPad shows a sheet's text. | The component list there is ten; this is the eleventh, with its own vectors. |

## Architecture

```
mdx/sheetData.ts      pure: the CSV block <-> a grid, A1 addressing, the `formulas` block; shared with the terminal app
apps/cli/src/sheetText.ts   the terminal app's drawing: the grid as aligned text in a code block
mdx/sheetFormula.ts   pure: calculates a grid's formulas (`evaluate`, `calculate`); mdx/sheetParse.ts reads the syntax
mdx/sheetFunctions*.ts  the function table (math and logic; text and dates; criteria and lookups)
mdx/sheetValue.ts, sheetMatrix.ts, sheetCriteria.ts, sheetFormat.ts, sheetDate.ts   Excel's rules: values and coercion,
                      arrays, criteria and wildcards, `TEXT` formats, the 1900 calendar
mdx/Sheet.tsx         the preview: the grid, the Edit and Re-import buttons
SheetDialog.tsx       the editor dialog (like DrawioDialog); SheetGrid.tsx is the grid in it (virtualized, keyboard, clipboard)
mdx/sheetSrc.ts       finds a <Sheet> in the note, rewrites its two blocks, reads a Markdown table (like drawioSrc.ts)
mdx/sheetDraft.ts     pure: the grid as typed text; rows, columns, paste, the two blocks in and out; mdx/sheetRefs.ts moves references
sheetImport.ts        loaded on demand: SheetJS -> grid + provenance + formula check
```

- **`sheetData` and `sheetFormula` import nothing from React**, as `chartData.ts` does, so the terminal app and
  the tests use them as they are, and the Swift port is checked against the same vectors.
- **The workbook reader is loaded when you import**, not with the note, so a note without a sheet (and a sheet
  without an import) pays nothing for it.
- **Registering it** is the usual list: the allowlist in `components.ts`, the catalog entries in
  `completions.ts` and `props.ts`, `MDX_COMPONENTS` and a drawing in the terminal app, a section in
  [mdx-components.md](ui/mdx-components.md), a row in the [feature matrix](feature-matrix.md).

## Gate A: what the spike found (2026-11-07)

**Gate A passed on 2026-11-07: the owner approved S8 and S11.** Step 0, run on this Mac against real software. Tools and fixtures are in [`spikes/sheet/`](../spikes/sheet/).
**Not done:** opening an exported file in Excel (last item below). **Still needed from the owner:** the output of
`spikes/sheet/inventory.mjs` on a few real workbooks, which says how heavy "heavy" is in numbers.

### SheetJS Community Edition 0.20.3 (Apache-2.0)

| Question | Finding |
|---|---|
| Which build? | The tarball from [cdn.sheetjs.com](https://cdn.sheetjs.com). The npm `xlsx` package is stuck at 0.18.5. |
| Size | `xlsx.full.min.js` 952 KB (335 KB gzipped); `core` 507 KB; `mini` 280 KB. Loaded on import and export only. Which of the three reads and writes what we need is untested. |
| Under the desktop CSP? | **Yes.** It loaded, read, wrote and produced CSV under `script-src 'self' 'unsafe-inline'; connect-src 'self'` in the browser pane (Electron's Chromium), with no violations, and with `new Function` confirmed blocked. The build contains no `eval`. |
| Formulas and values | Reads each cell's formula text (no leading `=`) and its cached value; writes `<f>` and `<v>` together. It does not calculate. |
| `_xlfn.` prefix | **Stripped on read, not put back on write.** A read-then-written `XLOOKUP` lost its prefix. The export translation in level 1 is required, not optional. |
| Dates | Reads dates (with `cellDates`) and writes a date number format (`yyyy-mm-dd`). With `cellDates` it writes `t="d"`; whether Excel accepts that is untested. |
| Tables | Does not expose table definitions; formulas with structured references arrive as text. A read-then-write **drops the table part, every style (fill, bold, number format) and the theme**, so a re-written file's structured references point at a table that is gone. Reading `xl/tables/*.xml` ourselves (SheetJS's `bookFiles` option) is untested. |
| Pivots | Not supported ([#894](https://git.sheetjs.com/sheetjs/sheetjs/issues/894)); a pivot arrives as its cells. |

### The formula engine: three candidates against real Excel

34 cases (`spikes/sheet/excel-verified-cases.json`) were entered into a new Excel workbook (Microsoft Excel for Mac
16.114.4, driven by AppleScript, closed unsaved) and each result read back. **My own reading of Excel's rules
matched Excel on 34 of 34.** Then each candidate ran the same cases:

| Candidate | Matches Excel | Notes |
|---|---|---|
| **formulajs 4.6.1** (MIT) | **15 of 34** | 143 KB minified (45 KB gzipped) for all 399 functions, no `eval`, runs under the CSP. |
| xlsx-calc 0.9.2 alone | 6 of 34 (23 crashed) | No `SUMIFS`, `COUNTIF`, `COUNT`, `TEXT` or `DATE`. |
| xlsx-calc with formulajs | 12 of 34 | `ROUND(-2.5,0)` gives -2 (Excel: -3). One unknown function **aborts the whole calculation** instead of showing `#NAME?` in that cell. |

formulajs matches on `VLOOKUP`, `INDEX`/`MATCH`, `IFERROR`, `ROUND` (including `1.005` to `1.01` and `-2.5` to `-3`),
`TEXT` percent formats, `COUNT` and `AVERAGE`. It **does not** on the families this plan is about:

- **The `SUMIFS` family.** Case-sensitive (`"apple"` gives 20, Excel 30); no `*` or `?` wildcards and no `~` escape;
  `AVERAGEIFS` and `MAXIFS` give 0 where Excel gives a value or `#DIV/0!`; ranges of different sizes are cut
  short (60) where Excel says `#VALUE!`.
- **Text that looks like a number.** `SUM` over a range counts the text `"20"` (60; Excel ignores it: 40), and
  `COUNTIF(">1")` counts the text `"2"`.
- **Dates.** `DATE` and `EOMONTH` return JavaScript dates in the local time zone (`06:00Z` here), not serial numbers.
- **Missing functions** (of an 86-name wishlist): `XLOOKUP`, `XMATCH`, `OFFSET`, `INDIRECT`, `FILTER`,
  `SEQUENCE`, `LET`, `LAMBDA`, `TEXTSPLIT`.

The cause is structural: its functions take flat arrays, so the difference between a range and a typed value, and
between a number and text that looks like one, is gone before they run; and its conditional functions use their
own matching, not Excel's criteria language. **A library of function bodies cannot fix the `SUMIFS` family,
lookups or dates; the evaluator has to own them.**

### How big a sheet can a note hold?

- **The editor already stops colouring a note at 100,000 characters** (`MAX_HIGHLIGHT_CHARS` in
  [`MarkdownHighlight.tsx`](../apps/web/src/components/notes/MarkdownHighlight.tsx)), because recolouring a huge note on every keystroke
  would lag typing. A 20-column sheet is about 125 characters a row, so 100,000 is about 800 rows (about 1,600 at
  10 columns). A sheet past that turns off colouring for the whole note. The data layer has no note-size limit.
- **Parsing is cheap.** The repo's `parseCsv`: 0.4 ms at 500 rows, 4.9 ms at 5,000, 8.5 ms at 10,000. The whole note
  through `remark-parse` + GFM + MDX: 2.4 ms, 27 ms, 56 ms. The editor's tokenizer treats a fenced block as one
  token (0.3 ms at 5,000 rows).
- **An un-virtualized grid is not.** A plain table of 20 columns took 57 ms at 500 rows, 163 ms at 2,000, 397 ms at
  5,000 (100,000 cells) and 751 ms at 10,000; the same table showing 60 rows took about 4 ms at every size.
- **The Live tab (CodeMirror 6) is fine.** With the repo's own live extension, a keystroke stayed within one frame
  (16.7 ms) on a 1.2 MB note, and the editor opened in 6 to 17 ms.
- **Not measured:** the Markdown tab's `<textarea>` with a 600 KB value, and saving, syncing and searching a note that
  large. The worktree has no installed dependencies, so the measurements used the same libraries at the versions
  `apps/web` pins, with the repo's real `parseCsv`, tokenizer and live extension bundled in.

### What this changes in the plan

- **S8 is revised:** the evaluator owns criteria matching, range and text coercion, lookups, dates and errors. The
  `xlsx-calc` fallback is dropped. formulajs may supply a function body only where it matches the Excel fixtures.
- **S11 is revised** with measured numbers, and **S13 now requires virtual scrolling.**
- **The importer reads Excel's table parts itself** (to be tested), since SheetJS does not expose them.
- **An unsupported function must become `#NAME?` in its own cell**, never stop the sheet.
- **Half done: the export test in Excel.** Opening a file by path from Excel's own AppleScript raises macOS's
  sandbox file-access panel, which blocks the automation until a person answers it (and macOS rightly stops a
  shell writing into Excel's container). `open -a "Microsoft Excel" file.xlsx` hands the file over with no panel,
  and Excel opened all three SheetJS-written test files with no dialog in the way. But Excel opens them in
  **Protected View**, its AppleScript has no way out of it, and the way out is a person clicking **Enable
  Editing**. Until then what Excel parsed and recalculated is unread, so these are still unknown: whether Excel
  calculates a SheetJS-written workbook, accepts `t="d"` dates, shows `#NAME?` for an `XLOOKUP` written without its
  `_xlfn.` prefix, and raises a repair prompt (one may only appear once editing is enabled).

## Risks

1. **The engine disagrees with Excel, silently.** Mitigated by S5 (values first), the cached-value check at
   import, `#NAME?` for what we lack, and a gate that runs the engine over real workbooks.
2. **A workbook is untrusted input.** Parse with limits (file size, rows read), never follow external links,
   never touch macros (`.xlsm` is read as data only), and keep the reader out of the notes' critical path.
3. **Size** (S11). Measure before choosing the cap.
4. **Formats** (S12). Dates and currency are where an import looks wrong first.
5. **Two implementations.** The terminal app shares the TypeScript; the iPad will need a port, with vectors.
6. **Re-import overwrites.** Mitigated by the `imported` hash and the warning; not by a merge, which is not planned.
7. **Dependencies and money.** The desktop app is meant to be sold as a one-time purchase, and not all of its code
   has to be open source, so a dependency must be MIT, Apache or BSD, and must not need a network or `eval`.
   HyperFormula (GPL or a purchased licence) and Univer's import and export (a separate commercial tier) fail that.

## Build order

Each step ends with a gate; do not start the next until it has passed. Pure rules get their tests first, as
`chartData.test.ts` does.

**Step 0: spike (no product code).** *Done 2026-11-07, and Gate A passed (S8 and S11 approved). The Excel open test and the owner's inventory run are still open; neither blocks Step 1. See [Gate A](#gate-a-what-the-spike-found-2026-11-07).* In a throwaway folder:
- SheetJS from the source we would use: does it load under the desktop CSP, how big, does a round trip keep both
  `f` and `v`, does it read table definitions?
- **An oracle script** the owner runs on their own workbooks. It prints only function names and counts (no
  cell data), and, for a prototype evaluator, how many formulas match Excel's cached value and which do not.
  That answers "how heavy" with numbers.
- **An export test:** write a sheet with `SUMIFS`, `XLOOKUP` and a date column to `.xlsx` and open it in Excel.
  Do the formulas calculate, and is there a repair prompt?
- 5,000 rows by 20 columns in the preview and in both editors: does it cope?
- formulajs `SUMIFS`/`COUNTIFS`/`XLOOKUP` against a table of Excel's documented behaviors.
- **Gate A: passed 2026-11-07.** The findings are written into this page, and the owner approved S8 (our own engine, no fallback) and S11's numbers.

**Step 1: the data and a read-only `<Sheet>`.** `sheetData.ts`, the tag, the grid in the preview, the terminal
text table, the docs. No formulas yet; literal cells only. **Gate B.** *Built 2026-11-07; waiting for
the owner's look (Gate B). What it is, and where it differs from the words above:*

- **Built:** [`sheetData.ts`](../apps/web/src/components/notes/mdx/sheetData.ts) (the CSV block as a grid; Excel's column
  letters; error values; column widths), [`Sheet.tsx`](../apps/web/src/components/notes/mdx/Sheet.tsx) (the grid, with its
  header and row numbers kept in view), the entries in the `<` menu and the prop menu, the terminal's text table
  ([`sheetText.ts`](../apps/cli/src/sheetText.ts)), and [the docs](ui/mdx-components.md#sheet). `parseCsv` gained a
  `keepBlankRows` option, because it dropped blank rows and that would have moved every row's number off its place in
  the text. A `formulas` block beside the CSV was read past in this step (the `csv` block is chosen by its tag); Step 2 reads it.
- **Refinement of S11/S13, for the owner to confirm: a sheet of up to 100 rows below the header is drawn whole, and only
  a longer one is windowed.** The preview's find-in-note searches the page's own text, so a window would hide most of
  even a small sheet from it. The cost of windowing a long sheet is the same: find sees only the rows drawn.
- **Not built, on purpose:** the provenance props (`source`, `sheet`, `range`) wait for the import in Step 4, so the tag
  takes only `title` and `height` for now.
- **Found by running it, and fixed:** a scheme's `--muted` is a faint see-through tint, so a header made with it showed the
  rows scrolling underneath. The header and row numbers now sit on the page's own background with the tint over it,
  and a test guards that.
- **Checked:** web 220 files and 3,771 tests, the terminal app 27 files and 447, both typechecks and ESLint on the
  changed files; in the browser, on a scratch database, with a 500-row sheet (31 rows drawn, the scroll height right,
  the last row reachable, the header pinned, no console errors) and find-in-note finding text in a small sheet.
- **Not checked:** a light colour scheme, a narrow window, the desktop app's own window (it runs the same renderer), and
  the terminal app's drawing in a real terminal (its text is tested, not looked at).

**Step 2: the engine.** `sheetFormula.ts`, `SUMIFS` family first, error values, and the fixtures taken from real Excel. **Gate C.**
*Built 2026-11-08; waiting for the owner's look (Gate C). What it is, and where it differs from the words above:*

- **Built:** a parser ([`sheetParse.ts`](../apps/web/src/components/notes/mdx/sheetParse.ts), Excel's syntax and precedence, no `eval`),
  an evaluator ([`sheetFormula.ts`](../apps/web/src/components/notes/mdx/sheetFormula.ts)) and **94 functions**
  (`sheetFunctions*.ts`: the `SUMIFS` family with Excel's criteria and wildcards, `VLOOKUP`/`HLOOKUP`/`INDEX`/`MATCH`/`XLOOKUP`,
  `IF` and its kind, text, `TEXT`, dates, rounding). The rules are Excel's and are in the files that hold them: coercion,
  comparison and number-to-text (`sheetValue.ts`), arrays (`sheetMatrix.ts`), criteria (`sheetCriteria.ts`), the 1900 calendar with
  its 29 February (`sheetDate.ts`). It reads the `formulas` block of S7 (`parseFormulas`, `E2 =C2*D2`, a line to a cell).
- **Refinement for the owner to confirm: the formulas are drawn.** The plan's Step 2 was the engine alone. Without more, Gate C would
  be tests nobody can look at, so the `<Sheet>` in the preview and the terminal app calculate the `formulas` block when they draw
  (a cell shows its formula when pointed at; an unreadable line in the block is said). Nothing in Step 2 edits a sheet.
- **What it will not do says so.** A function it lacks, another sheet, a table's `[Column]`, a name, a text Excel would read as a date,
  a `TEXT` format with a time, a fraction or E notation, a formula that refers to itself or fills several cells: the cell is `#NAME?`,
  its `unsupported` list says why (and so does every cell that depends on it), and nothing is guessed. Step 4 decides what to show
  for an imported formula it could not calculate (S7: Excel's own value, "carried"); for one typed in, `#NAME?` is right.
- **Checked against real Excel, not read from its documentation.** [`run-in-excel.mjs`](../spikes/sheet/run-in-excel.mjs) runs formulas in a
  new Excel workbook and records the result; [`excel-verified-cases.json`](../spikes/sheet/excel-verified-cases.json) now holds **1,216**
  of them, and `sheetFormula.excel.test.ts` runs each through the engine: all match. About 985 were written while building it, and then
  **231 were held out**: written, run in Excel, and only then given to the engine. 131 of the first 135 matched at once (the
  other four: three gaps, all arrays given where Excel lifts over them, now fixed, and one case that depends on where it sits, removed);
  all 97 of the second round (arrays, errors, whole columns, text, formats) matched.
- **Found by running Excel, which the documentation does not say** (each is a case): `IF("TRUE",…)` reads the text as a logical;
  `AND(TRUE,"a")` ignores the text; `(-8)^(1/3)` is -2; a number goes to E notation only past 20 characters (`1E-18` is written out,
  `1.5E-18` is not); a number typed in a formula is cut, not rounded, to 15 digits; `0.1+0.2-0.3` is 0 only as a formula's last step, and
  `(0.1+0.2-0.3)` is not; `SUM(0.1,0.2,-0.3)` is 0 but `SUM(0.1,0.2,-0.3,0)` is not; `"1,2345"+0` is 12345 and `"1,23"+0` is `#VALUE!`;
  `COUNTIF(r,"<>")` counts an empty text and `COUNTIF(r,"=")` does not; `MATCH` and `VLOOKUP` by approximate match run a binary
  search that gives `West` for a key of `Zed` in an unsorted column; `XLOOKUP` with a missing 4th argument is `#N/A`, with `""` it is `""`.
- **Safe:** Excel's own limits are enforced (64 levels of nesting, 8,192 characters), cells are calculated without recursion (a running
  total down 5,000 rows, and one that has to look down it, both work), each range is read once however many formulas use it
  (5,000 `SUMIFS` over 5,000 rows run in the test), and a formula that refers to itself is flagged, not looped on.
- **Not decided by me, my picks to confirm:** (1) the CSV cell is read as Excel reads typed input (`typeCell`): `1,234`, `12%`, `$5` are numbers;
  `007` stays text, so does a date (`2026-03-04`), and arithmetic on a date-like text is flagged rather than guessed (this is S12's
  question, and Step 4 settles it); `TRUE` and `FALSE`, in capitals, are logicals. (2) The arrays and the dynamic-array functions follow Excel 365,
  and numbers and text follow its US-English conventions (a comma between thousands, `.` the decimal point, English day and month names).
- **Not checked:** the function list was chosen **without the owner's inventory run**, so it is my guess at what real workbooks use;
  the owner's workbooks have not been through the engine (a script that compares the engine with a workbook's cached values is the
  tool for that, and the import of Step 4 does the same); Excel for Windows and other versions (only Excel for Mac 16.114.4); the
  light scheme, a narrow window, the desktop app's window; the terminal app in a real terminal; text order beyond what `Intl.Collator`
  gives (Excel's was matched on 30 pairs of punctuation, digits, accents and `ß`; a Swift port will need its own collation).
- **Known gaps** (each says so in the cell, none is wrong): `TODAY` and `NOW` (they change on their own, which the stored values do not),
  `FILTER` `SORT` `UNIQUE` `LET` `LAMBDA` and the other dynamic-array functions, `OFFSET` and `INDIRECT`, `NETWORKDAYS` `DATEDIF`,
  `STDEV` and the statistics beyond the ones listed, `ROW` of a whole column, `XLOOKUP` by binary search, a `CHAR` above 127.
  `COUNTBLANK` of a whole column counts the cells the sheet holds, not Excel's million.

**Step 3: the editor.** The dialog, `sheetSrc.ts`, the shortcut, the `<` menu entry, promote-a-table. **Gate D.**
*Built 2026-11-08; waiting for the owner's look (Gate D). What it is, and where it differs from the words above:*

- **Built:** an **Edit sheet** button on a sheet in the preview (like **Edit diagram**), a **Sheet** button in the note's toolbar and
  **Ctrl/Cmd+Shift+G**, which open the grid dialog ([`SheetDialog.tsx`](../apps/web/src/components/notes/SheetDialog.tsx),
  [`SheetGrid.tsx`](../apps/web/src/components/notes/SheetGrid.tsx)) on the sheet the caret is in, else on the Markdown table the
  caret is in (**promote**: saving replaces the table with a sheet), else on a new sheet at the caret. In the grid: arrows, Tab and Enter,
  typing to replace and F2 to edit, formulas typed as `=…` and shown as their result, range selection (keys, shift-click, drag, a column
  letter or row number), Delete, copy, cut and a **paste of a range from Excel**, rows and columns in and out, undo and redo, Ctrl/Cmd+S.
  **Save sheet** writes both blocks and the note changes as one edit (one undo). The pure parts are tested on their own:
  [`sheetSrc.ts`](../apps/web/src/components/notes/mdx/sheetSrc.ts), [`sheetDraft.ts`](../apps/web/src/components/notes/mdx/sheetDraft.ts),
  [`sheetRefs.ts`](../apps/web/src/components/notes/mdx/sheetRefs.ts). It is described in [mdx-components.md](ui/mdx-components.md#editing-a-sheet).
- **S13 decided: our own grid, no library.** The preview already windows rows (a fixed row height, a window and a spacer), the grid needs
  the same, and a table library would have added a dependency (and its licence and CSP check) for the part that is not hard: the
  hard parts are the keyboard, the selection and the clipboard, which a library does not do for a spreadsheet either. Only the rows in view
  are drawn, so a sheet of 5,000 rows costs what one of 50 does (a test draws 5,001 rows and counts under 80); it is one tab stop
  with `aria-activedescendant`, so a cell scrolled out of the window is no loss of focus.
- **Inserting and deleting rows and columns move the formulas, as Excel does.** Without this the editor would corrupt a sheet silently
  (a row put in above a total would leave the total pointing at the old cells), so [`sheetRefs.ts`](../apps/web/src/components/notes/mdx/sheetRefs.ts)
  rewrites the references from the formula's own tokens: a reference below a new row moves, a range with a row put inside it grows (one with a
  row put just below does not, which is Excel's famous gotcha), a deleted row shrinks a range, a reference to a deleted cell is `#REF!`;
  cell names inside a text, function names (`LOG10(`) and another sheet's cells are left alone. **These rules are Excel's as I know them,
  and were not run against Excel** (the runner reads formulas; it cannot insert a row).
- **What is saved.** The CSV holds each cell's value, a formula's result included (S7), and the `formulas` block the formulas, down the
  rows. The empty rows at the foot and empty columns at the right are left off. **Row 1 must not be empty while other rows are**: the CSV
  reader drops a leading blank row, which would move every address up, so Save says so instead of writing it.
  A text that begins with `=` is held as `'=…`, as in Excel, so it is never taken for a formula.
- **Refinement for the owner to confirm, how it behaves** (my picks, from Excel's habits; each is one line to change): **Enter moves down**
  (it does not start editing; F2 or typing does), and after Tab-ing along a row Enter goes back to the column the row began in;
  **Enter after typing in the last row starts a new row** (empty ones at the foot are left off when saved); **Tab goes on to the next
  control** past the first or last cell, so the grid is not a trap; the shortcut is **Ctrl/Cmd+Shift+G** (G for grid; nothing else in the app
  uses it, and it replaces the browser's "find previous" in the editor only); the **`<` menu entry stays as it was** (it inserts the
  empty tag, to type a CSV into), since the menu is text in the editor and the dialog is a separate way in.
- **Found by running it, and fixed:** the first open put the keyboard on the first toolbar button, not the grid (the dialog now leaves
  the focus to the grid); clicking another cell while one was being typed in sent the selection back to the typed cell (the commit by
  blur no longer moves it); a preview opened before a code change kept the old handler (a reload fixes that, only a dev-server matter).
- **Checked:** web 5,228 tests, typecheck and ESLint clean. In the browser, on a scratch database: **Edit sheet** from the preview, typing
  with the keyboard (a table typed row by row with Tab and Enter, a formula in it, Ctrl/Cmd+S), a row put in above a total (the formulas
  below it moved and the range grew, in the note's text after Save), a Markdown table promoted, a new sheet at the end of the note,
  a 300-row sheet (Ctrl+Down to the last row, Page Down, the highlighted cell kept in view), and **one undo of the note took a saved sheet
  back to what it was**.
- **Not checked:** a range copied from a real Excel (tested with the clipboard text Excel puts there, a tab between cells and a line break
  between rows, not with Excel itself); Safari and Windows; a light colour scheme; a narrow window; the desktop app's own window; a screen
  reader (the grid is an ARIA grid, and has not been listened to); typing with an input method (the grid leaves a composition alone,
  untested); a sheet at the limit of 5,001 rows in the editor by hand (its window is tested, the typing is not).
- **Known gaps** (the dialog and [mdx-components.md](ui/mdx-components.md#editing-a-sheet) say so): dragging to fill, copying a formula to another cell
  with its references moved (it pastes as text), pointing at a cell to put its address in a formula, column widths you set, sorting and
  filtering, cell formats, and finding text in the grid. **For Step 4:** Save writes `#NAME?` in the CSV for a formula the engine cannot
  calculate, which is right for one typed here and wrong for an imported one, whose Excel value must be kept (S7, carried).

**Step 4: Excel in.** Paste a range, **Import from Excel…** (values first; formulas recalculated where they match
and carried where they do not), the `formulas` block, the import summary, provenance props. Then column-name
references (S9). **Gate E.**
*Built 2026-11-08 except column-name references (S9); waiting for the owner's look (Gate E). What is built, and where it differs from the words above:*

- **Built:**
  - **The note's format for a formula that came from Excel (S7's "carried"):** a line `E2 carried =XLOOKUP(…)` in the `formulas` block.
    A carried cell is not calculated: it shows the value in the CSV (Excel's), marked with a dot and a tooltip, and what reads it reads that
    value. [`parseFormulas`](../apps/web/src/components/notes/mdx/sheetData.ts) reads the marker, `calculate` takes the carried set, the
    preview, the terminal app and the grid editor all honour it, and the editor keeps a carried cell as it was until it is typed over.
  - **A date written `2026-03-04` is read as a date** (S12's open question, settled): `typeCell` and text-to-number coercion give its serial
    number, as Excel reads a date typed in, and `2026-02-30` or a year before 1900 is text. **Checked in real Excel**: 29 new cases in
    `excel-verified-cases.json` (including `"2026-03-04"+1`, `VALUE`, `COUNTIF` with `>=2026-03-04`, 1900-02-29 as 60, `2026-02-30` as
    `#VALUE!`), all matching; the Excel test now types plain string cells as Excel does.
  - **The import core** ([`sheetImport.ts`](../apps/web/src/components/notes/mdx/sheetImport.ts), pure): a range of cells as Excel saved them in,
    the CSV and `formulas` blocks and a summary out. Each formula is moved to where the range began and made a **value** if it reads
    anything outside the range, another sheet, a table or a name ([`rebaseReferences`](../apps/web/src/components/notes/mdx/sheetRefs.ts));
    otherwise it is checked **on its own against Excel's saved values for the cells it reads** (a copy of each formula sits off to
    the right of the grid, so a formula is wrong by itself and not because one it reads was, and nothing is over-carried), and is
    **calculated** if it gives Excel's number to 15 digits, **carried** if its function is unknown or its result differs, or if Excel shows
    its result as a date. What is left is checked once more together (a chain can drift; a circle Excel did not have). A date cell is
    written `2026-03-04`, a 1904 workbook is converted, and a date with a time keeps Excel's text. A range with more than 5,001 rows or
    100 columns, or an empty first row, is refused with the reason.
  - **Paste from Excel is offered as a sheet** (the text stays text, as today): a range copied from a spreadsheet gets a line with **Make it a
    sheet**, which opens the grid editor on the cells; both editors, tested.
  - **Provenance props** `source`, `sheet`, `range`, `imported` on `<Sheet>` (drawn as a line under it and in the terminal; `imported` is a
    SHA-256 fingerprint of the two blocks, for Step 5).
  - **The import dialog** ([`SheetImportDialog.tsx`](../apps/web/src/components/notes/SheetImportDialog.tsx)): choose a file, a sheet and a range,
    read what would come across ("52 formulas: 47 kept, 3 carried because…, 2 kept as values because…"), **Insert sheet**. It takes the
    reader as a prop and is tested with a made-up workbook.
- **The workbook reader** ([`sheetWorkbook.ts`](../apps/web/src/components/notes/mdx/sheetWorkbook.ts)): **SheetJS Community Edition 0.20.3**, added by the owner
  with `pnpm add https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` in `apps/web` (the lockfile holds its SHA-512; it is not on npm past 0.18.5, so
  **Dependabot cannot track it**: a new version is a line to change by hand). It is `import()`ed only when a workbook is read, so a note, and a
  sheet in it, pay nothing for it. It reads each cell's formula (SheetJS has already written out a formula Excel shared down a column, and
  taken off `_xlfn.`; the adapter takes off `_xlws.` too), the value Excel saved, and the number format, which says date, time or number
  (`numberFormatKind`, tested on 21 formats); errors as the text Excel shows; a 1904 workbook; hidden sheets listed and very hidden ones not.
  It reads at most 100,000 rows of a sheet and refuses a file that does not start as a zip or an older workbook container (SheetJS would read
  any text as a sheet), or one over 50 MB, or protected by a password; it never follows a link, runs a macro or reads a pivot (its cells are what it is).
  Tested on workbooks made by SheetJS and on one **written by hand as XML**, with a shared formula, shared strings with rich text and 1904 days.
- **The `Import from Excel…` button** ("Excel", next to "Sheet" in the note's toolbar) opens the dialog; **Insert sheet** puts the sheet in the note at
  the caret with `source`, `sheet`, `range` and `imported` on its tag, as one undo step.
- **Checked in the browser**, on a scratch database, with a workbook made for it (two sheets, five formula kinds, dates): the dialog listed both sheets with
  their ranges, said "6 rows by 9 columns; 12 formulas: 10 kept as formulas, 1 carried (the function FILTER), 1 kept as a value (another sheet or
  workbook)", and the inserted sheet showed its values, its dates as `2026-03-04`, a dot on the carried cell and "Imported from budget.xlsx, sheet Q3
  budget, A1:I6" under it. Also: carried dots and tooltips, the provenance line, and the paste offer with its dialog and save.
- **Not checked:** a workbook saved by Excel itself or by another program (the formula, value and format reading is SheetJS's, tested here on files
  built by SheetJS and by hand, not on yours; a workbook-vs-engine run on your own files is the way to learn what your formulas do: `inventory.mjs`
  first); a password-protected one (the message is written, not seen); a file near the 50 MB limit; Safari and Windows; the desktop app's window.
- **Not built, by plan:** column-name references (S9, `=SUM([Revenue])`), which want the table parts of the file; until then a formula that names a
  table becomes a value on import. The picker offers `.xlsx` and `.xlsm`; SheetJS would also read an `.xls`, which is not promised.
- **Picks to confirm:** `carried` as the word and its place before the formula; a formula whose result Excel shows as a date is carried
  (a sheet has no cell formats, so a recalculated date would show as a number of days); text-formatted numbers (`"123"` that Excel keeps
  as text) become numbers when read back from the CSV, which the formula check catches where a formula depends on one; cells
  lose leading and trailing spaces, as the CSV reader trims; names and tables make a formula a value, not a carried one, since the
  export could not write them back.

**Step 5: Excel out and back.** **Re-import** with the `imported` hash and the overwrite warning, **Export…**
to `.xlsx` (the `_xlfn.` translation, column-name references as ranges, a summary of what could not come along)
and CSV. **Gate F.**

**Step 6: the owner's by-hand test**, with real workbooks, written up as `manual-tests/sheet.md` like the other
features. **Gate G.**

## Non-goals and future work

- **A live link to a file** (S2). The upgrade of Re-import: the file is stored with the note (an attachment) and
  the sheet reads a range from it. It needs the attachments blob path in sync first
  ([cross-device-sync-design.md](cross-device-sync-design.md)).
- **`<Pivot from="…">`**, a native pivot of a sheet's rows, and **`<Chart from="…">`** reading a sheet (it
  would evaluate it first).
- **Cell formatting**, several sheets in one tag, conditional formatting, named ranges, and Excel features with no
  CSV home.
- **Writing edits back into the original workbook**, with its other sheets, styles and pivots intact (level 3 of
  [Toward Excel-compatible formulas](#toward-excel-compatible-formulas)).
- **The iPad's drawing** (S14).

## Why not a stored `.xlsx`

A workbook stored in `app_data/` or as an attachment would be the most faithful, and the wrong fit here. The
text of a diagram is already not searchable and every save orphans a file
([diagrams.md](architecture/diagrams.md#gaps)); a workbook would add that, would not render in the terminal
app or on the iPad without a reader in each, and is binary to sync and to encrypt. It is the right answer for
a large workbook you keep editing in Excel, which is the live link, and that is deferred on purpose.
