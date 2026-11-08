# Manual test: spreadsheets in notes

A guided test of the `<Sheet>` component with real workbooks and a real Excel: drawing a sheet, editing it in the grid, column names
in formulas, pasting a range from Excel, importing a workbook, re-importing it after the workbook changed, exporting to Excel
and CSV, the size limits, the terminal app, and **your own workbooks**. It runs on a **scratch home**, never your real notes.

What the component does: [ui/mdx-components.md](../ui/mdx-components.md#sheet). The design and its decisions:
[sheet-component-plan.md](../sheet-component-plan.md). This is Gate G of that plan: the tests that need Excel and your eyes.

## Why there is a tool

The automated tests check the engine against Excel's own answers (more than 1,200 formulas, recorded from a real Excel) and the
import and export against workbooks they write themselves. What they cannot say is whether the grid *feels* right, whether a
workbook **you** keep in Excel imports the way you expect, or whether Excel is happy with a file the app wrote. So the tool:

- builds a scratch home with three notes, each a place to try something, and the **sample workbooks** to import, which have the
  things real workbooks have: an Excel table with a totals row, formulas this engine cannot calculate, a stale saved value, a
  workbook that counts from 1904, a sheet at the size limit and one a row over it;
- has a `check` command that runs **a workbook of yours** through the import and prints how many of its formulas stay formulas, are
  carried or become values, **without printing a cell**, so you can look at a private budget without it going anywhere.

## Run it

From the repo root, with the dependencies installed for `apps/web` and `apps/desktop`:

```bash
pnpm manual:sheet                                   # the commands, and where the scratch home is
pnpm manual:sheet setup                             # build the scratch home
pnpm manual:sheet launch                            # prints the commands that start each app on it
pnpm manual:sheet check ~/Documents/budget.xlsx     # a workbook of yours
```

`setup` and `launch` take `--home DIR`; the default is a folder in your system's temp directory (`pnpm manual:sheet` prints it). To
start over, delete the folder or use another `--home`. `setup` refuses a database that already has notes.

| Command | What it does |
|---|---|
| `setup` | Makes the three notes and writes the sample workbooks into `<home>/workbooks` |
| `check BOOK.xlsx [MORE.xlsx …] [--names]` | For each sheet of each workbook: its size, and what an import of its used range would do with its formulas, and why. Counts and function names only; sheet names are shown only with `--names`. It touches no database |
| `launch` | Prints the command that starts the desktop app, the web app (at <http://localhost:3000>) and the terminal app on the home |

The three notes:

| Note | What it is | Used in |
|---|---|---|
| **Sheet tour** | Four sheets: a budget with a totals row and column names in its formulas, orders by region with dates, `SUMIFS` and text, a 300-row sheet, and one with a formula this engine cannot calculate | 1, 2, 3, 6, 9 |
| **Sheet: promote, paste and start** | A Markdown table, and two empty places to paste and to start a sheet | 4 |
| **Sheet: re-import** | A sheet imported from `orders.xlsx`, written as the **Import from Excel** button writes it, fingerprint included | 5, 6, 7 |

The sample workbooks, in `<home>/workbooks`:

| File | What it holds | Used in |
|---|---|---|
| `orders.xlsx` | Sheet **Orders**: an Excel table called *Orders* (header, six rows, a totals row), dates, a percent, and beside it `SUMIFS`, `XLOOKUP`, `FILTER`, `TEXT`, an `IFERROR(VLOOKUP…)` and a read of another sheet. Sheet **Prices**: two small columns | 5, 6, 9 |
| `carried.xlsx` | Formulas that must not be trusted: `STDEV`, `NETWORKDAYS`, `TODAY`, `LET`, a read of another sheet, and a stale saved value (999 where the formula gives 10) | 5 |
| `old-1904.xlsx` | A workbook that counts days from 1904, with two dates | 5 |
| `big.xlsx` | **Big**: 5,001 rows by 6 with 10,000 formulas, exactly the limit. **TooBig**: 5,200 rows | 8 |
| `not-a-workbook.xlsx`, `cut-short.xlsx` | A text file with an `.xlsx` name, and a workbook cut off after 1,500 bytes | 8 |

Start the app you want to test with the command `launch` prints, in a second terminal. The sheet is the same code in the desktop
app and the web app; the desktop app differs in one place, where an export is saved (test 7).

## The tests

Each test starts from the scratch home as `setup` left it unless it says it continues. Steps that need Excel say so; they are
the reason this test is by hand. If Excel opens a file in **Protected View**, choose **Enable Editing**.

### 1. Look at the sheets

Open **Sheet tour** in split view.

| Look at | Expect |
|---|---|
| **Budget** | Letters over the columns, row numbers down the side, numbers flush right. Revenue is 1,140 / 760 / 900 and the last row says **245** units and **2,800**. Its total is in its own CSV row, so its tag says `totals="true"` |
| **Orders by region** | Dates written `2026-03-04` are in the Due column as written. B6 is **2,040** (the West rows added up). Point at B6: its formula is shown |
| **Squares** | 300 rows in a box 240 pixels tall: it scrolls, and the header and row numbers stay in view. Scroll to the bottom: the last running total is **9,045,050** |
| **Not calculated** | B2 and B4 show **#NAME?**, in the error colour; pointing at one says the function `FILTER` (or `LET`) is not calculated here. B3 is 14, which does not depend on either |
| Every sheet, in every colour scheme | Readable in all of them (Settings > Appearance). Light is the one nobody has looked at yet |
| The editor on the left | Switch to **Markdown** only: the sheets are the `csv` and `formulas` blocks you see, plain text |

### 2. Edit in the grid

In **Sheet tour**, point at **Budget** and press **Edit sheet**.

1. Click a cell and type a number: it **replaces** the cell. **F2** edits what is there; **Escape** drops what you typed; **Enter** moves down, **Tab** right.
2. Change West's Units to **200**: Revenue becomes 1,900 and the totals row **325** and **3,560**, as soon as you leave the cell.
3. Select a row's number and press **Row above**. Formulas that read the rows below still read the right cells; the totals row's `SUM` still covers every row. Undo (**Ctrl/Cmd+Z**) takes it back.
4. **Copy** a few cells and paste them into Excel or a text editor: tabs between cells, a line break between rows. Paste a range copied from Excel into the grid: it lays down from the selected cell and the grid grows.
5. **Cancel** after changes asks before it throws them away. **Ctrl/Cmd+S** saves, also in the middle of a cell.
6. After **Save sheet**, switch the editor to **Markdown**: the `csv` block holds each cell's *value*, the totals row's too, and the `formulas` block holds the formulas down the rows. One **Ctrl/Cmd+Z** in the note puts the whole sheet back as it was.
7. Press **Ctrl/Cmd+Shift+G** with the caret in a sheet: the same editor opens. On the note's toolbar, **Sheet** does too.

### 3. Column names and the totals row

Continue from test 2 (or repeat it). In the editor of **Budget**:

1. Its formulas are `=[@Units]*[@Price]` and `=SUM([Units])`: names, not letters. Select the Units column's letter and press **Column left**: the formulas keep working, since they say which column, not where it is.
2. **Untick Last row is a totals row.** The totals row's `SUM([Units])` now reads its own cell, and the sheet says so. Tick it again: it is right.
3. **Rename the header** *Units* to *Qty* (press **F2** on it and type). The formulas that used it follow, as in Excel: select a cell in the Revenue column and the line above the grid reads `=[@Qty]*[@Price]`; the totals row reads `=SUM([Qty])`; the numbers do not change. Rename it to *Unit count*: the formulas read `[@[Unit count]]`. Paste over the header with a cell copied from elsewhere: the same. Clear the header cell instead: the formulas keep the old name and say **#REF!**, since a column with no name has none to follow. Undo.

### 4. Promote, paste and start

Open **Sheet: promote, paste and start**.

1. Put the caret in the **Markdown table** and press **Ctrl/Cmd+Shift+G**: the grid opens on its cells. Add a row, **Save sheet**: the table in the note is replaced by a sheet.
2. In Excel (or a spreadsheet) copy a few cells, paste them on the empty line under *Paste a range…*. A line at the top of the editor offers **Make it a sheet**: choose it, **Save sheet**. (It has no formulas: Excel puts only values on the clipboard.) Paste again and choose **Keep as text**: the offer goes away and the text stays.
3. Paste text indented with tabs, and text with no tabs: neither is offered.
4. Put the caret on the last empty line and press **Ctrl/Cmd+Shift+G**: a new sheet starts at the caret.

### 5. Import a workbook

Open **Sheet: promote, paste and start** (or any note), put the caret on an empty line, choose the **Excel** button in the toolbar (**Import from Excel**), and pick `<home>/workbooks/orders.xlsx` in the file picker.

| Look at | Expect |
|---|---|
| The dialog | Sheet **Orders** is chosen and its range is filled in: **A1:J8**. It says **8 rows** by **10 columns** and **20 formulas**: **16** kept as formulas, calculated here, **3** carried (*the function SUBTOTAL (2); the function FILTER (1)*), **1** kept as a value (*another sheet or workbook*) |
| The range box: type **A1:H8** and press Enter | **14 formulas**: **12** calculated and **2** carried (*SUBTOTAL*). Type **E1:E8**: 7 formulas, 1 carried and **6 kept as values** (they read columns the range does not hold). Type **A1:J20**: the same as A1:J8, since empty rows at the foot are left off |
| **Insert sheet** | The sheet appears at the caret with the line **Imported from orders.xlsx, sheet Orders, A1:J8**. Revenue and Share are formulas that give Excel's numbers. The Due column reads `2026-03-04`. The three carried cells (the two `SUBTOTAL`s and the `FILTER` one) have a **dot**; pointing at one shows the formula and says Excel calculated it |
| Point at the `Prices!B2*2` cell | It is a **value**, 1.9: another sheet is not read |

Then the other workbooks, each from the dialog:

- `carried.xlsx`, sheet **Carried**: **10 formulas**: **4** calculated, **5** carried (*STDEV, NETWORKDAYS, LET, TODAY*, and *its result is not the one Excel saved*), **1** value. Insert it: the Tape row shows **999** with a dot (Excel's saved value, not our 10). The `LET` one is **carried** too (*the function LET*): the file has it as `_xlfn.LET(_xlpm.x,B4,_xlpm.x*2)` as Excel saves it, and it is shown as `LET(x,B4,x*2)`.
- `old-1904.xlsx`: no formulas. The dates come across as **2026-03-04** and **2026-03-09**, the dates Excel shows (a 1904 workbook stores them as other numbers).
- Cancel at any point: nothing is inserted. A file you choose is read in the page: nothing is sent anywhere.

### 6. Re-import

Open **Sheet: re-import**. Its sheet was written as an import writes it, so it knows `orders.xlsx`.

1. Point at it and choose **Re-import**, then pick `orders.xlsx`. The dialog says it **replaces the sheet imported from orders.xlsx** (sheet Orders, A1:J8) and has **no warning**; the button is **Replace sheet**. Cancel.
2. **Change the workbook in Excel:** open `orders.xlsx`, change the first West row's **Units to 200**, save, and close it. (This is a workbook **saved by Excel itself**, which the automated tests have never read: it is the first thing to look for. If the re-import refuses it, or the counts differ from test 5, write down what it said.)
3. **Re-import** and pick the file again, **Replace sheet**: Revenue becomes **1,900** and the sheet's totals follow. The tag keeps its caption and the line under it. **Ctrl/Cmd+Z** in the note puts the old sheet back in one step.
4. **Edit the sheet** in the grid (change a name in the Region column), save, then **Re-import**: the dialog opens with **This sheet has been changed since it was imported…** and the button reads **Replace my changes**. Cancel leaves your edit; confirming replaces the whole sheet (nothing is merged: a formula you typed is gone).
5. Re-import and pick `carried.xlsx` instead: the dialog says **This is carried.xlsx, and the sheet came from orders.xlsx** and shows its first sheet, and replacing is still your call.
6. Delete the line `imported="…"` from the sheet's tag in the Markdown: **Re-import** now treats the sheet as changed, as it should (a sheet written by hand has no fingerprint).

### 7. Export

In **Sheet tour**, point at **Orders by region** and choose **Export…**.

| Look at | Expect |
|---|---|
| The dialog | It says what it writes: the rows and columns, the formulas written **as formulas with the value they show**, the dates (**yyyy-mm-dd**), and what is **not** kept (cell formats, colours, column widths) |
| **Excel workbook** | A browser downloads `Orders by region.xlsx`. The **desktop app** downloads nothing: it opens the system's **save dialog** with that name; the Export window says **Saved.** after you choose a place, says nothing if you dismiss the dialog, and the file always ends in `.xlsx` whatever you type |
| Open it in **Excel** | **No repair prompt.** The formulas are there: B6 `=SUMIFS(B2:B5,A2:A5,"West")`, and it shows **2,040**; D2 shows **West: 1,140**; the dates in Due are dates, shown `yyyy-mm-dd`; the sheet is named for the caption. Edit B2 in Excel: B6 changes |
| **CSV** | A file of the values the sheet shows. Open it in Excel by double-clicking: it opens as columns with nothing garbled (it is UTF-8 with the byte order mark Excel needs) |
| **Copy cells** | Paste into Excel: tabs become cells |

A `LET`, which Excel stores with marks the others do not need: in **Sheet tour**, export **Not calculated** as **.xlsx** and open it in Excel.

- B4 shows **6** and B3 shows **14**, with **no repair prompt**. Click B4: Excel shows `=LET(x,A4,x*2)`; the file holds `_xlfn.LET(_xlpm.x,A4,_xlpm.x*2)`, with `_xlpm.` before each `x` as Excel itself saves it. **This is the one form the app writes that has never been opened in Excel here** (Excel's AppleScript cannot leave Protected View for a file made on this machine), so it is yours to look at: a repair prompt, `#NAME?` or a `x` that Excel treats as a name means the prefix is wrong, and what Excel did is worth writing down.
- B2 is the `FILTER` one: write down how Excel shows it too.

Then the harder one: in **Sheet: re-import**, export the imported **Orders** sheet as **.xlsx** and open it in Excel.

- The carried cells are **formulas** with Excel's value beside them: C8 `=SUBTOTAL(109,$C$2:$C$7)` shows **345**, and the `FILTER` one in J4 is a formula too. **Write down how Excel shows J4**: `FILTER` is written the way the file holds it (`_xlfn._xlws.FILTER`), and what Excel does with it in a cell that is not an array formula has not been looked at.
- Revenue and Share are formulas that read **ranges** (`$E$2:$E$7`), since Excel would not know this sheet's table.
- Import the file you just exported, back into a note: **19 formulas**, **16** calculated and **3** carried (*SUBTOTAL (2), FILTER (1)*): test 5's, less the one that read another sheet, which was already a value.

### 8. Limits and files that are not workbooks

From the import dialog:

| File | Expect |
|---|---|
| `big.xlsx`, sheet **Big** | It says **5,001 rows** by **6 columns**, **10,000 formulas**, all kept as formulas, calculated here. Insert it. The note stays usable: scrolling the sheet is smooth, and the editor opens (note how long it takes: write it down). Change a cell near the top of the grid: the running totals below change and the editor does not freeze |
| `big.xlsx`, sheet **TooBig** | Refused: **That range has 5,200 rows, and a sheet holds at most 5,001 (the header included). Choose a narrower range.** Choose **A1:F100** and it imports |
| `not-a-workbook.xlsx` | **It is not an Excel workbook.** |
| `cut-short.xlsx` | The same message: a file cut short cannot be read |
| A workbook with a **password**, if you have one | **It is protected by a password.** (Not covered by the sample files: Excel makes these.) |
| An old `.xls` file, if you have one | **It is not an Excel workbook.** (Only `.xlsx` and `.xlsm` are read) |

### 9. Your own workbooks

This is the test that matters most, and the one only you can do.

1. `pnpm manual:sheet check ~/Documents/budget.xlsx` for each workbook you keep in Excel. For each sheet it prints the used range, the formula counts and the reasons. Add `--names` to see sheet names. It never prints a cell, and writes nothing.
2. For the workbooks you would really bring into a note, import the sheet in the app and compare: the dialog's counts **match** what `check` printed, and each formula that stays a formula **shows the number Excel shows**. Pick five at random and compare them by eye.
3. Look for what surprises you:
   - a formula **kept as a value** that you expected to stay a formula (the reason says why: another sheet, a name, a cell outside the range);
   - a formula **carried** whose function you expected the engine to have (the plan lists 94);
   - any number that is **different from Excel's**. That is the worst failure this feature can have, and the import is built so it cannot happen (each formula is checked against Excel's saved value before it is kept), so report it as a bug.
4. Edit a cell in the imported sheet, **Export…** to `.xlsx` and open it in Excel: the sheet is the same, formulas included.

Please report: workbooks that took more than a second to import (say how big), any message that did not make sense, and any workbook feature you rely on that did not come across (merged cells and formats are known; pivot tables are not read).

### 10. The terminal app

Start the terminal app on the home (the command `launch` prints) and open **Sheet tour** and **Sheet: re-import**.

- Each sheet is **aligned text with Excel's column letters and the row numbers**, the caption in bold above it; numbers are flush right.
- **Not calculated** lists *B2* and *B4* with their reasons under the block, since a terminal cannot be pointed at a cell.
- The imported sheet has a line **Imported from orders.xlsx, sheet Orders, A1:J8**, and its carried cells show Excel's value without being listed as not calculated.
- **Squares** shows the first 50 rows and says how many it left out.

## Things worth trying on top

- **A sheet in a note with a lot of text** (the editor stops colouring the whole note past 100,000 characters; a sheet that size says so under itself).
- **Search for a number** that only a sheet has (for example 2,800) from the search box: the CSV block is in the note, so it is found.
- **A backup round trip:** make a backup in Settings, delete the scratch home's database, restore: the sheets are text in the notes and come back as they were. See [backup-restore.md](backup-restore.md).
- **Two windows on the same note** (desktop): edit a sheet in one, and see the other pick up the new text.
- **A screen reader, an input method (IME) in a cell, a narrow window:** none has been checked yet. The grid is an ARIA grid and the plan lists these as unverified.

## The automated checks behind this

| Where | What |
|---|---|
| `apps/web` `sheetFormula.test.ts`, `sheetParse.test.ts`, `sheetCriteria.test.ts` and the others in `components/notes/mdx` | The engine, and `spikes/sheet/excel-verified-cases.json` and `excel-verified-tables.json`: more than 1,200 formulas with the answer real Excel gave each |
| `apps/web` `sheetImport.test.ts`, `sheetWorkbook.test.ts`, `sheetTables.test.ts` | What an import keeps as a formula, carries or makes a value; a workbook read; Excel tables read from the file; the 1904 date system; the size limits |
| `apps/web` `sheetExport.test.ts`, `sheetWorkbookWrite.test.ts`, `SheetExportDialog.test.tsx` | What an export writes, the `_xlfn.` prefixes, the file's bytes read back, the dialog |
| `apps/web` `sheetDraft.test.ts`, `sheetSrc.test.ts`, `SheetGrid.test.tsx`, `SheetDialog.test.tsx`, `SheetImportDialog.test.tsx` | The grid's rows and columns and the clipboard, finding and rewriting a sheet in a note, and the three dialogs |
| `apps/desktop` `src/tools/sheetManualFixture.test.ts` | This test's own fixture: each sample workbook through the real import (the counts above), and the notes it makes through the real sheet code |
| `apps/desktop` `pnpm smoke` | The save bridge: the file the page hands the app is written where the dialog says, with the extension of its type |
