/**
 * The options a fenced code block's opening line can carry after its language: line numbers, the number of the first
 * line, and the lines to highlight (`docs/ui/code-blocks.md`).
 *
 * ```` ```ts showLineNumbers=107 {109,112-114} ````
 *
 * Pure, with no dependencies, so Preview, the Live tab and the terminal app all read a fence the same way; the iPad
 * reads the same cases (`fixtures/conformance/code-fence-cases.json`).
 */

/** A run of highlighted lines, `[from, to]`, both included, in the numbers the block shows. */
export type LineRange = readonly [number, number];

export type CodeFence = {
  /** The language the fence names, or "" for none. */
  language: string;
  /** Whether the lines are numbered. */
  lineNumbers: boolean;
  /** The number of the first line of code: 1 unless `showLineNumbers=N` says otherwise. */
  start: number;
  /** The highlighted lines, in the numbers the block shows: sorted, with overlapping and touching runs joined. */
  highlight: readonly LineRange[];
};

const NUMBERS_KEY = "showLineNumbers";
/** A line number as written: a whole number of at most nine digits, so it stays exact and its column narrow. */
const LINE_NUMBER = /^\d{1,9}$/;
const RANGE = /^(\d{1,9})(?:-(\d{1,9}))?$/;
/** A group in braces (spaces allowed inside), or a run of anything but spaces. */
const TOKEN = /\{[^}]*\}|\S+/g;

/** Whether a word on the fence is one of the options, and so never the language. */
function isOption(word: string): boolean {
  return word.startsWith("{") || word === NUMBERS_KEY || word.startsWith(`${NUMBERS_KEY}=`);
}

/** The runs in one `{…}` group: the pieces that read as a number or a range, each with its ends in order. */
function readGroup(group: string): LineRange[] {
  const found: LineRange[] = [];
  for (const piece of group.slice(1, -1).split(",")) {
    const match = RANGE.exec(piece.replace(/\s+/g, ""));
    if (!match) continue;
    const a = Number(match[1]);
    const b = match[2] === undefined ? a : Number(match[2]);
    found.push([Math.min(a, b), Math.max(a, b)]);
  }
  return found;
}

/** Sorts runs and joins those that overlap or touch. */
function join(runs: LineRange[]): LineRange[] {
  const sorted = [...runs].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/**
 * Reads a fence's info string (all of the opening line after the backticks or tildes). The language is the first
 * word, as Markdown reads it, unless that word is an option; the options may come in any order, and anything else is
 * ignored.
 */
export function parseCodeFence(info: string): CodeFence {
  const text = info.trim();
  const first = text.split(/\s/, 1)[0] ?? "";
  const language = first && !isOption(first) ? first : "";
  let lineNumbers = false;
  let start = 1;
  const runs: LineRange[] = [];
  // Past the language, so a language such as `{x}` cannot be taken for a group as well.
  for (const token of text.slice(language.length).match(TOKEN) ?? []) {
    if (token.startsWith("{") && token.endsWith("}")) {
      runs.push(...readGroup(token));
    } else if (token === NUMBERS_KEY || token.startsWith(`${NUMBERS_KEY}=`)) {
      lineNumbers = true;
      const value = token.slice(NUMBERS_KEY.length + 1);
      start = LINE_NUMBER.test(value) ? Number(value) : 1;
    }
  }
  return { language, lineNumbers, start, highlight: join(runs) };
}

/** The language a fence names: its first word, unless that word is an option (`{3}`, `showLineNumbers`). */
export function fenceLanguage(info: string): string {
  return parseCodeFence(info).language;
}

/** Whether a fence asks for anything this module draws: numbers or highlighted lines. */
export function hasLineOptions(fence: CodeFence): boolean {
  return fence.lineNumbers || fence.highlight.length > 0;
}

/** Whether the line the block shows as `number` is highlighted. */
export function isHighlighted(fence: CodeFence, number: number): boolean {
  return fence.highlight.some(([from, to]) => number >= from && number <= to);
}

/** One line of a block as drawn: its number (shown or not) and whether it is highlighted. */
export type CodeLine = { number: number; highlighted: boolean };

/** The lines of a block of `count` lines of code, as `fence` draws them. A highlight outside the block is ignored. */
export function codeLines(fence: CodeFence, count: number): CodeLine[] {
  return Array.from({ length: count }, (_, index) => {
    const number = fence.start + index;
    return { number, highlighted: isHighlighted(fence, number) };
  });
}
