import type { PdfAnnotationInput, PdfMarkKind } from "@/lib/composition/pdfMarkup";
import { boxToRaw, mergeLines, type Box, type PageViewportLike } from "./pdfGeometry";

/** A page of the reader that is on screen: its element, whose text layer holds the words, and how it converts a point. */
export type PageOnScreen = { pageNumber: number; element: HTMLElement; viewport: PageViewportLike };

/** The words of a selection as a person reads them: runs of spaces and the breaks between lines become one space. */
export const tidyQuote = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The words in a range. `Range.toString()` joins the pieces of text as they are, but pdf.js ends a line with a `<br>` and
 * no space, which `Selection.toString()` reads as a line break and `Range.toString()` as nothing, gluing the last word of
 * a line to the first of the next. A `<br>` is a space here.
 */
export function textOfRange(range: Range): string {
  let text = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? "";
    else if (node.nodeName === "BR") text += " ";
    else node.childNodes.forEach(walk);
  };
  walk(range.cloneContents());
  return tidyQuote(text);
}

/**
 * The part of a selection that lies in one page's text layer, or null when the selection does not touch it. A selection
 * that runs over several pages is cut at each page's text layer, so each page gets its own words and its own lines.
 */
export function rangeInPage(selected: Range, textLayer: Element): Range | null {
  if (!selected.intersectsNode(textLayer)) return null;
  const whole = textLayer.ownerDocument.createRange();
  whole.selectNodeContents(textLayer);
  const part = selected.cloneRange();
  if (part.compareBoundaryPoints(Range.START_TO_START, whole) < 0) part.setStart(textLayer, 0);
  if (part.compareBoundaryPoints(Range.END_TO_END, whole) > 0) part.setEnd(textLayer, textLayer.childNodes.length);
  return part.collapsed ? null : part;
}

/** The rectangles of a range relative to the page's content area (inside its border, where the text layer starts). */
function boxesIn(part: Range, page: HTMLElement): Box[] {
  const frame = page.getBoundingClientRect();
  const originX = frame.left + page.clientLeft;
  const originY = frame.top + page.clientTop;
  return Array.from(part.getClientRects()).map((r) => ({ left: r.left - originX, top: r.top - originY, right: r.right - originX, bottom: r.bottom - originY }));
}

/**
 * The marks a selection makes: one per page it covers, each with a rectangle for every line it covers in raw PDF user
 * space, and the words under them as its quote. Empty when nothing is selected, or what is selected has no text on a page
 * (a click in the gap between pages). The pages are what the reader has on screen, so a selection cannot reach one that is
 * not drawn.
 */
export function marksFromSelection(selection: Selection | null, pages: readonly PageOnScreen[], kind: Exclude<PdfMarkKind, "text" | "ink">, color: string): PdfAnnotationInput[] {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return [];
  const selected = selection.getRangeAt(0);
  const inputs: PdfAnnotationInput[] = [];
  for (const page of [...pages].sort((a, b) => a.pageNumber - b.pageNumber)) {
    const textLayer = page.element.querySelector(".textLayer");
    const part = textLayer ? rangeInPage(selected, textLayer) : null;
    if (!part) continue;
    const lines = mergeLines(boxesIn(part, page.element));
    if (lines.length === 0) continue;
    inputs.push({
      page: page.pageNumber - 1,
      kind,
      color,
      rects: lines.map((line) => boxToRaw(line, page.viewport)),
      quote: textOfRange(part),
    });
  }
  return inputs;
}

/** Where a selection is on the screen, for the little toolbar above it; null when there is none. */
export function selectionAnchor(selection: Selection | null): { x: number; top: number; bottom: number } | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const rects = Array.from(selection.getRangeAt(0).getClientRects()).filter((r) => r.width > 1 && r.height > 1);
  if (rects.length === 0) return null;
  const first = rects[0];
  const last = rects[rects.length - 1];
  return { x: (first.left + Math.max(first.right, last.right)) / 2, top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) };
}
