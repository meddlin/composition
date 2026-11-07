#!/usr/bin/env node
// What is an .xlsx workbook made of, and how heavy are its formulas?
//
//   node spikes/sheet/inventory.mjs book.xlsx [more.xlsx ...] [--json]
//
// Prints only NUMBERS and Excel FUNCTION NAMES. It never prints a cell value, a sheet name, a table
// name, a defined name or a file path, so its output is safe to paste into a chat. (A function name
// can only give something away if your workbook uses a custom function with a revealing name.)
//
// No dependencies: the file is read with node:zlib, and nothing is written, executed or sent
// anywhere. Macros (vbaProject.bin) are counted, never opened.

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const MAX_ENTRY_BYTES = 512 * 1024 * 1024; // a guard against zip bombs

// ---------- reading the zip ----------
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file (an .xlsx is one)");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error("zip64 files are not supported");
  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("the zip's directory is damaged");
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    entries.set(buf.toString("utf8", p + 46, p + 46 + nameLen), {
      method: buf.readUInt16LE(p + 10),
      csize: buf.readUInt32LE(p + 20),
      usize: buf.readUInt32LE(p + 24),
      offset: buf.readUInt32LE(p + 42),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  if (entry.usize > MAX_ENTRY_BYTES) throw new Error("a part of the file is larger than 512 MB; not reading it");
  const p = entry.offset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error("the zip is damaged");
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + entry.csize);
  if (entry.method === 0) return data.toString("utf8");
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }).toString("utf8");
  throw new Error(`unsupported compression method ${entry.method}`);
}

// ---------- reading formulas ----------
const unescapeXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const FAMILIES = {
  "conditional aggregation": ["SUMIF", "SUMIFS", "COUNTIF", "COUNTIFS", "AVERAGEIF", "AVERAGEIFS", "MAXIFS", "MINIFS", "SUMPRODUCT", "DSUM", "DCOUNT", "AGGREGATE", "SUBTOTAL"],
  lookup: ["VLOOKUP", "HLOOKUP", "XLOOKUP", "XMATCH", "LOOKUP", "INDEX", "MATCH", "CHOOSE", "OFFSET", "INDIRECT"],
  "dynamic array (Excel 365)": ["FILTER", "SORT", "SORTBY", "UNIQUE", "SEQUENCE", "RANDARRAY", "LET", "LAMBDA", "MAP", "REDUCE", "SCAN", "BYROW", "BYCOL", "TEXTSPLIT", "VSTACK", "HSTACK", "TAKE", "DROP", "TOCOL", "TOROW", "CHOOSECOLS", "CHOOSEROWS", "EXPAND", "WRAPCOLS", "WRAPROWS"],
  "changes by itself (volatile)": ["TODAY", "NOW", "RAND", "RANDBETWEEN", "OFFSET", "INDIRECT", "CELL", "INFO"],
  "dates and times": ["DATE", "DATEVALUE", "DAY", "MONTH", "YEAR", "EOMONTH", "EDATE", "DATEDIF", "NETWORKDAYS", "NETWORKDAYS.INTL", "WORKDAY", "WEEKDAY", "WEEKNUM", "TIME", "HOUR", "MINUTE", "SECOND", "YEARFRAC", "TODAY", "NOW"],
  text: ["LEFT", "RIGHT", "MID", "LEN", "TRIM", "UPPER", "LOWER", "PROPER", "TEXT", "VALUE", "SUBSTITUTE", "REPLACE", "FIND", "SEARCH", "CONCAT", "CONCATENATE", "TEXTJOIN", "TEXTBEFORE", "TEXTAFTER"],
  finance: ["PMT", "IPMT", "PPMT", "NPV", "XNPV", "IRR", "XIRR", "MIRR", "FV", "PV", "RATE", "NPER", "SLN", "DB", "DDB"],
};

function emptyStats() {
  return {
    sheets: 0, hiddenSheets: 0, definedNames: 0, externalLinks: 0, tables: 0, pivotTables: 0, pivotCaches: 0, charts: 0, slicers: 0,
    macros: false, comments: 0,
    cells: 0, formulaCells: 0, sharedCopies: 0, arrayFormulas: 0, dynamicArrayCells: 0, dataTableFormulas: 0, withCachedValue: 0, cachedErrors: 0,
    mergedRanges: 0, conditionalFormats: 0, dataValidations: 0,
    crossSheet: 0, externalWorkbook: 0, structuredRefs: 0, wholeColumn: 0,
    largestRows: 0, largestCols: 0,
    functions: {},
  };
}

const colToNumber = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

function analyseFormula(text, s) {
  // Take string literals and quoted sheet names out first: they can hold anything.
  const clean = text.replace(/"(?:[^"]|"")*"/g, '""').replace(/'(?:[^']|'')+'!/g, "S!");
  if (/\[\d+\][^!]*!/.test(clean)) s.externalWorkbook++;
  else if (clean.includes("!")) s.crossSheet++;
  if (/[A-Za-z_][A-Za-z0-9_.]*\[|\[@/.test(clean.replace(/\[\d+\]/g, ""))) s.structuredRefs++;
  if (/(?<![A-Za-z0-9_.])\$?[A-Z]{1,3}:\$?[A-Z]{1,3}(?![A-Za-z0-9_(])/.test(clean)) s.wholeColumn++;
  for (const m of clean.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\(/g)) {
    const name = m[1].toUpperCase().replace(/^_XLFN\./, "").replace(/^_XLWS\./, "").replace(/^_XLFN\./, "");
    s.functions[name] = (s.functions[name] ?? 0) + 1;
  }
}

function analyse(path) {
  const buf = readFileSync(path);
  const zip = readZip(buf);
  const names = [...zip.keys()];
  const s = emptyStats();
  const count = (re) => names.filter((n) => re.test(n)).length;

  s.externalLinks = count(/^xl\/externalLinks\/externalLink\d+\.xml$/);
  s.tables = count(/^xl\/tables\/table\d+\.xml$/);
  s.pivotTables = count(/^xl\/pivotTables\/pivotTable\d+\.xml$/);
  s.pivotCaches = count(/^xl\/pivotCache\/pivotCacheDefinition\d+\.xml$/);
  s.charts = count(/^xl\/charts\/chart\d+\.xml$/);
  s.slicers = count(/^xl\/slicers\/slicer\d+\.xml$/);
  s.comments = count(/^xl\/(comments\d*\.xml|threadedComments\/)/);
  s.macros = zip.has("xl/vbaProject.bin");

  if (zip.has("xl/workbook.xml")) {
    const wb = readEntry(buf, zip.get("xl/workbook.xml"));
    s.sheets = (wb.match(/<sheet\s/g) ?? []).length;
    s.hiddenSheets = (wb.match(/<sheet\s[^>]*state="(?:hidden|veryHidden)"/g) ?? []).length;
    s.definedNames = (wb.match(/<definedName\s(?![^>]*name="_xlnm\.)/g) ?? []).length;
  }

  for (const name of names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
    const xml = readEntry(buf, zip.get(name));
    s.cells += (xml.match(/<c\s/g) ?? []).length;
    s.cachedErrors += (xml.match(/<c\s[^>]*t="e"/g) ?? []).length;
    s.dynamicArrayCells += (xml.match(/<c\s[^>]*\bcm="/g) ?? []).length;
    s.mergedRanges += (xml.match(/<mergeCell\s/g) ?? []).length;
    s.conditionalFormats += (xml.match(/<conditionalFormatting\s/g) ?? []).length;
    s.dataValidations += (xml.match(/<dataValidation\s/g) ?? []).length;
    s.withCachedValue += (xml.match(/(?:<\/f>|<f\b[^>]*\/>)\s*<v>/g) ?? []).length;

    const dim = xml.match(/<dimension\s+ref="\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?"/);
    if (dim) {
      const rows = Number(dim[4] ?? dim[2]) - Number(dim[2]) + 1;
      const cols = colToNumber(dim[3] ?? dim[1]) - colToNumber(dim[1]) + 1;
      s.largestRows = Math.max(s.largestRows, rows);
      s.largestCols = Math.max(s.largestCols, cols);
    }

    for (const m of xml.matchAll(/<f((?:\s[^>]*?)?)(?:\/>|>([\s\S]*?)<\/f>)/g)) {
      s.formulaCells++;
      const attrs = m[1] ?? "";
      if (/t="array"/.test(attrs)) s.arrayFormulas++;
      if (/t="dataTable"/.test(attrs)) s.dataTableFormulas++;
      if (m[2] === undefined || m[2] === "") {
        if (/t="shared"/.test(attrs)) s.sharedCopies++; // a copy of a formula written out once elsewhere
        continue;
      }
      analyseFormula(unescapeXml(m[2]), s);
    }
  }
  return s;
}

// ---------- output ----------
const n = (x) => x.toLocaleString("en-US");
const sum = (all, key) => all.reduce((t, s) => t + s[key], 0);

function describe(s, title) {
  const out = [title];
  out.push(`  sheets: ${s.sheets}${s.hiddenSheets ? ` (${s.hiddenSheets} hidden)` : ""}   cells: ${n(s.cells)}   formula cells: ${n(s.formulaCells)} (${n(s.sharedCopies)} are copies of a shared formula)`);
  out.push(`  most rows in a sheet: ${n(s.largestRows)}   most columns in a sheet: ${n(s.largestCols)}`);
  out.push(`  tables: ${s.tables}   pivot tables: ${s.pivotTables}   charts: ${s.charts}   slicers: ${s.slicers}   named ranges: ${s.definedNames}   external links: ${s.externalLinks}   macros: ${s.macros ? "yes" : "no"}`);
  out.push(`  formulas that: point at another sheet ${n(s.crossSheet)} | at another workbook ${n(s.externalWorkbook)} | use table (structured) references ${n(s.structuredRefs)} | use whole-column references ${n(s.wholeColumn)}`);
  out.push(`  dynamic-array cells: ${n(s.dynamicArrayCells)}   array formulas: ${n(s.arrayFormulas)}   data tables: ${n(s.dataTableFormulas)}   conditional formats: ${n(s.conditionalFormats)}   data validations: ${n(s.dataValidations)}   merged ranges: ${n(s.mergedRanges)}`);
  out.push(`  cached values: ${n(s.withCachedValue)} of ${n(s.formulaCells)} formula cells have one; cached errors in the file: ${n(s.cachedErrors)}`);
  return out.join("\n");
}

function functionReport(functions) {
  const entries = Object.entries(functions).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const out = ["Functions used (by formula text, copies of shared formulas not counted):"];
  out.push("  " + (entries.map(([name, c]) => `${name} ${n(c)}`).join(", ") || "none"));
  out.push("By family:");
  for (const [family, names] of Object.entries(FAMILIES)) {
    const used = names.filter((f) => functions[f]).map((f) => `${f} ${n(functions[f])}`);
    if (used.length) out.push(`  ${family}: ${used.join(", ")}`);
  }
  return out.join("\n");
}

const args = process.argv.slice(2);
const json = args.includes("--json");
const files = args.filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.error("usage: node inventory.mjs book.xlsx [more.xlsx ...] [--json]");
  process.exit(2);
}

const all = [];
const report = [];
files.forEach((file, i) => {
  try {
    const s = analyse(file);
    all.push(s);
    report.push({ workbook: i + 1, ...s });
    if (!json) console.log(describe(s, `Workbook ${i + 1}`) + "\n");
  } catch (e) {
    console.log(`Workbook ${i + 1}: could not be read (${e.message})\n`);
  }
});

const total = {};
for (const s of all) for (const [f, c] of Object.entries(s.functions)) total[f] = (total[f] ?? 0) + c;
if (json) console.log(JSON.stringify({ workbooks: report, functions: total }, null, 2));
else if (all.length) {
  if (all.length > 1) console.log(`All ${all.length} workbooks: ${n(sum(all, "formulaCells"))} formula cells, ${sum(all, "pivotTables")} pivot tables, ${sum(all, "tables")} tables\n`);
  console.log(functionReport(total));
}
