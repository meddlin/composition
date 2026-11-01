import type { ChartSpec } from "./backend";

const BAR_WIDTH = 32;
const EIGHTHS = " ▏▎▍▌▋▊▉█";

/** A bar `width` cells long for `fraction` of the full width, to eighths of a cell. */
function bar(fraction: number, width = BAR_WIDTH): string {
  const eighths = Math.round(Math.max(0, Math.min(1, fraction)) * width * 8);
  return "█".repeat(Math.floor(eighths / 8)) + (eighths % 8 ? EIGHTHS[eighths % 8] : "");
}

const number = (value: number) => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));

/**
 * A chart as text, for a terminal that can't draw one: a horizontal bar per value, whatever the
 * chart's type (the shape of a line is lost, its numbers are not). A row with several series gets a
 * bar for each, named; a pie also says what share of the whole each slice is. Returned as the
 * lines of a code block, so the terminal keeps the alignment.
 */
export function chartLines(spec: ChartSpec): string[] {
  const { type, x, y, rows } = spec;
  const series = type === "pie" ? y.slice(0, 1) : y;
  const peak = Math.max(0, ...rows.flatMap((row) => series.map((name) => Number(row[name] ?? 0))));
  const total = type === "pie" ? rows.reduce((sum, row) => sum + Number(row[series[0]] ?? 0), 0) : 0;

  const labelWidth = Math.max(...rows.map((row) => String(row[x]).length));
  const seriesWidth = series.length > 1 ? Math.max(...series.map((name) => name.length)) : 0;
  const valueWidth = Math.max(...rows.flatMap((row) => series.map((name) => (name in row ? number(Number(row[name])).length : 1))));

  return rows.flatMap((row) =>
    series.map((name, index) => {
      const label = (index === 0 ? String(row[x]) : "").padEnd(labelWidth);
      const prefix = seriesWidth ? `${name.padEnd(seriesWidth)} ` : "";
      if (!(name in row)) return `${label}  ${prefix}${"–".padStart(valueWidth)}`;
      const value = Number(row[name]);
      const share = type === "pie" && total > 0 ? `  ${Math.round((value / total) * 100)}%` : "";
      return `${label}  ${prefix}${number(value).padStart(valueWidth)} ${bar(peak > 0 ? value / peak : 0)}${share}`.trimEnd();
    }),
  );
}

/** The lines as a fenced Markdown block (a fence longer than any backtick run in them), under a bold title when there is one. */
export function chartMarkdown(spec: ChartSpec, title?: string): string {
  const lines = chartLines(spec);
  const longest = Math.max(0, ...lines.map((line) => Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length))));
  const fence = "`".repeat(Math.max(3, longest + 1));
  const heading = title?.trim() ? `**${title.trim().replace(/[\\*_`]/g, "\\$&")}**\n\n` : "";
  return `${heading}${fence}\n${lines.join("\n")}\n${fence}`;
}
