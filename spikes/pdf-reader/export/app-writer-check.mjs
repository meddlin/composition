// The app's export writer (apps/web/src/lib/composition/pdfExport.ts), checked by looking: it writes four marks (highlight, underline,
// strikethrough, a text note) onto each of spike C's nine geometries, native and flattened; pdf.js renders the result and the original,
// and the pixels that changed must be inside each mark's rectangle (nothing outside every rectangle), the note's word must read
// upright whichever way the page is turned, and native marks must be read back as annotations (flattened: none).
// usage, from spikes/pdf-reader:
//   (cd ../../apps/web && ../desktop/node_modules/.bin/esbuild src/lib/composition/pdfExport.ts --bundle --platform=node --format=esm --outfile=/tmp/pdfExport.mjs)
//   cp export/app-writer-check.mjs ./_check.mjs && node ./_check.mjs /tmp/pdfExport.mjs; rm ./_check.mjs
// (the copy is so that @napi-rs/canvas and pdfjs-dist resolve from this folder's node_modules). Exit 1 on any failure.
import fs from "node:fs";
import { createRequire } from "node:module";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const require = createRequire(import.meta.url);
const { PDFDocument, StandardFonts, degrees, PDFName, PDFNumber } = require("@cantoo/pdf-lib");
const { exportAnnotatedPdf } = await import(process.argv[2]);
const web = new URL("../../apps/web/node_modules", import.meta.url).pathname;
const fonts = {
  text: new Uint8Array(fs.readFileSync(`${web}/@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf`)),
  math: new Uint8Array(fs.readFileSync(`${web}/@expo-google-fonts/noto-sans-math/400Regular/NotoSansMath_400Regular.ttf`)),
};
const standardFontDataUrl = new URL("./node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;
const GEOMETRIES = [
  { name: "plain" }, { name: "rotate90", rotate: 90 }, { name: "rotate180", rotate: 180 }, { name: "rotate270", rotate: 270 },
  { name: "crop", crop: [30, 40, 500, 700] }, { name: "media-offset", media: [-100, -50, 512, 742] },
  { name: "crop+rotate90", rotate: 90, crop: [30, 40, 500, 700] },
  { name: "media-offset+crop+rotate270", rotate: 270, media: [-100, -50, 512, 742], crop: [20, 30, 400, 600] },
  { name: "userunit2", userUnit: 2 },
];
const MARKS = [
  { kind: "highlight", color: "yellow", rects: [[100, 296, 272, 322]] },
  { kind: "underline", color: "green", rects: [[100, 400, 272, 424]] },
  { kind: "strikethrough", color: "pink", rects: [[100, 440, 272, 464]] },
  { kind: "text", color: "blue", body: { rect: [200, 100, 400, 160], text: "Hello", fontSize: 12 } },
];
const SCALE = 2;
async function fixture(g) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  page.drawText("Page of the fixture", { x: 100, y: 300, size: 24, font });
  if (g.media) page.setMediaBox(...g.media);
  if (g.crop) page.setCropBox(...g.crop);
  if (g.rotate) page.setRotation(degrees(g.rotate));
  if (g.userUnit) page.node.set(PDFName.of("UserUnit"), PDFNumber.of(g.userUnit));
  return doc.save();
}
async function render(bytes, mode) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: SCALE });
  const w = Math.ceil(viewport.width), h = Math.ceil(viewport.height);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  await page.render({ canvasContext: ctx, viewport, annotationMode: mode }).promise;
  const subtypes = (await page.getAnnotations()).map((a) => a.subtype);
  const out = { data: ctx.getImageData(0, 0, w, h).data, w, h, viewport, subtypes };
  await task.destroy();
  return out;
}
let failures = 0;
for (const flatten of [false, true]) {
  for (const g of GEOMETRIES) {
    const original = await fixture(g);
    const marks = MARKS.map((m, i) => ({ id: i, uuid: String(i).padStart(32, "0"), documentId: 1, page: 0, comment: "", quote: "", rects: null, body: null, groupUuid: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...m }));
    const { bytes } = await exportAnnotatedPdf(new Uint8Array(original), marks, { flatten, fonts });
    const before = await render(original, pdfjs.AnnotationMode.ENABLE);
    const after = await render(bytes, flatten ? pdfjs.AnnotationMode.DISABLE : pdfjs.AnnotationMode.ENABLE);
    const boxes = MARKS.map((m) => {
      const [x0, y0, x1, y1] = m.rects ? m.rects.reduce((a, r) => [Math.min(a[0], r[0]), Math.min(a[1], r[1]), Math.max(a[2], r[2]), Math.max(a[3], r[3])]) : m.body.rect;
      const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => before.viewport.convertToViewportPoint(x, y));
      const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    });
    const grow = 4;
    const inBox = (x, y, b) => x >= b[0] - grow && x < b[2] + grow && y >= b[1] - grow && y < b[3] + grow;
    const changed = MARKS.map(() => 0); let outside = 0;
    const textPixels = { x0: 1e9, y0: 1e9, x1: -1, y1: -1 };
    for (let y = 0; y < after.h; y++) for (let x = 0; x < after.w; x++) {
      const i = (y * after.w + x) * 4;
      const d = Math.abs(before.data[i] - after.data[i]) + Math.abs(before.data[i + 1] - after.data[i + 1]) + Math.abs(before.data[i + 2] - after.data[i + 2]);
      if (d <= 60) continue;
      const k = boxes.findIndex((b) => inBox(x, y, b));
      if (k < 0) outside++; else changed[k]++;
      // dark pixels in the note's box are its words
      if (k === 3 && after.data[i] < 90 && after.data[i + 1] < 90 && after.data[i + 2] < 90) { textPixels.x0 = Math.min(textPixels.x0, x); textPixels.y0 = Math.min(textPixels.y0, y); textPixels.x1 = Math.max(textPixels.x1, x); textPixels.y1 = Math.max(textPixels.y1, y); }
    }
    const tw = textPixels.x1 - textPixels.x0, th = textPixels.y1 - textPixels.y0;
    const upright = tw > 1.5 * th;
    const ok = changed[0] > 500 && changed[1] > 100 && changed[2] > 100 && changed[3] > 500 && outside <= 30 && upright && (flatten ? after.subtypes.length === 0 : after.subtypes.join() === "Highlight,Underline,StrikeOut,FreeText");
    if (!ok) failures++;
    console.log(`${flatten ? "flatten" : "native "} ${g.name.padEnd(28)} ${ok ? "ok  " : "FAIL"} changed ${changed.join("/")} outside ${outside} words ${tw}x${th} ${upright ? "upright" : "NOT upright"} annots ${after.subtypes.join(",") || "-"}`);
  }
}
console.log(failures === 0 ? "\nall drawn where expected" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
