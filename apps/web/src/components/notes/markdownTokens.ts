/** What a stretch of the editor's text is, so it can be coloured. Plain text has no kind. */
export type TokenKind =
  | "frontmatter"
  | "fence"
  | "code"
  | "heading"
  | "marker"
  | "rule"
  | "strong"
  | "emphasis"
  | "link"
  | "url"
  | "tag";

export type Segment = { text: string; kind: TokenKind | null };

// Same block the note parser treats as frontmatter (lib/composition/frontmatter.ts), minus the YAML check:
// half-typed YAML should still look like frontmatter.
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const QUOTE_PREFIX = /^ {0,3}(?:>[ \t]?)+/;
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?=[ \t])[ \t]*/;

/**
 * A thematic break: up to three spaces, then three or more of one of `-`, `*`, `_`, with spaces or tabs
 * allowed between and after them. Written as a loop, not a regular expression, because the
 * repeated-group form (`([-*_])(?:[ \t]*\1){2,}`) is what ReDoS scanners flag.
 */
function isThematicBreak(line: string): boolean {
  let i = 0;
  while (i < 3 && line[i] === " ") i++;
  const marker = line[i];
  if (marker !== "-" && marker !== "*" && marker !== "_") return false;
  let count = 0;
  for (; i < line.length; i++) {
    const char = line[i];
    if (char === marker) count++;
    else if (char !== " " && char !== "\t") return false;
  }
  return count >= 3;
}

// One alternation, so the leftmost construct wins. Everything is single-line. The groups are
// numbered (the build targets ES2017, which has no named groups): see INLINE_KINDS.
const INLINE =
  /(\\[\\`*_{}[\]()#+\-.!<>~|])|((`+)(?!`).+?(?<!`)\3(?!`))|((!?\[[^\]]*\])(\([^)]*\)))|(<\/?[A-Za-z][^<>]*>)|(\*\*(?=\S).+?(?<=\S)\*\*|(?<!\w)__(?=\S).+?(?<=\S)__(?!\w))|((?<!\*)\*(?=[^\s*]).+?(?<=[^\s*])\*(?!\*)|(?<!\w)_(?=[^\s_]).+?(?<=[^\s_])_(?!\w))/g;
const ESCAPE = 1;
const LINK = { whole: 4, text: 5, url: 6 };
/** The group that matched, for the constructs that are one run of one colour. */
const INLINE_KINDS: [group: number, kind: TokenKind][] = [
  [2, "code"],
  [7, "tag"],
  [8, "strong"],
  [9, "emphasis"],
];

/** Past this, a line is left plain: the lazy matches above are quadratic in the worst case. */
const MAX_INLINE_LINE = 2000;

function push(out: Segment[], text: string, kind: TokenKind | null) {
  if (text === "") return;
  const last = out[out.length - 1];
  if (last && last.kind === kind) last.text += text;
  else out.push({ text, kind });
}

function inline(line: string, out: Segment[]) {
  if (line.length > MAX_INLINE_LINE) return push(out, line, null);
  let plainFrom = 0;
  for (const match of line.matchAll(INLINE)) {
    if (match[ESCAPE] !== undefined) continue;
    push(out, line.slice(plainFrom, match.index), null);
    plainFrom = match.index + match[0].length;
    if (match[LINK.whole] !== undefined) {
      push(out, match[LINK.text], "link");
      push(out, match[LINK.url], "url");
    } else {
      const [, kind] = INLINE_KINDS.find(([group]) => match[group] !== undefined)!;
      push(out, match[0], kind);
    }
  }
  push(out, line.slice(plainFrom), null);
}

/**
 * Splits Markdown into coloured runs for the editor's highlight layer. The runs
 * always concatenate back to `text`, since the layer sits exactly under the
 * textarea and any difference would put the colours out of line with the caret.
 *
 * This is deliberately not a full parse: it must run on every keystroke, so it
 * reads line by line, remembering only whether it is inside a code fence.
 */
export function tokenizeMarkdown(text: string): Segment[] {
  const out: Segment[] = [];
  let pos = 0;

  const frontmatter = FRONTMATTER.exec(text);
  if (frontmatter) {
    push(out, frontmatter[0], "frontmatter");
    pos = frontmatter[0].length;
  }

  let fence: Fence | null = null;
  while (pos < text.length) {
    const newline = text.indexOf("\n", pos);
    const end = newline === -1 ? text.length : newline;
    const raw = text.slice(pos, end);
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    pos = end + 1;

    fence = tokenizeLine(line, out, fence);
    push(out, raw.slice(line.length) + (newline === -1 ? "" : "\n"), null);
  }
  return out;
}

type Fence = { char: string; length: number };

/** Colours one line and returns the fence the next line is inside, if any. */
function tokenizeLine(line: string, out: Segment[], fence: Fence | null): Fence | null {
  if (fence) {
    const close = FENCE_CLOSE.exec(line);
    if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
      push(out, line, "fence");
      return null;
    }
    push(out, line, "code");
    return fence;
  }

  const open = FENCE_OPEN.exec(line);
  // An info string can't hold a backtick; ```like this``` is inline code.
  if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
    push(out, line, "fence");
    return { char: open[1][0], length: open[1].length };
  }
  if (HEADING.test(line)) push(out, line, "heading");
  else if (isThematicBreak(line)) push(out, line, "rule");
  else {
    let rest = line;
    const quote = QUOTE_PREFIX.exec(rest);
    if (quote) {
      push(out, quote[0], "marker");
      rest = rest.slice(quote[0].length);
    }
    const list = LIST_MARKER.exec(rest);
    if (list) {
      push(out, list[0], "marker");
      rest = rest.slice(list[0].length);
    }
    inline(rest, out);
  }
  return null;
}
