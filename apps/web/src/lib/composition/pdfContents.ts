import { formatBytes } from "./attachmentNames";
import type { PdfContents } from "./documentsApi";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What a PDF note holds, as a phrase for the delete dialog and the Trash Can row: "its PDF (212 MB), 41 highlights, 2 ink
 * pages and 6 bookmarks". Kinds with none are left out, so a PDF nobody has marked is just "its PDF (212 MB)".
 */
export function describeContents(contents: PdfContents): string {
  const parts = [`its PDF (${formatBytes(contents.size)})`];
  const { marks } = contents;
  if (marks.highlight > 0) parts.push(plural(marks.highlight, "highlight"));
  if (marks.underline > 0) parts.push(plural(marks.underline, "underline"));
  if (marks.strikethrough > 0) parts.push(plural(marks.strikethrough, "strikethrough"));
  if (marks.text > 0) parts.push(plural(marks.text, "text note"));
  if (contents.inkPages > 0) parts.push(plural(contents.inkPages, "ink page"));
  if (contents.bookmarks > 0) parts.push(plural(contents.bookmarks, "bookmark"));
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
