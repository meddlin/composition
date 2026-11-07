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

## `excel-verified-cases.json`

34 cases (`SUMIFS` family, `COUNTIF`, lookups, `ROUND`, `TEXT`, dates) that were each run in real Microsoft
Excel for Mac 16.114.4 on 2026-11-07: the data and formulas in `layout` and `cases[].formula` were entered into a
new workbook and `cases[].excel` is what Excel returned. They are the first test cases for our own engine
(`mdx/sheetFormula.ts`, Step 2). Add more the same way; Excel, not a reading of its documentation, decides.

## What is not here

The throwaway scripts behind the other findings (SheetJS round trips, the formulajs and xlsx-calc comparisons,
the CSP page, the size measurements) were run from a scratch folder and are not kept: the numbers are in the plan.
