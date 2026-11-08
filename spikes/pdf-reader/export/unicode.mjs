// Spike D: can a text note in any script be written into the page? A standard PDF font only has WinAnsi, so a custom font is
// embedded through fontkit. usage: node export/unicode.mjs font.ttf out.pdf   (the font here is only the one at hand for the test)
import fs from "node:fs";
import { createRequire } from "node:module";
import * as fontkit from "fontkit";
const require = createRequire(import.meta.url);
const { PDFDocument, rgb } = require("@cantoo/pdf-lib");
const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const subset = await doc.embedFont(fs.readFileSync(process.argv[2]), { subset: true });
const page = doc.addPage([400, 200]);
const text = "Café ≤ Привет 日本語";
page.drawText(text, { x: 20, y: 150, size: 18, font: subset, color: rgb(0, 0, 0) });
const bytes = await doc.save();
fs.writeFileSync(process.argv[3], bytes);
console.log(JSON.stringify({ text, widthWithFont: subset.widthOfTextAtSize(text, 18).toFixed(1), subsetPdfKB: Math.round(bytes.length / 1024), fullFontFileKB: Math.round(fs.statSync(process.argv[2]).size / 1024) }));
