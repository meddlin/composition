// Spike C: do pdf.js and PDFKit agree? usage: node coords/compare.mjs pdfjs.json pdfkit.json   (exit 1 if not)
import fs from "node:fs";

const names = ["plain", "rotate90", "rotate180", "rotate270", "crop", "media-offset", "crop+rotate90", "media-offset+crop+rotate270", "userunit2"];
const js = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const kit = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));

const close = (a, b, tol) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
let failures = 0;
const rows = [];
for (let i = 0; i < js.length; i++) {
  const a = js[i], b = kit[i];
  const checks = {
    // pdf.js view is the crop box clipped to the media box; PDFKit's cropBox is the same, in unrotated page space
    geometry: close(a.view, b.crop, 0.01),
    rotation: a.rotate === b.rotation,
    // where the landmark is drawn, in viewport points (pdf.js scales its viewport by UserUnit, PDFKit does not)
    landmark: close(a.redRectViewport.map((v) => v / a.userUnit), b.redRectViewport, 0.5),
    // the text's raw position: same x and width; pdf.js gives the baseline, PDFKit the line box that holds it
    text: Math.abs(a.text.x - b.text.x) <= 0.5 && Math.abs(a.text.width - b.text.width) <= 0.5 && a.text.y >= b.text.y && a.text.y <= b.text.y + b.text.height,
    pdfjsRawRect: a.redInsideFraction >= 0.98 && a.redOutsideBand === 0 && a.roundTripError < 1e-3,
    pdfkitSquare: b.square.redLeft === 0 && b.square.changedOutsideRect === 0,
    pdfkitHighlight: b.highlightRelative.changedPixels > 0 && b.highlightRelative.changedOutsideRect === 0,
    // a control: the same highlight with page-space quad points must NOT land on the square
    absoluteQuadsMiss: b.highlightAbsolute.changedOutsideRect > 1000,
  };
  const bad = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  failures += bad.length;
  rows.push(`${String(i).padStart(2)} ${names[i].padEnd(28)} ${bad.length === 0 ? "ok" : "FAIL: " + bad.join(", ")}`);
}
console.log(rows.join("\n"));
console.log(`\ntext: pdf.js baseline y=${js[0].text.y}, PDFKit line box y=${kit[0].text.y} to ${(kit[0].text.y + kit[0].text.height).toFixed(2)} (the offset is the descent)`);
console.log(failures === 0 ? "\nall checks pass" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
