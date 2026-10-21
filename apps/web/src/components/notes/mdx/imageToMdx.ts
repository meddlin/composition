import { insideFence } from "./completions";

/** Cmd+Shift+M on macOS, Ctrl+Shift+M elsewhere (M for MDX); `aria-keyshortcuts` says the same. */
export const IMAGE_TO_MDX_SHORTCUT = "Control+Shift+M Meta+Shift+M";

export function isImageToMdxShortcut(event: { key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
  return event.key.toLowerCase() === "m" && event.shiftKey && !event.altKey && (event.metaKey || event.ctrlKey);
}

// `![alt](src)` and `![alt](src "title")`. An address with spaces or parentheses (or in `<…>`) is left alone.
const MARKDOWN_IMAGE = /!\[((?:[^\][\\\n]|\\.)*)\]\(\s*([^\s()<>]*)(?:\s+"((?:[^"\\\n]|\\.)*)")?\s*\)/g;
const MARKDOWN_ESCAPE = /\\([!-/:-@[-`{-~])/g;
// An `&` that already starts a character reference means that reference; any other one is just an ampersand.
const BARE_AMPERSAND = /&(?!(?:#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);)/g;

const closingTag = " />";

/** A Markdown string as the inside of a double-quoted JSX attribute: escapes undone, `"` and bare `&` written as references. */
const attribute = (markdown: string) =>
  markdown.replace(MARKDOWN_ESCAPE, "$1").replace(BARE_AMPERSAND, "&amp;").replace(/"/g, "&quot;");

/** Whether `index` sits in a fenced code block or an inline code span, where `![](…)` is just text. */
function insideCode(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  if (insideFence(text, lineStart)) return true;
  return ((text.slice(lineStart, index).match(/`/g)?.length ?? 0) % 2) === 1;
}

export type ImageConversion = {
  /** The stretch of the note to replace, and what to put there. */
  start: number;
  end: number;
  text: string;
  /** Where the caret goes within `text`: at the end of the last tag's attributes, ready for another one. */
  caret: number;
};

/**
 * The edit that turns the Markdown images at the caret, or touched by the selection, into
 * `<Image src alt />` tags, which can say how wide to be. Null when there is no such image.
 *
 * The caret counts as on an image anywhere from its `!` to just after its `)`. A selection takes
 * every image it overlaps, so it can convert a whole note's worth at once (select all).
 */
export function imagesToMdx(text: string, selectionStart: number, selectionEnd: number): ImageConversion | null {
  const found: { start: number; end: number; tag: string }[] = [];
  for (const match of text.matchAll(MARKDOWN_IMAGE)) {
    const start = match.index;
    const end = start + match[0].length;
    const touched =
      selectionStart === selectionEnd ? start <= selectionStart && selectionStart <= end : start < selectionEnd && selectionStart < end;
    if (!touched || insideCode(text, start)) continue;
    const [, alt, src, title] = match;
    const tag = `<Image src="${attribute(src)}" alt="${attribute(alt)}"${title === undefined ? "" : ` title="${attribute(title)}"`}${closingTag}`;
    found.push({ start, end, tag });
  }
  if (found.length === 0) return null;

  // Everything between the first and the last stays as it was.
  let converted = "";
  let from = found[0].start;
  for (const image of found) {
    converted += text.slice(from, image.start) + image.tag;
    from = image.end;
  }
  return { start: found[0].start, end: from, text: converted, caret: converted.length - closingTag.length };
}
