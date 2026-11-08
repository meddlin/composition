/**
 * `<Sheet>` as note text: finding the tags in a note, rewriting the two blocks inside one (the CSV and the
 * `formulas`), putting a new one in, and reading a Markdown table so it can be promoted to one. Pure; what the sheet
 * editor does to the note goes through here, as the diagram editor's does through drawioSrc.ts.
 *
 * A sheet is found by reading the note line by line, so a fence inside it that holds the text `</Sheet>` (a cell can)
 * does not end it, and a tag shown inside a fenced code block is an example of one, not a sheet.
 */
import { insideFence } from "./completions";
import { type SheetSource } from "./sheetDraft";

/** Cmd+Shift+G on macOS, Ctrl+Shift+G elsewhere; `aria-keyshortcuts` says the same. */
export const SHEET_SHORTCUT = "Control+Shift+G Meta+Shift+G";

export function isSheetShortcut(event: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
  return event.key.toLowerCase() === "g" && event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);
}

/** A fenced block inside a sheet. */
type Fence = {
  /** Where its opening line starts, and where its closing line ends (the line break after it is not counted). */
  start: number;
  end: number;
  /** The spaces before its fences, the fence itself (```` ``` ````), and what follows the fence on the opening line (`csv`). */
  indent: string;
  marker: string;
  info: string;
  /** The first word of `info`, in lower case. */
  language: string;
  /** What it holds, without the line break that ends it. */
  content: string;
};

/** A `<Sheet>…</Sheet>` in a note. */
export type SheetSpan = {
  /** The whole of it, from the `<` of the tag to the `>` of its closing tag. */
  start: number;
  end: number;
  /** Where the opening tag ends. */
  openEnd: number;
  /** The CSV block (the first one tagged `csv`, else the first block, as the preview reads it), and the `formulas` one. */
  csv: Fence | null;
  formulas: Fence | null;
};

// A `<Sheet …>` tag, reading quoted values whole, so a `>` in a title doesn't end it.
const SHEET_TAG = /<Sheet(?=[\s>/])(?:"[^"]*"|'[^']*'|[^>"'])*>/g;
const OPENING_FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/** The `<Sheet>` tags that have their closing tag, in the order they come in the note. */
export function findSheets(text: string): SheetSpan[] {
  const spans: SheetSpan[] = [];
  SHEET_TAG.lastIndex = 0;
  for (let match = SHEET_TAG.exec(text); match; match = SHEET_TAG.exec(text)) {
    const openEnd = match.index + match[0].length;
    if (match[0].endsWith("/>") || insideFence(text, text.lastIndexOf("\n", match.index - 1) + 1)) continue;
    const span = readSheet(text, match.index, openEnd);
    if (!span) continue;
    spans.push(span);
    SHEET_TAG.lastIndex = span.end;
  }
  return spans;
}

function readSheet(text: string, start: number, openEnd: number): SheetSpan | null {
  const fences: Fence[] = [];
  let open: { start: number; indent: string; marker: string; info: string; contentStart: number } | null = null;
  let lineStart = text.indexOf("\n", openEnd) + 1;
  if (lineStart === 0) return null;
  while (lineStart <= text.length) {
    const lineEnd = text.indexOf("\n", lineStart) < 0 ? text.length : text.indexOf("\n", lineStart);
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (open) {
      const closing = CLOSING_FENCE.exec(line);
      if (closing && closing[1][0] === open.marker[0] && closing[1].length >= open.marker.length) {
        const content = text.slice(open.contentStart, Math.max(open.contentStart, lineStart - 1)).replace(/\r$/, "");
        fences.push({
          start: open.start,
          end: lineStart + line.length,
          indent: open.indent,
          marker: open.marker,
          info: open.info,
          language: open.info.trim().split(/\s+/)[0]?.toLowerCase() ?? "",
          content,
        });
        open = null;
      }
    } else {
      const fence = OPENING_FENCE.exec(line);
      if (fence && !(fence[2][0] === "`" && fence[3].includes("`"))) {
        open = { start: lineStart, indent: fence[1], marker: fence[2], info: fence[3], contentStart: lineEnd + 1 };
      } else if (line.trim() === "</Sheet>") {
        const end = lineStart + line.indexOf("</Sheet>") + "</Sheet>".length;
        return {
          start,
          end,
          openEnd,
          csv: fences.find((fence) => fence.language === "csv") ?? fences.find((fence) => fence.language !== "formulas") ?? null,
          formulas: fences.find((fence) => fence.language === "formulas") ?? null,
        };
      }
    }
    if (lineEnd >= text.length) break;
    lineStart = lineEnd + 1;
  }
  return null;
}

/** What the sheet editor opens on: the text of the sheet's two blocks. */
export function sheetSource(span: SheetSpan): SheetSource {
  return { csv: span.csv?.content ?? "", formulas: span.formulas?.content ?? "" };
}

/** A fence long enough that nothing inside `content` can close it. */
function fenceFor(content: string): string {
  const longest = (content.match(/`+/g) ?? []).reduce((most, run) => Math.max(most, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

/** A fenced block of `language` holding `content`; `keep` is an old block whose indent and extra words after the language are kept. */
function fenceBlock(language: string, content: string, keep?: Fence | null): string {
  const marker = fenceFor(content);
  const indent = keep?.indent ?? "";
  return `${indent}${marker}${keep ? keep.info : language}\n${content === "" ? "" : `${content}\n`}${indent}${marker}`;
}

type Replacement = { from: number; to: number; text: string };

/**
 * The note with the sheet at `span` holding `source`: its CSV block and its `formulas` block rewritten (the second
 * added when the sheet gets its first formula, taken out when it has none left), and the rest of the tag, its
 * attributes included, left as it was.
 */
export function writeSheet(text: string, span: SheetSpan, source: SheetSource): string {
  const edits: Replacement[] = [];
  // A block the sheet does not have yet goes after its CSV block (or the opening tag, if the CSV is missing too).
  let after = span.openEnd;
  let added = "";
  if (span.csv) {
    edits.push({ from: span.csv.start, to: span.csv.end, text: fenceBlock("csv", source.csv, span.csv) });
    after = span.csv.end;
  } else added = `\n\n${fenceBlock("csv", source.csv)}`;

  if (span.formulas) {
    if (source.formulas !== "") edits.push({ from: span.formulas.start, to: span.formulas.end, text: fenceBlock("formulas", source.formulas, span.formulas) });
    else {
      // The block and the blank line after it go, so the one before it is still what separates the rest.
      let to = span.formulas.end;
      for (let i = 0; i < 2 && text[to] === "\n"; i++) to++;
      edits.push({ from: span.formulas.start, to, text: "" });
    }
  } else if (source.formulas !== "") added += `\n\n${fenceBlock("formulas", source.formulas)}`;

  if (added) edits.push({ from: after, to: after, text: added });
  return applyEdits(text, edits);
}

function applyEdits(text: string, edits: Replacement[]): string {
  let result = text;
  for (const { from, to, text: replacement } of [...edits].sort((x, y) => y.from - x.from)) result = result.slice(0, from) + replacement + result.slice(to);
  return result;
}

/** The sheet that starts at `offset`, or is the one that holds it. */
export function sheetAt(text: string, offset: number): SheetSpan | null {
  return findSheets(text).find((span) => offset >= span.start && offset < span.end) ?? null;
}

/**
 * The sheet that was opened for editing, found again: the one at the same place if it is still the same text, else any
 * that is, else none (the note changed underneath the editor, and what it would write is not meant for what is there now).
 */
export function findOpenedSheet(text: string, opened: { start: number; text: string }): SheetSpan | null {
  const same = findSheets(text).filter((span) => text.slice(span.start, span.end) === opened.text);
  return same.find((span) => span.start === opened.start) ?? same[0] ?? null;
}

/** The tag for a new sheet holding `source`: the CSV block, and the `formulas` one when there are formulas. */
export function sheetTag(source: SheetSource): string {
  const formulas = source.formulas === "" ? "" : `\n\n${fenceBlock("formulas", source.formulas)}`;
  // The tag is note text (MDX source), never HTML a browser parses.
  // nosemgrep: html-in-template-string
  return `<Sheet>\n\n${fenceBlock("csv", source.csv)}${formulas}\n\n</Sheet>`;
}

/**
 * Where a new sheet goes, given the editor's selection and where the note's body starts (after its frontmatter):
 * at the start of the selection, which is never replaced, and not in the frontmatter (the end of the note instead).
 */
export function sheetRange(text: string, start: number, bodyStart: number): { start: number; end: number } {
  return start >= bodyStart ? { start, end: start } : { start: text.length, end: text.length };
}

export type SheetInsertion = { start: number; end: number; text: string; caret: number };

/**
 * What to put in the note, replacing `[start, end)`, for a sheet: the tag on lines of its own, with blank lines around it
 * so it stands as a block, and the caret after it, ready to carry on writing.
 */
export function insertSheet(text: string, start: number, end: number, source: SheetSource): SheetInsertion {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const lead = start === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after === "" || !after.startsWith("\n") ? "\n\n" : after.startsWith("\n\n") ? "" : "\n";
  const inserted = lead + sheetTag(source) + trail;
  return { start, end, text: inserted, caret: inserted.length };
}

/** A Markdown table in a note, where it is, and its cells (the header row first). */
export type MarkdownTable = { start: number; end: number; rows: string[][] };

const DELIMITER_CELL = /^:?-+:?$/;

/** Whether a line is a table's delimiter row (`| --- | :---: |`): pipes between cells made only of dashes, with a colon at either end for alignment. */
function isDelimiterRow(line: string): boolean {
  if (!line.includes("|")) return false;
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").every((cell) => DELIMITER_CELL.test(cell.trim()));
}

/** The cells of a table row: split at the pipes that are not escaped, the ones at either end dropped. */
function tableCells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return inner.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

/**
 * The Markdown table the selection starts in, if it does: a header row, a delimiter row (`| --- | --- |`) and the
 * rows after, each with a pipe in it. A table in a fenced code block is code, and is not one.
 */
export function tableAt(text: string, position: number): MarkdownTable | null {
  const lines: { start: number; end: number; text: string }[] = [];
  for (let start = 0; start <= text.length; ) {
    const stop = text.indexOf("\n", start) < 0 ? text.length : text.indexOf("\n", start);
    lines.push({ start, end: stop, text: text.slice(start, stop).replace(/\r$/, "") });
    start = stop + 1;
  }
  const here = lines.findIndex((line) => position >= line.start && position <= line.end);
  if (here < 0 || !lines[here].text.includes("|") || insideFence(text, lines[here].start)) return null;
  let first = here;
  while (first > 0 && lines[first - 1].text.includes("|")) first--;
  let last = here;
  while (last + 1 < lines.length && lines[last + 1].text.includes("|")) last++;

  // The table starts one line above its delimiter row, and the position has to be in it.
  const delimiter = lines.findIndex((line, i) => i > first && i <= last && isDelimiterRow(line.text));
  if (delimiter < 0 || here < delimiter - 1) return null;
  const header = delimiter - 1;
  const body = lines.slice(delimiter + 1, last + 1);
  const rows = [tableCells(lines[header].text), ...body.map((line) => tableCells(line.text))];
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  return {
    start: lines[header].start,
    end: lines[last].end,
    rows: rows.map((row) => (row.length < width ? [...row, ...Array<string>(width - row.length).fill("")] : row)),
  };
}
