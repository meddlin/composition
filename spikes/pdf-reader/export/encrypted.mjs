// Spike D: what each pdf-lib variant does with a password-protected PDF. usage: node export/encrypted.mjs file.pdf [password]
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const bytes = fs.readFileSync(process.argv[2]);
for (const name of ["pdf-lib", "@cantoo/pdf-lib", "@pdfme/pdf-lib"]) {
  const { PDFDocument } = require(name);
  const tries = [["load", {}], ["load, ignoreEncryption", { ignoreEncryption: true }], ["load, password", { password: process.argv[3] ?? "" }]];
  for (const [label, opts] of tries) {
    try {
      const doc = await PDFDocument.load(bytes, { updateMetadata: false, ...opts });
      const out = await doc.save();
      console.log(name.padEnd(16), label.padEnd(24), "saved", out.length, "bytes, encrypted again:", Buffer.from(out).toString("latin1").includes("/Encrypt"));
    } catch (e) {
      console.log(name.padEnd(16), label.padEnd(24), "error:", e.constructor.name, "-", String(e.message).slice(0, 70));
    }
  }
}
