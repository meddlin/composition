// Spike D checker. usage: node export/check.mjs out.pdf pdfkit.json pdfkit-renders-dir [flatten]
// For every page and every mark kind: is the mark's colour on the page, where it should be, in a pdf.js render and in a PDFKit
// render? Where "where it should be" is the mark's raw rectangle mapped to the screen by pdf.js's viewport (spike C showed
// PDFKit agrees with that mapping). Also lists the annotations each viewer reads from the file (none, if flattened).
// Exit 1 on any failure.
// On a real PDF, whose pages already have colour in them, set ORIGINAL (the unmarked file) and ORIGINAL_DIR (its PDFKit renders):
// the check then compares against the original instead of looking for a colour. Each mark must change pixels inside its own
// rectangle and nothing outside the rectangles of all the marks (that catches a drawing that leaks or lands shifted).
import fs from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { MARKS, isKind, markedPages } from "./marks.mjs";

const [pdfPath, kitJsonPath, kitDir, flag] = process.argv.slice(2);
const flatten = flag === "flatten";
const SCALE = 2;
const names = ["plain", "rotate90", "rotate180", "rotate270", "crop", "media-offset", "crop+rotate90", "media-offset+crop+rotate270", "userunit2"];
const standardFontDataUrl = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfPath)), standardFontDataUrl, isEvalSupported: false, verbosity: 0 }).promise;
const kit = JSON.parse(fs.readFileSync(kitJsonPath, "utf8"));

function pixelsOf(ctx, w, h) { return ctx.getImageData(0, 0, w, h).data; }

/** Bounding box (in points) and count of this kind's pixels, and the expected box (points), both in viewport space. */
function measure(kind, data, w, h, expected, pxPerPt) {
  let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (isKind(kind, data[i], data[i + 1], data[i + 2])) {
        n++;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x + 1 > x1) x1 = x + 1; if (y + 1 > y1) y1 = y + 1;
      }
    }
  }
  if (n === 0) return { n, ok: false, why: "not drawn" };
  const box = [x0 / pxPerPt, y0 / pxPerPt, x1 / pxPerPt, y1 / pxPerPt];
  const slack = kind === "ink" ? 5 : 1.5;
  const inside = box[0] >= expected[0] - slack && box[1] >= expected[1] - slack && box[2] <= expected[2] + slack && box[3] <= expected[3] + slack;
  const bw = box[2] - box[0], bh = box[3] - box[1];
  const ew = expected[2] - expected[0], eh = expected[3] - expected[1];
  // how much of the rectangle the mark must cover: a filled highlight most of both sides (PDFKit's own highlight is inset about
  // 10% vertically), a line most of its long side whichever way the page is turned, a text note just some glyph pixels
  let covered;
  if (kind === "highlight") covered = bw >= 0.7 * ew && bh >= 0.7 * eh;
  else if (kind === "text") covered = n >= 20;
  else covered = Math.max(bw, bh) >= (kind === "ink" ? 0.8 : 0.9) * Math.max(ew, eh);
  const ok = inside && covered;
  return { n, ok, why: ok ? "" : `box ${box.map((v) => v.toFixed(1))} vs ${expected.map((v) => v.toFixed(1))}` };
}

const ORIGINAL = process.env.ORIGINAL;
const origDoc = ORIGINAL
  ? await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(ORIGINAL)), standardFontDataUrl, isEvalSupported: false, verbosity: 0 }).promise
  : null;

/** Differential check: how many pixels changed inside this mark's rectangle, and how many outside every mark's rectangle. */
function measureDiff(kind, before, after, w, h, boxes, index) {
  const grow = 3 * SCALE;
  const inBox = (x, y, [bx0, by0, bx1, by1]) => x >= bx0 * SCALE - grow && x < bx1 * SCALE + grow && y >= by0 * SCALE - grow && y < by1 * SCALE + grow;
  let inside = 0, outside = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) <= 60) continue;
      if (inBox(x, y, boxes[index])) inside++;
      else if (!boxes.some((b) => inBox(x, y, b))) outside++;
    }
  }
  const [bx0, by0, bx1, by1] = boxes[index];
  const area = (bx1 - bx0) * (by1 - by0) * SCALE * SCALE;
  // a highlight changes the page's white, not its black text, so it only needs a share of its rectangle; the others a few hundred pixels
  const need = kind === "highlight" ? area * 0.03 : 100;
  const ok = inside >= need && outside <= 30;
  return { n: inside, ok, why: ok ? "" : `${inside} px changed inside (need ${Math.round(need)}), ${outside} outside every mark` };
}

let failures = 0;
const rows = [];
const annotKinds = [];
for (const p of markedPages(doc.numPages)) {
  const page = await doc.getPage(p + 1);
  const subtypes = (await page.getAnnotations()).map((a) => a.subtype);
  annotKinds.push(subtypes);

  const results = {};
  for (const viewer of ["pdfjs", "pdfkit"]) {
    const unit = page.userUnit;
    // PDFKit ignores UserUnit; pdf.js scales by it
    const viewport = page.getViewport({ scale: viewer === "pdfjs" ? SCALE : SCALE / unit });
    const mode = flatten ? pdfjs.AnnotationMode.DISABLE : pdfjs.AnnotationMode.ENABLE;
    const pixels = async (which) => {
      if (viewer === "pdfjs") {
        const src = which === "orig" ? await origDoc.getPage(p + 1) : page;
        const w = Math.ceil(viewport.width), h = Math.ceil(viewport.height);
        const canvas = createCanvas(w, h);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
        await src.render({ canvasContext: ctx, viewport, annotationMode: mode }).promise;
        return { data: pixelsOf(ctx, w, h), w, h };
      }
      const img = await loadImage(fs.readFileSync(`${which === "orig" ? process.env.ORIGINAL_DIR : kitDir}/p${p}.png`));
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return { data: pixelsOf(ctx, img.width, img.height), w: img.width, h: img.height };
    };
    const { data, w, h } = await pixels("marked");
    const before = origDoc ? (await pixels("orig")).data : null;
    // each mark's rectangle on this viewer's screen: viewport pixels to points of that viewer's own page (pdf.js scales by
    // UserUnit, PDFKit does not), at SCALE pixels per point
    const boxes = MARKS.map(({ rect: [x0, y0, x1, y1] }) => {
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => viewport.convertToViewportPoint(x, y));
      const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((v) => v / SCALE);
    });
    MARKS.forEach((m, i) => {
      (results[m.kind] ??= {})[viewer] = before ? measureDiff(m.kind, before, data, w, h, boxes, i) : measure(m.kind, data, w, h, boxes[i], SCALE);
    });
  }
  const bad = [];
  for (const m of MARKS) {
    for (const viewer of ["pdfjs", "pdfkit"]) {
      const r = results[m.kind][viewer];
      if (!r.ok) bad.push(`${m.kind}/${viewer}${r.why ? " (" + r.why + ")" : ""}`);
    }
  }
  failures += bad.length;
  const kitKinds = kit.find((k) => k.index === p).annotations.map((a) => a.type);
  rows.push(`${String(p).padStart(2)} ${(names[p] ?? "page").padEnd(28)} ${bad.length === 0 ? "ok" : "FAIL: " + bad.join("; ")}\n     pdf.js reads: ${subtypes.join(",") || "no annotations"}   PDFKit reads: ${kitKinds.join(",") || "no annotations"}`);
}
console.log(rows.join("\n"));
console.log(failures === 0 ? "\nall marks drawn where expected, in both viewers" : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
