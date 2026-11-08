// Spike C, pdf.js side. usage: node coords/pdfjs.mjs geometry.pdf > pdfjs.json
// Each page has a red square at raw user-space (100,100)-(150,150) and the text ANCHOR TEXT with its baseline at (100,300).
// For every page: what geometry pdf.js reports, where it puts the raw rectangle on a rendered canvas (is that spot red?),
// whether the rectangle survives a round trip through viewport coordinates, and where it says the text is in raw space.
import fs from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const SCALE = 2;
const LANDMARK = [100, 100, 150, 150];
// SPIKE_NEGATIVE=1 is a control: use the rectangle relative to the crop box's lower-left corner as if it were raw, to show the
// test can fail (it should, on every page whose crop box does not start at 0,0).
const NEGATIVE = process.env.SPIKE_NEGATIVE === "1";
const isRed = (d, i) => d[i] > 200 && d[i + 1] < 80 && d[i + 2] < 80;
const standardFontDataUrl = new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname;

const doc = await pdfjs.getDocument({
  data: new Uint8Array(fs.readFileSync(process.argv[2])),
  standardFontDataUrl,
  isEvalSupported: false,
  verbosity: 0,
}).promise;

const sorted = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
const out = [];
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const viewport = page.getViewport({ scale: SCALE });
  const RAW = NEGATIVE ? [LANDMARK[0] - page.view[0], LANDMARK[1] - page.view[1], LANDMARK[2] - page.view[0], LANDMARK[3] - page.view[1]] : LANDMARK;
  // this pdf.js has no convertToViewportRectangle: convert the four corners and take their extent (a 90 degree turn swaps axes)
  const corners = [[RAW[0], RAW[1]], [RAW[2], RAW[1]], [RAW[2], RAW[3]], [RAW[0], RAW[3]]].map(([x, y]) => viewport.convertToViewportPoint(x, y));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const [vx0, vy0, vx1, vy1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];

  const back = sorted(viewport.convertToPdfPoint(vx0, vy0), viewport.convertToPdfPoint(vx1, vy1));
  const roundTrip = Math.max(...back.map((v, i) => Math.abs(v - RAW[i])));

  const w = Math.ceil(viewport.width);
  const h = Math.ceil(viewport.height);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const d = ctx.getImageData(0, 0, w, h).data;

  // red pixels in the converted rectangle (shrunk 2 px for antialiasing) and in a 3 px band around it
  let inside = 0, insideTotal = 0, band = 0;
  for (let y = Math.max(0, Math.floor(vy0) - 3); y < Math.min(h, Math.ceil(vy1) + 3); y++) {
    for (let x = Math.max(0, Math.floor(vx0) - 3); x < Math.min(w, Math.ceil(vx1) + 3); x++) {
      const i = (y * w + x) * 4;
      const within = x >= vx0 + 2 && x < vx1 - 2 && y >= vy0 + 2 && y < vy1 - 2;
      if (within) {
        insideTotal += 1;
        if (isRed(d, i)) inside += 1;
      } else if (isRed(d, i) && !(x >= vx0 - 1 && x < vx1 + 1 && y >= vy0 - 1 && y < vy1 + 1)) {
        band += 1;
      }
    }
  }

  const item = (await page.getTextContent()).items.find((it) => it.str.includes("ANCHOR"));
  out.push({
    index: n - 1,
    view: page.view,
    rotate: page.rotate,
    userUnit: page.userUnit,
    viewportSize: [viewport.width / SCALE, viewport.height / SCALE],
    redRectViewport: [vx0 / SCALE, vy0 / SCALE, vx1 / SCALE, vy1 / SCALE].map((v) => Math.round(v * 100) / 100),
    redInsideFraction: Math.round((inside / insideTotal) * 1000) / 1000,
    redOutsideBand: band,
    roundTripError: Math.round(roundTrip * 1e6) / 1e6,
    text: item ? { x: item.transform[4], y: item.transform[5], width: item.width, height: item.height } : null,
  });
}
console.log(JSON.stringify(out, null, 1));
