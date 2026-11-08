// Spike D adapter: pdf.js itself. `saveDocument()` appends the annotation storage's new annotations to the original bytes as an
// incremental update. pdf.js can create FreeText, Ink, Highlight and Stamp annotations this way, not Underline or StrikeOut, so
// those two kinds are reported as skipped.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { COLORS, MARKS, markedPages, quad } from "../marks.mjs";

const standardFontDataUrl = new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;
const rgb255 = (c) => Uint8ClampedArray.from(c.map((v) => Math.round(v * 255)));

export async function run(bytes, { mode }) {
  if (mode === "flatten") throw new Error("pdf.js writes annotations, it does not flatten");
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const skipped = new Set();
  let n = 0;
  for (const pageIndex of markedPages(doc.numPages)) {
    for (const m of MARKS) {
      const color = rgb255(COLORS[m.kind]);
      const key = `pdfjs_internal_editor_${n++}`;
      if (m.kind === "highlight") {
        const q = quad(m.rect);
        doc.annotationStorage.setValue(key, { annotationType: 9, color, opacity: 1, quadPoints: q, outlines: [[m.rect[0], m.rect[3], m.rect[2], m.rect[3], m.rect[2], m.rect[1], m.rect[0], m.rect[1]]], rect: m.rect, pageIndex, rotation: 0, structTreeParentId: null });
      } else if (m.kind === "text") {
        doc.annotationStorage.setValue(key, { annotationType: 3, color, fontSize: 12, value: m.contents, rect: m.rect, pageIndex, rotation: 0, structTreeParentId: null });
      } else if (m.kind === "ink") {
        const w = m.width;
        // a line is [ignored x4, x0, y0, then six numbers per segment]; a straight segment is four NaN and its end point
        const line = [0, 0, 0, 0, ...m.points[0], ...m.points.slice(1).flatMap(([x, y]) => [NaN, NaN, NaN, NaN, x, y])];
        doc.annotationStorage.setValue(key, { annotationType: 15, color, thickness: w, opacity: 1, paths: { lines: [line], points: [m.points.flat()] }, rect: [m.rect[0] - w, m.rect[1] - w, m.rect[2] + w, m.rect[3] + w], pageIndex, rotation: 0, structTreeParentId: null });
      } else {
        skipped.add(m.kind);
      }
    }
  }
  const out = await doc.saveDocument();
  await task.destroy();
  return { bytes: out, skipped: [...skipped] };
}
