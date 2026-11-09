# Sheet spike (Step 0)

Tools and fixtures for [docs/sheet-component-plan.md](../../docs/sheet-component-plan.md). The findings are in
that page's [Gate A](../../docs/sheet-component-plan.md#gate-a-what-the-spike-found-2026-11-07) section.

## `inventory.mjs`: run this on your own workbooks

How heavy are the formulas in the Excel files a note would be fed from?

```bash
node spikes/sheet/inventory.mjs ~/path/to/book.xlsx
node spikes/sheet/inventory.mjs a.xlsx b.xlsx c.xlsx      # several at once, with a combined function list
```

- It prints **only numbers and Excel function names**: how many sheets, formula cells, tables, pivot tables,
  charts, named ranges, external links and macros; how many formulas point at another sheet or workbook, use
  table (`Table1[Col]`) references or whole-column references; and a list of the functions used, grouped into
  families (conditional aggregation, lookup, dynamic array, volatile, dates, text, finance).
- It **never prints** a cell value, a sheet name, a table name, a defined name or a file path, so the output
  is safe to paste into a chat. (The one way a function name can reveal something is a custom function with a
  revealing name.)
- It has **no dependencies** and reads the file with `node:zlib`. Nothing is written, run or sent anywhere,
  and a macro (`vbaProject.bin`) is counted, never opened. Parts over 512 MB are refused.
- `--json` prints the same numbers as JSON.

Bring the output back and it settles how large the formula engine has to be.

## `excel-verified-cases.json` and `run-in-excel.mjs`: the engine's tests, from real Excel

More than 1,200 formulas, each run in real Microsoft Excel for Mac, with what Excel returned. They are the test cases
of the formula engine (`apps/web/src/components/notes/mdx/sheetFormula.ts`), which must give the same: the test is
`sheetFormula.excel.test.ts`. Excel, not a reading of its documentation, is the spec.

- `cells`: the sheet the formulas run in (a number, a boolean, a text, `{ "text": "1" }` for a number stored as text, or
  `{ "formula": "=B1+1" }` for a cell that is a formula). `ranges`: names for use as `{NAME}` in a formula.
- `cases`: `{ label, formula, excel }`. `excel` is a number, a text, a boolean, or `{ "error": "#N/A" }`.

To add a case, add `{ "label": "...", "formula": "..." }` (no `excel`) and run:

```bash
node spikes/sheet/run-in-excel.mjs            # run the cases that have no result yet
node spikes/sheet/run-in-excel.mjs --all      # run them all again and report any that changed
node spikes/sheet/run-in-excel.mjs --dry-run  # print the AppleScript, run nothing
```

It builds `cells` in a **new** workbook, enters each formula with `formula2` (Excel's dynamic-array mode), reads the
results back, and closes the workbook without saving; nothing you have open is touched. It needs Excel on a Mac, and the first
run asks macOS for permission to control it. A formula that depends on where it is (`ROW()`, `SUM(2:2)`) cannot be a case:
the results are all in one column.

## What is not here

The throwaway scripts behind the other findings (SheetJS round trips, the formulajs and xlsx-calc comparisons,
the CSP page, the size measurements) were run from a scratch folder and are not kept: the numbers are in the plan.
