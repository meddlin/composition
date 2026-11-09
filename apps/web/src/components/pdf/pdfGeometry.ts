import type { PdfAnnotation } from "@/lib/composition/documentsApi";
import type { PdfMarkColor, PdfRect, PdfTextNoteBody } from "@/lib/composition/pdfMarkup";

/**
 * The arithmetic between where a mark is stored and where it is drawn. A mark's rectangles are in raw PDF user space (the
 * numbers a PDF's own annotation `/Rect` holds, spike C); the page on screen is in CSS pixels with its top-left corner at 0,0,
 * zoomed and rotated as the reader has it. pdf.js's page viewport converts a point either way, and these functions turn that
 * into rectangles, which stay rectangles under the 90-degree turns a page can have. Pure, so they are tested without a browser.
 */
export type PageViewportLike = {
  convertToViewportPoint(x: number, y: number): [number, number];
  convertToPdfPoint(x: number, y: number): [number, number];
};

/** A rectangle on the screen, relative to the page's top-left corner, in CSS pixels. */
export type Box = { left: number; top: number; right: number; bottom: number };

const height = (box: Box) => box.bottom - box.top;

/** A mark on the screen: a rectangle per line, or a text note's box. */
export function rawToBox(rect: PdfRect, viewport: PageViewportLike): Box {
  const corners = [viewport.convertToViewportPoint(rect[0], rect[1]), viewport.convertToViewportPoint(rect[2], rect[3])];
  return {
    left: Math.min(corners[0][0], corners[1][0]),
    top: Math.min(corners[0][1], corners[1][1]),
    right: Math.max(corners[0][0], corners[1][0]),
    bottom: Math.max(corners[0][1], corners[1][1]),
  };
}

/** A rectangle on the screen as a mark stores it. (`normalizeRect` puts the corners in order when it is stored.) */
export function boxToRaw(box: Box, viewport: PageViewportLike): PdfRect {
  const [x0, y0] = viewport.convertToPdfPoint(box.left, box.bottom);
  const [x1, y1] = viewport.convertToPdfPoint(box.right, box.top);
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

/**
 * Joins the rectangles of a selection into one per line of text. A selection reports a rectangle per piece of text, and
 * the box of an element whose text is all selected as well, so the same words come out two or three times; here those, and
 * the pieces that sit side by side on a line, become one. Two columns on the same line stay apart, since the gap between
 * them is wider than a word's space, which keeps a highlight of a two-column page from being a bar across the gutter.
 */
export function mergeLines(boxes: readonly Box[]): Box[] {
  const sorted = boxes.filter((b) => b.right - b.left > 0.5 && height(b) > 0.5).sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Box[] = [];
  for (const box of sorted) {
    const line = lines.find((l) => {
      const overlap = Math.min(l.bottom, box.bottom) - Math.max(l.top, box.top);
      const shorter = Math.min(height(l), height(box));
      const reach = 0.75 * Math.max(height(l), height(box));
      return overlap > 0.5 * shorter && box.left <= l.right + reach && box.right >= l.left - reach;
    });
    if (line) {
      line.left = Math.min(line.left, box.left);
      line.top = Math.min(line.top, box.top);
      line.right = Math.max(line.right, box.right);
      line.bottom = Math.max(line.bottom, box.bottom);
    } else {
      lines.push({ ...box });
    }
  }
  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}

/** The color of a mark on the page: what it is filled with, and the line an underline or a strikethrough is drawn in. */
export const MARK_PAINT: Record<PdfMarkColor, { fill: string; line: string }> = {
  yellow: { fill: "rgba(255, 221, 51, 0.5)", line: "#d6a400" },
  green: { fill: "rgba(92, 200, 100, 0.45)", line: "#2f9e44" },
  blue: { fill: "rgba(88, 166, 255, 0.45)", line: "#1c7ed6" },
  pink: { fill: "rgba(255, 128, 171, 0.5)", line: "#d6336c" },
  orange: { fill: "rgba(255, 169, 77, 0.5)", line: "#e8590c" },
};

/** The paint for a color name; anything that is not one of the five (a text note may carry another) falls back to yellow. */
export function paintFor(color: string): { fill: string; line: string } {
  return MARK_PAINT[color as PdfMarkColor] ?? MARK_PAINT.yellow;
}

/** The boxes a mark occupies on its page: its lines, or a text note's box. */
export function boxesOf(mark: PdfAnnotation, viewport: PageViewportLike): Box[] {
  if (mark.rects) return mark.rects.map((rect) => rawToBox(rect, viewport));
  const body = mark.body as Partial<PdfTextNoteBody> | null;
  return body?.rect ? [rawToBox(body.rect, viewport)] : [];
}

/**
 * The mark at a point of its page, for a click that selects one: the most recently made, when several lie there. The edge
 * counts a couple of pixels out, since a line of highlighted text is a narrow target.
 */
export function markAt(marks: readonly PdfAnnotation[], x: number, y: number, viewport: PageViewportLike, slop = 2): PdfAnnotation | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const hit = boxesOf(marks[i], viewport).some((b) => x >= b.left - slop && x <= b.right + slop && y >= b.top - slop && y <= b.bottom + slop);
    if (hit) return marks[i];
  }
  return null;
}

/** How many CSS pixels a point of the PDF is on screen at the page's current zoom, whichever way the page is turned. */
export function scaleOf(viewport: PageViewportLike): number {
  const [x0, y0] = viewport.convertToViewportPoint(0, 0);
  const [x1, y1] = viewport.convertToViewportPoint(1, 0);
  return Math.hypot(x1 - x0, y1 - y0);
}
