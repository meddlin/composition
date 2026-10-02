/**
 * Markdown highlighting for the editor.
 *
 * OpenTUI's textarea draws whatever highlight ranges it is given but finds none itself,
 * so this scans the text a line at a time. It is deliberately small: it colours what a
 * writer cares about (headings, emphasis, code, links, lists, quotes, frontmatter) and
 * never needs to be right about every corner of Markdown, only fast and never wrong
 * enough to be distracting. Pure, so it is tested without a terminal.
 */

export type Style = "heading" | "bold" | "italic" | "code" | "link" | "marker" | "quote" | "meta";

/** Columns are offsets into the line's text, the same ones the textarea uses. */
export type Span = { line: number; start: number; end: number; style: Style };

const INLINE: [RegExp, Style][] = [
  // Order matters: code first, so markers inside it stay literal; then links, then emphasis.
  [/`[^`\n]+`/g, "code"],
  [/!?\[[^\]\n]+\]\([^)\s]+\)/g, "link"],
  [/\*\*[^*\n]+\*\*|__[^_\n]+__/g, "bold"],
  [/(?<![*\w])\*[^*\s][^*\n]*\*(?![*\w])|(?<![_\w])_[^_\s][^_\n]*_(?![_\w])/g, "italic"],
];

const LIST_MARKER = /^(\s*)((?:[-*+]|\d+\.)\s(?:\[[ xX]\]\s)?)/;

/** Spans in `line` that don't overlap one already taken, earliest-defined style winning. */
function inlineSpans(line: string, from: number, lineIndex: number): Span[] {
  const spans: Span[] = [];
  const taken: [number, number][] = [];
  for (const [pattern, style] of INLINE) {
    for (const match of line.matchAll(pattern)) {
      const start = match.index!;
      const end = start + match[0].length;
      if (start < from) continue;
      if (taken.some(([a, b]) => start < b && end > a)) continue;
      taken.push([start, end]);
      spans.push({ line: lineIndex, start, end, style });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function markdownSpans(text: string): Span[] {
  const spans: Span[] = [];
  let inFence = false;
  let inFrontmatter = false;

  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    const whole = (style: Style) => {
      if (line.length > 0) spans.push({ line: index, start: 0, end: line.length, style });
    };

    if (index === 0 && line === "---") {
      inFrontmatter = true;
      whole("meta");
      return;
    }
    if (inFrontmatter) {
      whole("meta");
      if (line === "---") inFrontmatter = false;
      return;
    }
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      whole("code");
      return;
    }
    if (inFence) {
      whole("code");
      return;
    }
    if (/^#{1,6}\s/.test(line)) {
      whole("heading");
      return;
    }

    let from = 0;
    const quote = /^>\s?/.exec(line);
    if (quote) {
      spans.push({ line: index, start: 0, end: quote[0].length, style: "quote" });
      from = quote[0].length;
    }
    const marker = quote ? null : LIST_MARKER.exec(line);
    if (marker) {
      from = marker[1].length + marker[2].length;
      spans.push({ line: index, start: marker[1].length, end: from, style: "marker" });
    }
    spans.push(...inlineSpans(line, from, index));
  });

  return spans;
}
