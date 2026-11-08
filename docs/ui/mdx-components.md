# MDX components in notes

Source: [`NoteMarkdown.tsx`](../../apps/web/src/components/notes/NoteMarkdown.tsx),
[`mdx/`](../../apps/web/src/components/notes/mdx/) (web and desktop);
[`mdx.ts`](../../apps/cli/src/mdx.ts), [`Preview.tsx`](../../apps/cli/src/components/Preview.tsx) (CLI)

Notes stay `.md` files, but the preview also renders a small set of components (`<Info>`, `<Warning>`, `<Image>`, `<Drawio>`, `<Toc>`, `<Mark>`, `<Footnotes>`, `<YouTube>`, `<Repo>`, `<Chart>`, `<Sheet>`) written as
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
([below](#formulas-in-a-sheet)). It is read-only so far: editing it in a grid and importing from Excel are the steps
after, and are not built yet.

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
  `NETWORKDAYS`…), another sheet (`Sheet2!A1`), a table's `[Column]`, a name, a text Excel would read as a date
  (`"1/2/2026"+1`), a `TEXT` format with a time, a fraction or E notation, `XLOOKUP` by binary search, a formula that
  refers to itself, or one that fills several cells makes the cell **`#NAME?`**, and pointing at it says why. So does
  every cell that depends on it. (Later, an imported formula Excel calculated will keep Excel's value instead.)
- **A formula is limited as in Excel:** 8,192 characters, 64 levels of nesting.

The engine is pure TypeScript with no `eval` (the desktop app forbids it) and no library: [`sheetFormula.ts`](../../apps/web/src/components/notes/mdx/sheetFormula.ts)
calculates, [`sheetParse.ts`](../../apps/web/src/components/notes/mdx/sheetParse.ts) reads the syntax,
[`sheetCriteria.ts`](../../apps/web/src/components/notes/mdx/sheetCriteria.ts) matches criteria, and so on. It is tested against
real Excel: [`excel-verified-cases.json`](../../spikes/sheet/excel-verified-cases.json) holds more than 1,200 formulas with the
result Excel gave each, and `node spikes/sheet/run-in-excel.mjs` runs new ones in Excel on a Mac and records them.

Source: [`mdx/Sheet.tsx`](../../apps/web/src/components/notes/mdx/Sheet.tsx) and
[`mdx/sheetData.ts`](../../apps/web/src/components/notes/mdx/sheetData.ts), which reads the CSV and the `formulas` block (and is
shared with the terminal app, whose drawing is [`sheetText.ts`](../../apps/cli/src/sheetText.ts)). The CSV reader is `parseCsv` in
[`chartData.ts`](../../apps/web/src/components/notes/mdx/chartData.ts), with an option that keeps blank rows.

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
