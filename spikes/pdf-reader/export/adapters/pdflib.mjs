// Spike D adapter for the pdf-lib family (pdf-lib, @cantoo/pdf-lib, @pdfme/pdf-lib share an API).
//   native:  appends Highlight / Underline / StrikeOut / FreeText / Ink annotations to each page, with hand-written appearance
//            streams (these libraries write no appearance streams for annotations; `ap: false` leaves them out to see what a
//            viewer does on its own).
//   flatten: burns the same marks into each page's content with the library's drawing calls.
// Rewrites the whole file (these libraries have no incremental save).
import { createRequire } from "node:module";
import { COLORS, MARKS, markedPages, quad } from "../marks.mjs";

const num = (n) => String(Math.round(n * 1000) / 1000);

export async function run(moduleName, bytes, { mode, ap = true }) {
  const lib = createRequire(import.meta.url)(moduleName);
  const { PDFDocument, PDFName, PDFString, PDFHexString, PDFNumber, rgb, BlendMode, StandardFonts, LineCapStyle } = lib;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;

  const all = doc.getPages();
  const pages = markedPages(all.length).map((i) => all[i]);
  if (mode === "flatten") {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const page of pages) {
      for (const m of MARKS) {
        const c = rgb(...COLORS[m.kind]);
        const [x0, y0, x1, y1] = m.rect;
        if (m.kind === "highlight") page.drawRectangle({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, color: c, blendMode: BlendMode.Multiply });
        else if (m.kind === "underline") page.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y0 }, thickness: 1.5, color: c });
        else if (m.kind === "strikeout") page.drawLine({ start: { x: x0, y: (y0 + y1) / 2 }, end: { x: x1, y: (y0 + y1) / 2 }, thickness: 1.5, color: c });
        else if (m.kind === "text") {
          page.drawText(m.contents, { x: x0 + 4, y: y1 - 16, size: 12, font, color: c });
        } else if (m.kind === "ink") {
          for (let i = 1; i < m.points.length; i++) {
            page.drawLine({ start: { x: m.points[i - 1][0], y: m.points[i - 1][1] }, end: { x: m.points[i][0], y: m.points[i][1] }, thickness: m.width, color: c, lineCap: LineCapStyle.Round });
          }
        }
      }
    }
    return await doc.save();
  }

  // native
  const form = (bbox, content, resources) => {
    const stream = ctx.stream(content, { Type: "XObject", Subtype: "Form", FormType: 1, BBox: bbox, Resources: resources });
    return ctx.register(stream);
  };
  const helv = ctx.obj({ Type: "Font", Subtype: "Type1", BaseFont: "Helvetica", Encoding: "WinAnsiEncoding" });
  const multiply = ctx.obj({ Type: "ExtGState", BM: "Multiply" });
  let n = 0;
  for (const page of pages) {
    for (const m of MARKS) {
      const [x0, y0, x1, y1] = m.rect;
      const col = COLORS[m.kind];
      const cs = `${col.map(num).join(" ")}`;
      const fields = { Type: "Annot", F: 4, Border: [0, 0, 0], C: col, M: PDFString.of("D:20261107000000Z"), NM: PDFString.of(`spike-d-${n++}`) };
      let appearance = null;
      if (m.kind === "highlight") {
        Object.assign(fields, { Subtype: "Highlight", Rect: m.rect, QuadPoints: quad(m.rect) });
        appearance = form(m.rect, `/GS gs ${cs} rg ${num(x0)} ${num(y0)} ${num(x1 - x0)} ${num(y1 - y0)} re f`, { ExtGState: { GS: multiply } });
      } else if (m.kind === "underline") {
        Object.assign(fields, { Subtype: "Underline", Rect: m.rect, QuadPoints: quad(m.rect) });
        appearance = form(m.rect, `${cs} RG 1.5 w ${num(x0)} ${num(y0 + 0.75)} m ${num(x1)} ${num(y0 + 0.75)} l S`, {});
      } else if (m.kind === "strikeout") {
        Object.assign(fields, { Subtype: "StrikeOut", Rect: m.rect, QuadPoints: quad(m.rect) });
        const y = (y0 + y1) / 2;
        appearance = form(m.rect, `${cs} RG 1.5 w ${num(x0)} ${num(y)} m ${num(x1)} ${num(y)} l S`, {});
      } else if (m.kind === "text") {
        Object.assign(fields, { Subtype: "FreeText", Rect: m.rect, DA: PDFString.of(`/Helv 12 Tf ${cs} rg`), Contents: PDFString.of(m.contents) });
        delete fields.C;
        appearance = form(m.rect, `BT /Helv 12 Tf ${cs} rg ${num(x0 + 4)} ${num(y1 - 16)} Td (${m.contents}) Tj ET`, { Font: { Helv: helv } });
      } else if (m.kind === "ink") {
        const w = m.width;
        Object.assign(fields, { Subtype: "Ink", Rect: [x0 - w, y0 - w, x1 + w, y1 + w], InkList: [m.points.flat()], BS: { W: w } });
        const path = m.points.map(([x, y], i) => `${num(x)} ${num(y)} ${i ? "l" : "m"}`).join(" ");
        appearance = form(fields.Rect, `${cs} RG ${w} w 1 J 1 j ${path} S`, {});
      }
      if (ap && appearance) fields.AP = { N: appearance };
      const ref = ctx.register(ctx.obj(fields));
      page.node.addAnnot(ref);
    }
  }
  return await doc.save();
}
