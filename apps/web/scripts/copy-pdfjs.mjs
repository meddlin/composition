// Puts the files pdf.js loads at run time where the web app serves them: public/pdfjs/ (served at /pdfjs/, and carried into
// the desktop export). The package is pinned in package.json and its lockfile, so unlike draw.io there is nothing to
// download and nothing to check against a second lock: this copies from node_modules.
//
//   pnpm copy:pdfjs                  into public/pdfjs
//   pnpm copy:pdfjs --out <dir>      somewhere else
//
// The worker runs the parser and the renderer off the page's thread. The CMaps and standard fonts are for PDFs that name a
// font without embedding it or use a CJK encoding. The images are the reader's own icons for annotations. (pdf.js also has
// WebAssembly decoders; the desktop app's CSP does not allow WebAssembly and pdf.js falls back to JavaScript, spike A.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flag = process.argv.indexOf("--out");
const out = path.resolve(process.cwd(), flag === -1 ? path.join(webDir, "public", "pdfjs") : process.argv[flag + 1]);
const pkg = path.join(webDir, "node_modules", "pdfjs-dist");

if (!fs.existsSync(path.join(pkg, "package.json"))) {
  console.error("pdfjs-dist is not installed: run `pnpm install` in apps/web.");
  process.exit(1);
}
const version = JSON.parse(fs.readFileSync(path.join(pkg, "package.json"), "utf-8")).version;

const marker = path.join(out, "VERSION");
if (fs.existsSync(marker) && fs.readFileSync(marker, "utf-8").trim() === version) {
  console.log(`already present (pdf.js ${version}): ${path.relative(process.cwd(), out) || "."}`);
  process.exit(0);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(pkg, "build", "pdf.worker.min.mjs"), path.join(out, "pdf.worker.mjs"));
for (const dir of ["cmaps", "standard_fonts", "iccs"]) fs.cpSync(path.join(pkg, dir), path.join(out, dir), { recursive: true });
fs.cpSync(path.join(pkg, "web", "images"), path.join(out, "images"), { recursive: true });
fs.copyFileSync(path.join(pkg, "LICENSE"), path.join(out, "LICENSE"));
fs.writeFileSync(marker, `${version}\n`);
console.log(`pdf.js ${version} -> ${path.relative(process.cwd(), out) || "."}`);
