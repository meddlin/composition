const MAX_TITLE_LENGTH = 60;

/** One line of Markdown as plain text: its block marker, links and emphasis removed. */
function plain(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}(?:\s+|$)|>\s*|[-*+](?:\s+|$)|\d+[.)](?:\s+|$))/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]|~~|__/g, "")
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,;:!?]|$)/g, "$1$2")
    .trim();
}

/**
 * A title for a note made from an answer: the text of the first line that has any, without its Markdown, kept to
 * 60 characters. "Untitled" when nothing is left.
 */
export function titleFromAnswer(text: string): string {
  for (const raw of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) continue;
    const line = plain(raw);
    if (line === "") continue;
    if (line.length <= MAX_TITLE_LENGTH) return line;
    return `${line.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
  }
  return "Untitled";
}
