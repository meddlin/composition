/**
 * Recognising a PDF in a drag from the operating system. While a drag is over the window the page may read only each item's kind
 * and type (never a name); the files themselves, with their names, come with the drop.
 */

type DraggedItem = { kind: string; type: string };

/** A file that is meant to be a PDF: by its type, or by its name when the system gave no type. The main process looks inside it again. */
export function isPdfFile(file: { name: string; type: string }): boolean {
  return file.type === "application/pdf" || (file.type === "" && /\.pdf$/i.test(file.name));
}

/**
 * Whether a drag in progress may be a PDF: it carries files, and at least one is typed as a PDF or untyped (some systems give no
 * type until the drop). A drag of text, a note or a group, or of pictures alone, is not.
 */
export function dragMayBePdf(data: { types: readonly string[]; items?: ArrayLike<DraggedItem> }): boolean {
  if (!Array.from(data.types).includes("Files")) return false;
  const items = Array.from(data.items ?? []).filter((item) => item.kind === "file");
  return items.length === 0 || items.some((item) => item.type === "application/pdf" || item.type === "");
}

/** The PDFs among the files of a drop, in the order they were dropped. */
export function droppedPdfs(data: { files: ArrayLike<File> }): File[] {
  return Array.from(data.files).filter(isPdfFile);
}
