/**
 * What a `<Chart>` draws, read from the tag's props and the CSV block inside it. Pure, so the
 * terminal app shares it with the web preview (see apps/cli/src/mdx.ts).
 *
 * The data is CSV because a note's props are plain strings (MDX `{expressions}` are never
 * evaluated), and a fenced block is the one place a note can hold a table of numbers without
 * Markdown rewrapping it:
 *
 *     <Chart type="bar">
 *
 *     ```csv
 *     month,sales
 *     Jan,10
 *     ```
 *
 *     </Chart>
 */

export const CHART_TYPES = ["bar", "line", "area", "pie"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const DEFAULT_CHART_TYPE: ChartType = "bar";

/** The most rows drawn. A bigger table is a mistake in a note (and would make the preview crawl), so it is said, not drawn. */
export const MAX_CHART_ROWS = 500;

export type ChartSpec = {
  type: ChartType;
  /** The column along the bottom (or naming the slices of a pie). */
  x: string;
  /** The columns drawn as series: bars, lines or areas. A pie draws only the first. */
  y: string[];
  /** One entry per row: the x label, then each series' number, keyed by column name. */
  rows: Record<string, string | number>[];
};

export type ChartParse = { spec: ChartSpec; error?: undefined } | { spec?: undefined; error: string };

export const isChartType = (value: unknown): value is ChartType => typeof value === "string" && (CHART_TYPES as readonly string[]).includes(value);

/**
 * CSV as rows of cells. Cells may be quoted (`"a, b"`, with `""` for a quote), a quoted cell may
 * hold a newline, and `\r\n` is a line break. Blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((value) => value.trim() !== "")) rows.push(row.map((value) => value.trim()));
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (char === ",") endCell();
    else if (char === "\n") endRow();
    else if (char === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else cell += char;
  }
  endRow();
  return rows;
}

/** A cell as a number: plain, with thousands separators, or a percentage (`12%` is 12). Nothing else is a number. */
export function parseNumber(cell: string): number | null {
  const text = cell.trim().replace(/%$/, "");
  if (!/^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$|^[-+]?\.\d+$/.test(text)) return null;
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

const columnList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

/**
 * The chart for a CSV table: the first row names the columns, `x` picks the label column (the
 * first by default), and `y` the series, a comma-separated list (every other column that holds
 * numbers, by default). A cell that isn't a number is left out of its series, so a gap in the
 * table is a gap in the line. A `type` that isn't one of CHART_TYPES is a bar chart, like `<Mark>`
 * with a colour it doesn't know, so a half-typed value still draws something.
 *
 * Anything that stops a chart being drawn comes back as `error`, in words for the notice shown in its place.
 */
export function parseChart(input: { type?: string; x?: string; y?: string; csv: string }): ChartParse {
  const table = parseCsv(input.csv);
  if (table.length === 0) return { error: "Chart: add a ```csv block with a header row and the data." };

  const [header, ...body] = table;
  if (body.length === 0) return { error: "Chart: the data has a header but no rows." };
  if (body.length > MAX_CHART_ROWS) return { error: `Chart: ${body.length} rows is too many to draw (up to ${MAX_CHART_ROWS}).` };
  if (new Set(header).size !== header.length) return { error: "Chart: two columns have the same name." };

  const type = isChartType(input.type?.trim()) ? (input.type!.trim() as ChartType) : DEFAULT_CHART_TYPE;

  const x = input.x?.trim() || header[0];
  if (!header.includes(x)) return { error: `Chart: no column named “${x}”. Columns: ${header.join(", ")}.` };

  const requested = columnList(input.y);
  const unknown = requested.find((name) => !header.includes(name));
  if (unknown !== undefined) return { error: `Chart: no column named “${unknown}”. Columns: ${header.join(", ")}.` };

  const holdsNumbers = (name: string) => {
    const at = header.indexOf(name);
    return body.some((cells) => parseNumber(cells[at] ?? "") !== null);
  };
  const y = (requested.length > 0 ? requested : header.filter((name) => name !== x && holdsNumbers(name))).filter((name) => name !== x);
  if (y.length === 0) return { error: "Chart: no column of numbers to draw. Name one with y=\"column\"." };
  if (requested.length > 0) {
    const empty = y.find((name) => !holdsNumbers(name));
    if (empty !== undefined) return { error: `Chart: column “${empty}” has no numbers.` };
  }

  const xAt = header.indexOf(x);
  const rows = body.map((cells) => {
    const row: Record<string, string | number> = { [x]: cells[xAt] ?? "" };
    for (const name of y) {
      const value = parseNumber(cells[header.indexOf(name)] ?? "");
      if (value !== null) row[name] = value;
    }
    return row;
  });

  return { spec: { type, x, y, rows } };
}
