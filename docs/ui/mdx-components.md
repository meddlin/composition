# MDX components in notes

Source: [`NoteMarkdown.tsx`](../../apps/web/src/components/notes/NoteMarkdown.tsx),
[`mdx/`](../../apps/web/src/components/notes/mdx/) (web and desktop);
[`mdx.ts`](../../apps/cli/src/mdx.ts), [`Preview.tsx`](../../apps/cli/src/components/Preview.tsx) (CLI)

Notes stay `.md` files, but the preview also renders a small set of components (`<Info>`, `<Warning>`, `<Image>`, `<Drawio>`, `<Ink>`, `<Toc>`, `<Mark>`, `<Footnotes>`, `<YouTube>`, `<Repo>`, `<Chart>`) written as
JSX tags. They work the same in the web and desktop apps, since both run the same renderer, and the
CLI draws them in the terminal too (see [In the CLI](#in-the-cli)). Writing them is the same
everywhere.

## `<Info>`

An info panel, like Confluence's: a tinted callout with an icon. Put the tags on their own
lines, with blank lines around the content, and Markdown inside renders normally:

```mdx
<Info>

Staging resets **nightly**. See the [runbook](https://example.com).

- back up first
- then deploy

</Info>
```

It takes no props. Its colors come from the active theme's `--primary`.

## `<Warning>`

A warning panel, like Confluence's: the same layout as `<Info>`, but gold with a triangle
icon, for something a reader should be careful about. It is written the same way:

```mdx
<Warning>

This **deletes** every note in the group.

</Warning>
```

Its colors come from the active theme's `--warning`.

## `<Image>`

An image, as a tag instead of Markdown's `![alt](src)`. Both render the same way, and pasting an
image into the editor inserts the Markdown form:

```mdx
<Image src="app_data/trip-plan-route-map-3f9c2a71b0de.png" alt="Route map" />
```

`src` and `alt` are plain strings (an `{expression}` is rejected, like for any component).
See [images.md](../architecture/images.md) for where pasted images live and how `app_data/` paths resolve.

### Resizing: `width`

Markdown's `![alt](src)` has nowhere to say how big to draw an image; the tag does:

```mdx
<Image src="app_data/trip-plan-route-map-3f9c2a71b0de.png" alt="Route map" width="50%" />

<Image src="app_data/trip-plan-route-map-3f9c2a71b0de.png" alt="Route map" width="400" />
```

- `width="400"` (or `"400px"`) is pixels; `width="50%"` is a share of the note's width. The height
  follows, keeping the proportions.
- An image is never drawn wider than the note, so `width="4000"` and `width="100%"` look the same on a
  narrow pane. Over `100%` counts as `100%`.
- A width that can't be read (`width="wide"`, `0`, `-5`) is ignored and the image stays at full size,
  so a half-typed value doesn't make it vanish.
- This only changes how the picture is drawn. The file in `app_data/` is untouched and still
  downloads, backs up and loads at its full size. The terminal app ignores `width`.

Source: [`mdx/imageWidth.ts`](../../apps/web/src/components/notes/mdx/imageWidth.ts).

### Turning a pasted image into an `<Image>`

Pasting inserts Markdown, which is the right default: a note with no component in it is plain
Markdown, and a stray `<` or `{` in its prose is fine. A note that uses a component is parsed as MDX,
where those are errors. So the tag is opt-in, one image at a time:

Press **Cmd+Shift+X** (macOS) or **Ctrl+Shift+X** in the editor with the caret on a Markdown
image, or with a selection that touches one or more, and each becomes an `<Image />` tag with the
same `src`, `alt` and `title`. The caret lands at the end of the tag's last prop, so a space
opens the prop menu (below) and `width` is two keystrokes away. It goes in as typing does, so
undo takes it back in one step. If there is no image at the caret, the editor says so and changes nothing.

Code is left alone: an image inside a fenced block or a backtick span is text, not an image.
The shortcut only goes one way; to go back, retype the Markdown form. Source:
[`mdx/imageToMdx.ts`](../../apps/web/src/components/notes/mdx/imageToMdx.ts).

## `<Drawio>`

A diagram drawn in [draw.io](https://www.drawio.com/), shown in the note as a picture and opened again from it
to change. Web and desktop only; the terminal shows the picture.

```mdx
<Drawio src="app_data/trip-plan-diagram-3f9c2a71b0de.png" alt="Request flow" />

<Drawio src="app_data/trip-plan-diagram-3f9c2a71b0de.png" alt="Request flow" width="60%" />
```

- **Drawing one.** The **Diagram** button in a note's header, or **Cmd+Shift+D** (macOS) / **Ctrl+Shift+D**
  in the editor, opens the draw.io editor in a dialog. **Save diagram** stores it and puts the tag in the
  note at the caret, as a paragraph of its own (the end of the note if the caret was never placed, never in the
  frontmatter). With a selection, the diagram replaces it. Cancelling asks first if anything was drawn.
- **Changing one.** In the preview, hovering over the picture shows an **Edit diagram** button. It opens the
  editor on the stored drawing, and saving points every `<Drawio>` of that diagram in the note at the new file.
- `src`, `alt`, `title` and `width` are as for [`<Image>`](#image), and so is the editor's completion for them.
  `src` has to be a diagram stored with the notes (`app_data/…`) to be editable; one from a web address is
  just shown, with no Edit button.
- A diagram is drawn at half the pixels it is stored with (it is saved at 2x so text stays sharp), unless
  `width` says how wide.
- The file is an ordinary stored image, a PNG with the drawing inside it, so it is also on the Images page and in
  backups. How it works, and what it cannot do yet: [diagrams.md](../architecture/diagrams.md).
- The editor is vendored (`pnpm fetch:drawio` in `apps/web`; the desktop build does it) and works offline.

Source: [`mdx/Drawio.tsx`](../../apps/web/src/components/notes/mdx/Drawio.tsx),
[`DrawioDialog.tsx`](../../apps/web/src/components/notes/DrawioDialog.tsx) and
[`mdx/drawioSrc.ts`](../../apps/web/src/components/notes/mdx/drawioSrc.ts), which writes and rewrites the tag.

## `<Ink>`

A drawing made with the Pencil on the iPad, shown in the note from its strokes. View only: drawing and editing a drawing are the iPad's
(the terminal shows the picture).

```mdx
<Ink src="app_data/trip-plan-drawing-3f9c2a71b0de.png" alt="Drawing" width="80%" />
```

- **What it shows.** The drawing is a stored PNG that carries its own strokes ([ink.md](../architecture/ink.md)), and the preview and the
  [Live tab](live-editor.md) draw those strokes as an SVG made when the note is drawn, in the **colour scheme in force**: black ink is the
  scheme's text colour (white on a dark scheme), the accent is its brand colour, a `<Mark>` colour name is that hue, and a fixed colour is as chosen.
  Changing the scheme restyles a drawing already on screen. It is drawn as large as its canvas, or at `width`.
- **When it is just a picture.** A PNG with no strokes in it, or with strokes this version cannot read (a damaged chunk, or a drawing from a newer version of Composition),
  is drawn as the picture it is, at half its pixels. So is one whose `src` is a web address. A drawing whose file has gone shows "Image not found: alt".
- `src`, `alt`, `title` and `width` are as for [`<Image>`](#image), and so is the editor's completion for them.
- The file is an ordinary stored image, so it is also on the Images page and in backups. The strokes are drawn simplified: each is one smoothed outline at one opacity,
  and the textured inks (marker, pencil, watercolour, crayon) are approximated by opacity alone, so it is not PencilKit's own picture of them.

Source: [`mdx/Ink.tsx`](../../apps/web/src/components/notes/mdx/Ink.tsx) and [`liveInk.ts`](../../apps/web/src/components/notes/liveInk.ts), on the reader and renderer in
[`apps/web/src/lib/composition/`](../../apps/web/src/lib/composition) (`ink.ts`, `inkPng.ts`, `inkSvg.ts`). How the format works: [ink.md](../architecture/ink.md#desktop-and-cli).

## `<Toc>`

A table of contents for the note it is in: its headings as a nested list. It lists whatever
headings the note has when it is drawn, so it follows edits with no upkeep.

```mdx
<Toc />

<Toc maxDepth="3" />
```

`maxDepth` (a string, 1 to 6) stops the list at that heading level; without it, all six are listed.
On the web and desktop each entry links to its heading.

## `<Mark>`

Highlighted text, like a highlighter pen. It is inline, so it sits inside a sentence, and Markdown
inside it renders normally:

```mdx
Staging resets <Mark color="green">every night</Mark>, so **back up <Mark color="yellow">first</Mark>**.
```

`color` is `yellow`, `green`, `blue`, `pink` or `orange`; a missing or unknown one is yellow. The
names are the same everywhere and each color scheme tints them to suit its own background, so a
note reads in all of them. See [text-highlighting.md](text-highlighting.md) for how highlights
are made and removed.

## Footnotes

For a well-researched note with many links and references: cite a footnote with `[^label]` where it
belongs, and write its text on a line of its own anywhere in the note with `[^label]: text`.

```mdx
Staging resets nightly[^runbook], and the cron job is documented elsewhere[^cron].

[^runbook]: [Staging runbook](https://example.com/runbook), section 3.
[^cron]: See the [scheduler docs](https://example.com/cron) and the _ops_ channel.

<Footnotes />
```

- **The number is where it is cited, not the label.** Citations are numbered 1, 2, 3… in the order they
  appear in the note, whatever they are called, so a footnote added between two existing ones takes its
  place and the later ones renumber on their own. Nothing in the note's text is rewritten. Use any label
  you like (`[^1]`, `[^runbook]`); it only has to match its definition.
- **Where the list goes.** A note with footnotes lists them at the end, with a ↩ link from each back to
  where it is cited. `<Footnotes />` puts the list where the tag is instead (the last line, usually), and
  says "No footnotes yet." when there are none. It takes no props, and a second tag is left empty.
  Footnotes work in a note that uses no other component, too: they are Markdown (GFM) first, and the
  tag is for placing the list.
- **Links.** On the web and desktop, clicking a citation scrolls to its footnote and ↩ scrolls back; neither
  changes the address, and two notes open side by side never scroll each other.
- A citation with no definition stays as typed (`[^x]`), and a definition nobody cites is not listed.

Source: [`mdx/Footnotes.tsx`](../../apps/web/src/components/notes/mdx/Footnotes.tsx) and
[`mdx/rehypeFootnotes.ts`](../../apps/web/src/components/notes/mdx/rehypeFootnotes.ts), which moves the list to the tag.

## `<YouTube>`

A YouTube video you can watch in the preview, without leaving the note:

```mdx
<YouTube url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />

<YouTube url="https://youtu.be/dQw4w9WgXcQ?t=90" title="Demo of the release" />

<YouTube url="dQw4w9WgXcQ" start="1:30" />
```

- `url` is whatever you'd copy from YouTube: a watch link, a `youtu.be` link, an embed, shorts or live
  link, or just the 11-character video id.
- `start` begins playback part-way in: seconds (`90`), `1:30`, `1:02:03` or `1m30s`. It wins over a
  start time in the link (`?t=90`), which is used otherwise. One that can't be read plays from the start.
- `title` names the player for screen readers; it defaults to "YouTube video".
- The player is YouTube's privacy-enhanced one (`youtube-nocookie.com`), which sets no cookies until
  you press play, and is drawn full width at 16:9. Only the video id is read from `url`; the frame's
  address is built from it, so a note can't point the player anywhere but a YouTube video.
- A `url` that isn't a YouTube video (or isn't there yet, while typing) shows a short notice in place of
  the player, so the rest of the note stays put. A playlist or channel link has no single video, so it is the same.
- It needs the network to play. In the desktop app, the CSP's `frame-src` allows exactly that one
  host, and [`embedReferer.ts`](../../apps/desktop/src/main/embedReferer.ts) gives the player a
  referrer, since YouTube refuses to play for a page that sends none (the app's own `app://` pages
  never do).
- The terminal can't play video, so it shows a link to the video, `▶ title`, in its place.

Source: [`mdx/YouTube.tsx`](../../apps/web/src/components/notes/mdx/YouTube.tsx) and
[`mdx/youtubeRef.ts`](../../apps/web/src/components/notes/mdx/youtubeRef.ts), which reads the link
(and is shared with the terminal app).

## `<Repo>`

A git repository as a small card that opens it, instead of a bare URL:

```mdx
<Repo url="https://github.com/meddlin/composition" />

<Repo url="https://gitlab.com/gitlab-org/gitlab" description="The DevSecOps platform" />

<Repo url="git@git.example.com:team/tool.git" />
```

- `url` is whatever you'd copy: the repository's page (a link into it, like `…/tree/main/docs`, is
  cut back to the repository), a clone address (`…/repo.git`, `git@host:owner/repo.git`,
  `ssh://…`), with or without `https://`.
- `description` says what the repository is for; it is shown under the name.
- The card shows `owner/name`, with the host under it (named, for GitHub, GitLab, Bitbucket,
  Codeberg and SourceHut), and opens the repository in the browser. GitLab's nested groups
  (`group/subgroup/repo`) are kept whole. Any other host works too, when its addresses look like
  `host/owner/repo`.
- Nothing is fetched. The card is drawn from the address alone, so it works offline, makes no
  request on its own and shows no stars or language; `description` is where to say what it is.
- The link is built from the host and path that were read (`https://host/owner/name`), never taken
  as written, so a login, a query string or a script address in `url` is dropped.
- A `url` that isn't a repository (or isn't there yet, while typing) shows a short notice in place of
  the card.
- The terminal shows a link to it, `⎇ owner/name`, with the description after it.

Source: [`mdx/Repo.tsx`](../../apps/web/src/components/notes/mdx/Repo.tsx) and
[`mdx/repoRef.ts`](../../apps/web/src/components/notes/mdx/repoRef.ts), which reads the address
(and is shared with the terminal app).

## `<Chart>`

A bar, line, area or pie chart of a table, with the table written inside the tag as a CSV block:

````mdx
<Chart type="line" x="month" y="sales,costs" title="2026">

```csv
month,sales,costs
Jan,10,7
Feb,12,8
Mar,9,9
```

</Chart>
````

- **Blank lines around the fence.** As for `<Info>`, the tags go on lines of their own with blank lines
  around the content; that is what makes the fence a code block. The data is CSV because a tag's props
  are plain strings (see [How it renders](#how-it-renders)), and a fenced block is the one place a note
  can hold a table of numbers that Markdown won't rewrap.
- **The table.** The first row names the columns. Cells can be quoted (`"Smith, J"`, with `""` for a
  quote). Numbers can be plain, `1,234` or `12%` (read as 12). A cell that isn't a number is a gap in its
  series, not an error. Up to 500 rows are drawn.
- `type` is `bar` (the default), `line`, `area` or `pie`; one that isn't any of them is a bar chart.
- `x` is the column for the labels (the first by default). `y` is the column or columns to draw,
  comma-separated (every other column that holds numbers by default). A pie draws only the first, with
  `x` naming its slices.
- `title` captions the chart. `height` is in pixels (280 by default, kept between 120 and 800).
- Colors are the active theme's own (`--primary`, `--success`, `--warning`, `--destructive`), so a chart
  matches the note it is in and reads in every scheme. It is a figure with a text label saying what it
  charts, for screen readers.
- A table that can't be drawn (no rows, a column that isn't there, no column of numbers) shows a short
  notice in place of the chart, saying which, so the rest of the note stays put.
- The terminal draws a horizontal bar of text for every value, whatever the type (a line's shape is lost,
  its numbers are not), with a pie's share of the whole after each slice.

Source: [`mdx/Chart.tsx`](../../apps/web/src/components/notes/mdx/Chart.tsx), a thin wrapper over
[Recharts](https://recharts.org/), and [`mdx/chartData.ts`](../../apps/web/src/components/notes/mdx/chartData.ts),
which reads the CSV and the props (and is shared with the terminal app, whose drawing is
[`chartText.ts`](../../apps/cli/src/chartText.ts)). A note never reaches Recharts' own API: swapping
the library means rewriting `Chart.tsx` only.

## `<Sheet>`

A grid of a table, drawn like a spreadsheet, with the table written inside the tag as a CSV block, as for
[`<Chart>`](#chart):

````mdx
<Sheet title="Q3 budget">

```csv
Region,Units,Price,Revenue
West,120,9.5,1140
East,80,9.5,760
```

</Sheet>
````

This is the first part of [spreadsheets in notes](../sheet-component-plan.md): the data is a CSV block in the note,
which is Markdown text like the rest of it, and a `formulas` block beside it can calculate some of the cells
([below](#formulas-in-a-sheet)). It can be [edited in a grid](#editing-a-sheet); importing from Excel is the step after,
and is not built yet.

- **Blank lines around the fence**, as for `<Chart>`, which is what makes it a code block and keeps Markdown from
  rewrapping it.
- **Drawn like a spreadsheet.** Excel's column letters (A, B, … AA) sit over the header row, row numbers run down the
  side, numbers are flush right, and the header and the row numbers stay in view as it scrolls. The header is
  **row 1** and the first row below it is row 2, as in Excel, because formulas will be written against those addresses.
- **The table.** The first row names the columns. Cells can be quoted (`"Smith, J"`, with `""` for a quote, and a quoted
  cell can hold a line break) and are trimmed. A row shorter than the widest is padded with empty cells. **A blank row
  (`,,`) is a row**, so a row's number is its place in the text; blank lines before the header and after the last row are
  dropped. A header with nothing below it is a sheet, an empty one to start typing in.
- **Errors.** A cell holding one of Excel's errors (`#DIV/0!`, `#N/A`, `#NAME?`, `#NULL!`, `#NUM!`, `#REF!`,
  `#VALUE!`) is shown in the error colour.
- `title` captions it. `height` is how tall it may grow, in pixels (360 by default, kept between 120 and 800), after
  which it scrolls. A column is as wide as its longest cell, between 4 and 40 characters; a longer cell is cut, and
  hovering shows all of it.
- **A long sheet** of up to 100 rows below the header is drawn whole, so the preview's find-in-note can search it.
  A longer one draws only the rows in view, so its size is not what it costs (drawing 5,000 rows of 20 columns whole
  took about 400 ms; the window about 4 ms), and find-in-note sees only the rows drawn.
- **A big sheet is said so.** Past 100,000 characters the editor stops colouring the whole note, and a sheet that
  size says so under itself.
- The block tagged `csv` is read. With none, the first block is, since a fence the author forgot to tag is still
  meant. The block tagged `formulas` is read as formulas, and only if it is tagged (no stand-in).
- A table that can't be drawn (no data) shows a short notice in place of the grid, saying so, so the rest of the note
  stays put.
- Colours are the active theme's own, so a sheet reads in every scheme. It is a table with a label saying how big it is,
  and its scrolling area can be reached with the keyboard.
- The terminal draws the cells as aligned text, with the letters and row numbers (see [In the CLI](#in-the-cli)).

### Formulas in a sheet

A second block, tagged `formulas`, gives a cell a formula, a line to a cell, in Excel's own syntax:

````mdx
<Sheet title="Q3 budget">

```csv
Region,Units,Price,Revenue
West,120,9.5,
East,80,9.5,
Total,,,
```

```formulas
D2 =B2*C2
D3 =B3*C3
B4 =SUM(B2:B3)
D4 =SUM(D2:D3)
```

</Sheet>
````

The CSV block holds what each cell shows; the `formulas` block holds the formula that makes some of them, which is
calculated again each time the sheet is drawn, so the numbers in the CSV are not trusted over the formula. The same
formulas will work in Excel: the syntax is Excel's, and each rule below was read off real Excel.

- **A line is a cell and a formula**, `E2 =C2*D2`: the address in Excel's form (the header is row 1), a space, and the
  formula starting with `=`. A later line for the same cell wins. A line that is not one is said so under the sheet
  (by its number) and the rest are used.
- **A formula can use any cell**, one that is a formula too, in any order, and a range (`B2:B9`, a whole column `B:B`,
  `$B$2`). A formula under the last CSV row, or right of the last column, adds that row or column to the grid (a
  totals row made only of formulas has no row in the CSV), up to 5,000 rows and 100 columns.
- **Pointing at a formula cell shows its formula**, and what it could not calculate.
- **A date written in a cell is a date.** `2026-03-04` (the month and day may have one digit) is read as that day, the number
  of days since 1900, as Excel reads a date typed in: `A2+30`, `YEAR(A2)`, `A2=DATE(2026,3,4)` and `COUNTIF(r,">=2026-03-04")`
  work, and so does the text `"2026-03-04"+1`. A day the month does not have (`2026-02-30`) or a year before 1900 is text, as
  in Excel. Another way of writing a date (`1/2/2026`, `4-Mar-2026`) is still not read, and says so. A formula that gives a
  date shows the number of days, since a sheet has no cell formats: write `TEXT(A2+30,"yyyy-mm-dd")` to show one.
- **Excel 365's rules:** arrays work everywhere (`SUM(B1:B5*2)`, `SUMPRODUCT((A2:A9="West")*(C2:C9))`,
  `COUNTIF(A2:A9,A2:A9)`), text is compared without regard to case, a number and a text that looks like one are
  different things (as in a lookup) except where Excel reads one as the other (arithmetic, `COUNTIF`), `0.1+0.2-0.3` is
  0 where it is the last step of a formula, and a number is shown to 15 digits.
- **What it calculates** (94 functions, the table is [`sheetFunctions.ts`](../../apps/web/src/components/notes/mdx/sheetFunctions.ts)):
  - *Sums and counts:* `SUM` `PRODUCT` `SUMPRODUCT` `AVERAGE` `MIN` `MAX` `COUNT` `COUNTA` `COUNTBLANK` `LARGE` `SMALL` `MEDIAN` `RANK`
  - *By a condition:* `SUMIF` `SUMIFS` `COUNTIF` `COUNTIFS` `AVERAGEIF` `AVERAGEIFS` `MAXIFS` `MINIFS`, with Excel's criteria
    (`">=5"`, `"<>West"`, `"A*"`, `"?pple"`, `"a~*b"`)
  - *Lookups:* `VLOOKUP` `HLOOKUP` `INDEX` `MATCH` `XLOOKUP` `CHOOSE` `ROW` `COLUMN` `ROWS` `COLUMNS`
  - *Numbers:* `ROUND` `ROUNDUP` `ROUNDDOWN` `TRUNC` `INT` `ABS` `SIGN` `MOD` `POWER` `SQRT` `CEILING` `FLOOR` `EXP` `LN` `LOG` `LOG10` `PI`
  - *Logic:* `IF` `IFS` `IFERROR` `IFNA` `SWITCH` `AND` `OR` `NOT` `TRUE` `FALSE` `NA`, and the tests `ISBLANK` `ISNUMBER`
    `ISTEXT` `ISLOGICAL` `ISERROR` `ISERR` `ISNA` `ERROR.TYPE`
  - *Text:* `LEN` `LEFT` `RIGHT` `MID` `UPPER` `LOWER` `PROPER` `TRIM` `SUBSTITUTE` `FIND` `SEARCH` `EXACT` `REPT` `CONCAT`
    `CONCATENATE` `TEXTJOIN` `VALUE` `TEXT` `CHAR` `CODE`; `TEXT` knows the digit formats (`0.00`, `#,##0`, `0%`,
    `$0.00`, `;` sections) and the date letters (`yyyy-mm-dd`, `mmm d, yyyy`, `dddd`)
  - *Dates* (as numbers: Excel's days from 1900, with its 29 February 1900): `DATE` `YEAR` `MONTH` `DAY` `EOMONTH` `EDATE` `WEEKDAY`
- **What it does not calculate says so, and is not guessed.** A function not in the list (`FILTER`, `LET`, `TODAY`,
  `NETWORKDAYS`…), another sheet (`Sheet2!A1`), a name, a text Excel would read as a date
  (`"1/2/2026"+1`), a `TEXT` format with a time, a fraction or E notation, `XLOOKUP` by binary search, a formula that
  refers to itself, or one that fills several cells makes the cell **`#NAME?`**, and pointing at it says why. So does
  every cell that depends on it. A formula that came from Excel and does this is [carried](#carried-formulas) instead.
- **A formula is limited as in Excel:** 8,192 characters, 64 levels of nesting.

The engine is pure TypeScript with no `eval` (the desktop app forbids it) and no library: [`sheetFormula.ts`](../../apps/web/src/components/notes/mdx/sheetFormula.ts)
calculates, [`sheetParse.ts`](../../apps/web/src/components/notes/mdx/sheetParse.ts) reads the syntax,
[`sheetCriteria.ts`](../../apps/web/src/components/notes/mdx/sheetCriteria.ts) matches criteria, and so on. It is tested against
real Excel: [`excel-verified-cases.json`](../../spikes/sheet/excel-verified-cases.json) holds more than 1,200 formulas with the
result Excel gave each, and `node spikes/sheet/run-in-excel.mjs` runs new ones in Excel on a Mac and records them.

### Column names in formulas

The header row of a sheet is its table, as in Excel, so a formula can say a column by its name:

````mdx
<Sheet totals>

```csv
Region,Units,Unit Price,Revenue
West,120,9.5,
East,80,9.5,
Total,,,
```

```formulas
D2 =[@Units]*[@[Unit Price]]
D3 =[@Units]*[@[Unit Price]]
B4 =SUM([Units])
D4 =SUM([Revenue])
```

</Sheet>
````

- **What is read** (Excel's own grammar for a table): `[Revenue]` (the data of a column), `[@Units]` and `[@[Unit Price]]` (this row's cell), `[@]` (this row), `[[#This Row],[Units]]` (the same),
  `[[Region]:[Revenue]]` (columns from one to another), `[#Headers]`, `[#Data]`, `[#Totals]`, `[#All]`, and `[[#Headers],[Revenue]]`, `[[#Data],[Revenue]]`, `[[#Headers],[#Data]]`, `[[#Data],[#Totals]]`. A column
  name with `[`, `]`, `#` or `'` in it is written with a `'` before the character, as in Excel. Names are matched without regard to case.
- **The table is the sheet**: the header row, and the rows of the CSV below it. A formula in a row under the last CSV row (the grid grows to hold it) is not one of the data, so `=SUM([Revenue])` there is safe.
- **A total inside the CSV needs `totals`.** Say `<Sheet totals>` (or tick **Last row is a totals row** in the grid editor, which writes `totals="true"`) and the last row is the table's Total Row: not data, so `=SUM([Units])`
  in it reads the rows above it. Without it that formula would read its own cell, and the sheet says so. `[#Totals]` is that row, and `[@Units]` in it is `#VALUE!`, as in Excel.
- **A column the sheet has not** is `#REF!` where it is written (so `IFERROR([Nope],0)` is 0); **`@` in a row that is not one of the data** is `#VALUE!`; what Excel's grammar has no such form for (`[[#Headers],[#Totals]]`, two columns that are not a range) is `#NAME?`,
  and pointing at the cell says why. **A table's name** (`Table1[Revenue]`) is not read in a sheet, which is one table with no name: write `[Revenue]`.
- **They keep working when rows and columns come and go**, since they say which column and not where it is. **Renaming a header renames the column in the formulas that use it**, as Excel does: typing over a header in the grid (or pasting over it) turns `[@Units]` into `[@Qty]` and `SUM([Units])` into `SUM([Qty])`, writing the new name with brackets of its own where Excel does (`[@[Unit Price]]`). A header that is cleared or typed as a formula renames nothing, nor does one whose name another column repeats (the first of them is the one the formulas read), and editing the CSV text by hand is not seen as a rename.
- **On export** each is written as the range it stands for (`$D$2:$D$3`), since Excel would not know the table. **On import** the tables of the file are read, so `Table1[Revenue]` and `[@Units]` come across as formulas (see below).
- Checked in Excel itself: 38 cases over a table and a table with a totals row (`excel-verified-tables.json`) give the same here.

### Carried formulas

A formula that came from Excel, and that this engine cannot calculate or calculates differently from Excel, is **carried**: it is
written with the word `carried` before it, and the cell shows the value Excel calculated, which is in the CSV block.

````mdx
```csv
Item,Looked up,Plus one
Pens,99,100
```

```formulas
B2 carried =XLOOKUP(A2,Prices!A:A,Prices!B:B)
C2 =B2+1
```
````

- **A carried formula is not calculated.** The cell shows what the CSV holds, marked with a dot, and pointing at it shows the formula
  and says it was calculated by Excel. Our number never replaces Excel's where the two could differ.
- **What reads a carried cell reads that value**: `C2 =B2+1` above is 100, and is calculated as any formula is.
- **It is as of the import.** Change a cell a carried formula reads and its value is stale; the grid editor keeps it as it was until
  the cell is typed over, and then it is an ordinary formula (calculated, or `#NAME?` if it cannot be).
- **Why it exists.** An import must never show a number that disagrees with Excel's, and must not throw a formula away because this
  engine lacks its function; this keeps both the formula (for the export to come) and Excel's value.
- In the terminal a carried cell shows the value and is not listed as not calculated.

### Pasting from Excel

A range copied from Excel (or any spreadsheet) arrives in the editor as the tab-separated text it always did. When the text is a
range, cells split by tabs with the same number in every row, or a copy whose HTML says Excel made it, a line under the editor's top
edge says so and offers **Make it a sheet**: it opens the grid editor on the cells, and saving replaces the pasted text with the
sheet. **Keep as text** drops the offer, and so does the next change to the note. Text indented with tabs, a paste into a code block
and anything with no tabs is not offered. A sheet pasted this way has no formulas: Excel puts only the values on the clipboard.

### Importing from Excel

The **Excel** button in the note's toolbar (**Import from Excel**) takes a workbook, an `.xlsx` or `.xlsm` file chosen with the browser's own file
picker (the page gets its bytes, never a path, and nothing is sent anywhere), asks which sheet and which range of it (the used range is filled in; a
range is read when its box is left or Enter is pressed), says what would come across, and **Insert sheet** puts it in the note at the caret.

- **A cell comes across as what Excel showed**: a number as it is (to the 15 digits Excel keeps), a date as `2026-03-04`, a text, a logical, an error. A
  date with a time, and a time, keep Excel's own text. The range's first row is the header, row 1.
- **A formula comes across only where it can be trusted** (S5), each checked against the value Excel saved for it, on its own, with the cells it
  reads as Excel had them:
  - **kept as a formula**, calculated here, when every cell it reads is inside the range, every function in it is one this engine has, and the number it
    gives is Excel's to 15 digits;
  - **[carried](#carried-formulas)** when its function is not one this engine has (`FILTER`, `LET`…), or the result differs, or Excel shows the
    result as a date (a sheet has no cell formats, so a recalculated date would show as a number of days);
  - **kept as a value** when it reads anything outside the range: another sheet or workbook, a cell above or left of it or beyond it, a column of a table that the range does not
    hold, a table on another sheet, or a defined name (a name that a `LET` or `LAMBDA` gives is the formula's own, not a defined name). Whole columns and rows inside the range's columns and rows are inside. **A table's columns are read from the file**
    (`Table1[Revenue]`, `[@Units]`, `Table1[[#This Row],[Units]]` become ranges of that table, with its totals row left out of the data), so they stay formulas when the range holds the table.
- **The dialog says all of it first**: the size, how many formulas there are, and how many of each kind, with the reasons ("1 is carried … Why: the
  function FILTER (1)").
- **Limits.** A range of more than 5,001 rows (the header included) or 100 columns, or one whose first row is empty, is refused with the reason; a file over
  50 MB is not read; only the first 100,000 rows of a sheet are read. Empty rows at the foot and empty columns at the right are left off.
- **What is lost, and said so here:** cell formats (a percent or a currency is the raw number), merged cells, a text's leading and trailing spaces (the CSV
  trims), and the difference between a number and a text that looks like one (the CSV has no types: a `"123"` Excel keeps as text is read back as a
  number, which the check against Excel's values catches wherever a formula reads it).
- **The sheet remembers where it came from** (below), for a later re-import and export.

### Re-importing

Point at a sheet that came from Excel (one with `source`, `sheet` and `range`) and press **Re-import**: it opens the import dialog on the same
workbook's sheet and range, and **replaces the sheet** with what the file holds now, so a workbook you keep editing in Excel can be brought up to
date. The tag keeps its `title` and other attributes; `source`, `sheet`, `range` and `imported` are set to what was just read, and the blocks are
replaced as one change, so one undo takes it back.

- **The file is asked for again**, since the page keeps no path (see above). The dialog says which file, sheet and range it replaces, and says so if
  the file chosen has another name ("This is other.xlsx, and the sheet came from budget.xlsx") or has no such sheet (the first is shown).
- **Changes are not overwritten without asking.** If the two blocks no longer match the fingerprint, which is to say the sheet was edited after
  the import, the dialog opens with a warning ("This sheet has been changed since it was imported…") and its button reads **Replace my changes**
  instead of **Replace sheet**. A sheet with no fingerprint (written by hand) is treated as changed.
- A sheet is replaced whole: nothing is merged, so formulas typed in it, rows added to it and carried formulas it had are gone, and what the
  workbook has takes their place (undo brings them back).

### Exporting

**Export…**, on any sheet when it is pointed at, saves it as a file or copies it:

- **An Excel workbook (`.xlsx`) with its formulas.** Each formula is written as a formula **with the value it shows beside it**, as Excel itself
  saves one, and Excel calculates it again when it opens the file. A function newer than Excel 2007 is written the way the file holds it
  (`_xlfn.XLOOKUP`, `_xlfn.IFS`, and `_xlfn._xlws.FILTER`), which Excel needs: without the prefix it shows `#NAME?`. A date written `2026-03-04` is
  written as a date, with that format. A [carried](#carried-formulas) formula is written as it came, with Excel's value, so what this engine
  could not calculate survives a round trip through Excel. A formula this engine cannot calculate that was typed here is written as a formula with
  `#NAME?` for its value, and Excel calculates it on opening. The sheet is named for its caption (Excel's limits apply: 31 characters, none of `[]:*?/\`).
- **CSV (`.csv`)**: the values the sheet shows, formulas calculated, in UTF-8 with the byte order mark Excel needs.
- **Copy cells**: the shown values with tabs between them, which Excel takes as cells when pasted.
- **Not kept**, and the dialog says so: cell formats (a percent or a currency is the plain number), colours, fonts, column widths set by hand (columns
  are sized to their content), and a formula that gave a date shows the number of days, since a sheet has no cell formats.
- **Where the file goes.** In a browser the file is a normal download. The desktop app blocks every download, so there the page hands the file
  (its bytes, a suggested name and whether it is `.xlsx` or `.csv`) to the app through `saveFile`, and the app opens the system's **save dialog**
  with that name; the Export window says **Saved.** when it is written and says nothing when you dismiss the save dialog. The page never names a place: only the dialog does, the
  app writes the file there only after you have chosen, and a failure (a full disk, a folder it cannot write to) says why. The name is only a
  suggestion: the app removes any folder from it, and the file always ends in the extension for its type.
- **A `LET` or `LAMBDA`** is written the way Excel saves one: `_xlfn.LET(_xlpm.x,5,_xlpm.x*2)`, with `_xlpm.` before each name it gives, where it is given and where it is used (and read back the same way on import). Without them Excel can refuse to open the file. This follows [XlsxWriter's notes](https://xlsxwriter.readthedocs.io/working_with_formulas.html); it has **not** been opened in Excel here (see the manual test).
- Checked in Excel itself: a workbook made this way (28 formulas, `SUMIFS` `XLOOKUP` `IFS` `TEXTJOIN` `MAXIFS` `EDATE` `INDEX`/`MATCH` `TEXT` `IFERROR`
  `IFNA` and more) opened with no repair prompt and no Protected View, Excel calculated it again, and **all 68 cells came to what this engine had calculated**.

### Where a sheet came from

An imported sheet says so with `source` (the file's name), `sheet` and `range` (`A1:F40`), drawn as a line under it ("Imported from
budget.xlsx, sheet Q3, A1:F40") and in the terminal; and `imported`, a fingerprint of the two blocks as the import wrote them
(the first 12 hex digits of their SHA-256), which is not drawn and is how a re-import tells the sheet has been changed. Editing the sheet in
the grid and saving without changing anything writes the same text, so the fingerprint stays true.

### Editing a sheet

A sheet is changed in a grid, in a dialog, and the note's text is rewritten when you **Save sheet**. There is no need to
touch the CSV by hand, though you can.

- **Opening it.** Point at a sheet in the preview and press **Edit sheet** (the button shows on hover and on focus), or put
  the caret in a sheet and press **Ctrl/Cmd+Shift+G**, or press the **Sheet** button in the note's toolbar. With the caret
  in a **Markdown table** the same key turns the table into a sheet (the cells become the grid, and saving replaces the
  table); anywhere else it starts a new sheet, at the caret (after the frontmatter, and without replacing a selection).
- **In the grid.** It works as a spreadsheet does. Arrow keys move (with Ctrl/Cmd to the edge, Shift to select a
  range); **Tab** and **Shift+Tab** move right and left, wrapping to the next row, and past the first or last cell they go on to
  the next control; **Enter** moves down (Shift+Enter up). Typing a character **replaces** a cell, **F2** or a double click
  **edits** it, **Enter**, **Tab** or a click elsewhere keeps what was typed and **Escape** drops it. After Tab-ing along a row,
  Enter goes back to the column the row began in, and Enter after typing in the last row starts a new one. **Delete** clears
  the selected cells; the column letters and row numbers select a whole column or row.
- **Formulas.** A cell that starts with `=` is a formula. It shows its result once you leave it, and every formula that reads
  it is calculated again; the line above the grid shows the address of the active cell and what is in it (and what could
  not be calculated). A formula the engine cannot calculate is `#NAME?` in the cell, as it is in the preview. A text that
  really begins with `=` is typed with a leading apostrophe (`'=not a formula`), as in Excel; the apostrophe is not part of it.
- **Rows and columns** go in above or below (left or right) of the selection, as many as are selected, and come out the
  same way. Formulas follow as they do in Excel: a reference to a cell below a new row moves down with it, a range with a
  row put inside it grows (one with a row put just below does not), a range loses a deleted row, and a formula that read a
  deleted cell shows `#REF!`. The last row or column left is emptied, not removed. A sheet holds at most 5,001 rows
  (the header included) and 100 columns.
- **The clipboard.** **Copy** puts the selection on the clipboard as Excel does (a tab between cells, a line break between
  rows, each cell as it is shown), and **Cut** clears it after. **Paste** lays a range copied from Excel down from the
  selected cell, growing the grid to hold it (what would pass the size limit is left off, and the dialog says so); one
  pasted value fills every selected cell.
- **Undo and redo** (Ctrl/Cmd+Z, +Shift+Z, or the buttons) take back each change made in the grid, up to 100 steps. **Ctrl/Cmd+S**
  saves, also in the middle of a cell. **Cancel** after changes asks before it throws them away.
- **What is saved.** The CSV block holds each cell's value, a formula's result included (which is what search, the assistant,
  `<Chart>` and the terminal read), and the `formulas` block holds the formulas, in order down the rows; a sheet with
  none has no `formulas` block. The empty rows at the foot and the empty columns at the right are left off. **Row 1 is the
  header and cannot be empty** while other rows are not (the CSV reader would take it for nothing and every address below
  would move up), so Save says so instead. The tag's attributes (`title`, `height`) and everything else around the blocks
  are left as they were, a fence is made longer when a cell holds backticks, and the whole change goes in as one edit,
  so one undo takes it back (where the editor can't be typed into, as when only the preview shows, the note's undo history
  starts over, as after a pasted image).
- **If the note changed** while the dialog was open (it is modal, so only a sync can), the sheet is found again by its text;
  where it is not there any more the save is refused and the note says so.

Not in the grid yet: dragging to fill, copying a formula to another cell with its references moved, pointing at a cell to put
its address into a formula, column widths you set, sorting and filtering, cell formats, and finding text in the grid.

Source: [`mdx/Sheet.tsx`](../../apps/web/src/components/notes/mdx/Sheet.tsx) and
[`mdx/sheetData.ts`](../../apps/web/src/components/notes/mdx/sheetData.ts), which reads the CSV and the `formulas` block (and is
shared with the terminal app, whose drawing is [`sheetText.ts`](../../apps/cli/src/sheetText.ts)). The CSV reader is `parseCsv` in
[`chartData.ts`](../../apps/web/src/components/notes/mdx/chartData.ts), with an option that keeps blank rows. The editor is
[`SheetDialog.tsx`](../../apps/web/src/components/notes/SheetDialog.tsx) around [`SheetGrid.tsx`](../../apps/web/src/components/notes/SheetGrid.tsx);
what it does to the note's text is in [`mdx/sheetSrc.ts`](../../apps/web/src/components/notes/mdx/sheetSrc.ts) (find a sheet, rewrite its
blocks, read a Markdown table), the grid as typed text is [`mdx/sheetDraft.ts`](../../apps/web/src/components/notes/mdx/sheetDraft.ts)
(rows and columns, the clipboard, the two blocks in and out), and the rule for what a new row does to a formula is
[`mdx/sheetRefs.ts`](../../apps/web/src/components/notes/mdx/sheetRefs.ts). All of it but the dialog and the grid is pure.

## How it renders

- **Only notes that use a component are parsed as MDX.** Every other note is plain
  Markdown, so a stray `<` or `{` in prose is still fine (MDX rejects both).
- **Indented code is still code.** MDX switches that Markdown syntax off, so the preview turns it
  back on after `remark-mdx` ([`remarkIndentedCode`](../../apps/web/src/components/notes/mdx/remarkIndentedCode.ts),
  also used by the terminal app). HTML and autolinks stay off.
- **Nothing is evaluated.** The preview parses with `remark-mdx` and renders through
  react-markdown, rather than compiling the note to JavaScript with `@mdx-js/mdx`. The
  desktop CSP has no `unsafe-eval`, and a note shouldn't be able to run code anyway.
  So `{expressions}`, `prop={value}`, `import`/`export`, fragments and any tag that isn't in
  the allowlist are rejected.
- **Invalid MDX never blanks the preview.** A note is invalid MDX while a tag is half-typed,
  so the preview shows what is wrong (with its position when MDX reports one) above a plain
  Markdown render of the note, and recovers as soon as the note is valid.

In `next dev`, React also logs that failure and Next shows its "Issue" badge. Production
builds don't.

## In the CLI

The preview in the terminal accepts exactly what the web preview accepts, with the same error
messages, because it parses with the same plugins (`remark-mdx`, then the web's
[`remarkRestrictMdx`](../../apps/web/src/components/notes/mdx/remarkRestrictMdx.ts) and
[`remarkHeadings`](../../apps/web/src/components/notes/mdx/remarkHeadings.ts), imported through
[`backend.ts`](../../apps/cli/src/backend.ts)). What differs is how a component is drawn:

| Component | In the terminal |
|---|---|
| `<Info>` | A rounded box in the color scheme's primary color, titled `Info`, with a tinted background, and the content rendered as Markdown inside. |
| `<Warning>` | The same, in the scheme's warning color, titled `Warning`. |
| `<Toc>` | A box titled `Contents` listing the headings, indented by nesting and cut off at `maxDepth`. It isn't clickable, and follows the note as it is edited. |
| `<Mark>` | Its text, without the tags. The terminal draws a stretch of Markdown as one piece, so it has no way to tint a few words of it yet. |
| `<Footnotes>`, and the list at the end of a note without it | A box titled `Footnotes`, one numbered line per footnote; a link keeps its address in brackets after its words. Citations in the text are superscript digits (`¹`), since `[1]` would be read as a link. The definitions are not left where they were written. |
| `<YouTube>` | A link to the video on youtube.com, `▶ title`, since a terminal can't play it. A `url` that isn't a YouTube video is said so in words. |
| `<Repo>` | A link to the repository, `⎇ owner/name`, with the description after it. A `url` that isn't a repository is said so in words. |
| `<Chart>` | A code block of bars made of block characters, one per value, under the title in bold. Its formulas are calculated, and a cell that could not be is listed under the block ("Not calculated: B2 (the function FILTER)"), since a terminal cannot be pointed at a cell. A table that can't be drawn is said so in words. Inside a sentence or a list item it is left out. |
| `<Sheet>` | A code block of the cells, with Excel's column letters and the row numbers, under the title in bold; a column that holds only numbers is flush right, and a cell is cut at 24 characters. A sheet over 50 rows below the header shows the first 50 and says how many it left out. Its formulas are calculated, and a cell that could not be is listed under the block ("Not calculated: B2 (the function FILTER)"), since a terminal cannot be pointed at a cell. A table that can't be drawn is said so in words. Inside a sentence or a list item it is left out. |
| `<Image>` | The picture, when `src` is an image stored with the notes (`app_data/…`): see [images.md](../architecture/images.md#in-the-cli). Any other `src` is the same as `![alt](src)`, which shows as its alt text. Nothing without a `src`. |
| `<Drawio>` | The same as `<Image>`: the diagram's picture, which is a PNG. The terminal has no editor, so it cannot change one. |
| `<Ink>` | The same as `<Image>`: the drawing's picture, which is a PNG (in the colours of the scheme it was drawn in; the terminal draws no strokes). The terminal cannot draw or change one. |

A few things follow from the terminal drawing Markdown in whole pieces:

- A component can be nested in another (an `<Info>` in an `<Info>`), and a one-line
  `<Info>text</Info>` is a box too.
- Inside a sentence, a list item or a quote, a component can't be a box. An `<Image>` still becomes its
  Markdown form, shown as its alt text, an `<Info>` or `<Warning>` keeps its content without the box, a `<Mark>` is always just its content, and a `<Toc>` is left out.
- The position in an MDX error counts from the first line below the frontmatter, as on the web.
- The editor's completion (below) is web and desktop only.

Every other Markdown stretch in a note is still drawn by OpenTUI's own `<markdown>`, from the note's
own text, so a note without components renders exactly as it did before this existed: it isn't even
parsed as MDX.

## Completion in the editor

**Components.** Typing `<` in the editor opens a menu at the caret listing the components, like an
IDE's completion. Keep typing to narrow it (`<wa` leaves `<Warning>`), then pick with
ArrowUp/ArrowDown and Enter or Tab, or with the mouse; Escape dismisses it until the next `<`. Picking
one inserts a ready-to-fill tag and puts the caret where you'd type next (between the blank lines of a
callout, inside `src=""` for an image).

`<Ink>` is not in the menu: a drawing is made on the iPad and only shown here, and the iPad's catalogue has none either (the two are compared by the conformance suite, so `Ink` would be added to both together).

**Props.** Inside a component's open tag, a space opens a menu of the props the tag doesn't have
yet, each with a one-line description. Typing narrows it (`<Image wi` leaves `width`). Picking
one writes `width=""` with the caret between the quotes, and that opens the next menu: the values
worth trying for that prop.

| Component | Prop | Values offered |
|---|---|---|
| `<Image>`, `<Drawio>` | `src`, `alt`, `title` | none (free text) |
| `<Image>`, `<Drawio>` | `width` | `25%` `50%` `75%` `100%` `200` `400` `600` `800` |
| `<Mark>` | `color` | the five highlight colors |
| `<Toc>` | `maxDepth` | `1` to `6` |
| `<YouTube>` | `url`, `title` | none (free text) |
| `<YouTube>` | `start` | `30` `1:00` `5:00` |
| `<Repo>` | `url`, `description` | none (free text) |
| `<Chart>` | `type` | `bar` `line` `area` `pie` |
| `<Chart>` | `height` | `200` `280` `400` `600` |
| `<Chart>` | `x`, `y`, `title` | none (free text) |
| `<Sheet>` | `title` | none (free text) |
| `<Sheet>` | `height` | `240` `360` `500` `700` |

A value menu closes when nothing matches what's typed, since `width="320"` is as good as any
preset. Picking a value replaces what was typed, closing quote included, and puts the caret past
the quote. Components that take no props (`<Info>`, `<Warning>`, `<Footnotes>`) never open a prop menu.

It stays out of the way of ordinary text: no menu for `a<b` or `<<`, inside a fenced code block, hard
against a tag's name or a closing quote, after the tag has closed, or past a blank line (MDX can't
carry a tag across one, so the editor doesn't either). A value is read as ending on its own line.
Source: [`mdx/completions.ts`](../../apps/web/src/components/notes/mdx/completions.ts) (the component catalog and
`<` trigger), [`mdx/props.ts`](../../apps/web/src/components/notes/mdx/props.ts) (the prop catalog and where the
caret is in a tag) and [`useMdxCompletion.ts`](../../apps/web/src/components/notes/useMdxCompletion.ts).

## Adding a component

1. Write it in `components/notes/mdx/`. `Info` and `Warning` are thin wrappers over `Panel`, which holds the shared layout.
2. Add it to `mdxComponents` in [`components.ts`](../../apps/web/src/components/notes/mdx/components.ts).
   That is the allowlist; the tag name in a note is the key.
3. Add its entry to `catalog` in [`completions.ts`](../../apps/web/src/components/notes/mdx/completions.ts):
   a one-line description and the template to insert (`$0` is where the caret goes). The type
   makes this a compile error to forget.
   Then add the props it takes to `catalog` in [`props.ts`](../../apps/web/src/components/notes/mdx/props.ts) (an
   empty list if none), with `values` for any worth suggesting. Also a compile error to forget.
4. For the CLI, add the name to `MDX_COMPONENTS` in [`mdx.ts`](../../apps/cli/src/mdx.ts) and say how it
   is drawn: in `elementBlocks` (and `replacement`, for where it can't be a block), plus a
   `Block` kind and its drawing in [`Preview.tsx`](../../apps/cli/src/components/Preview.tsx) if it needs
   one. The CLI's tests fail until the two lists match.
