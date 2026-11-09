#!/usr/bin/env node
// Runs the cases in excel-verified-cases.json in real Microsoft Excel (macOS) and writes what Excel returned
// back into the file. Excel, not a reading of its documentation, is the spec for the formula engine.
//
//   node spikes/sheet/run-in-excel.mjs              fill in the cases that have no result yet
//   node spikes/sheet/run-in-excel.mjs --all        run every case again and report any that changed
//   node spikes/sheet/run-in-excel.mjs --dry-run    print the AppleScript, run nothing
//
// It builds the file's `cells` in a NEW workbook, enters each case's formula in a cell of its own with
// `formula2` (Excel's dynamic-array mode, which is what `=SUM(B1:B3*2)` needs), reads the results back and
// closes the workbook without saving. Nothing you have open is touched. Excel must be installed; the first run
// asks macOS for permission to control it.
//
// File format (the engine's tests read the same file):
//   cells   address -> a number, a boolean, a string, { "text": "1" } for a number stored as text, or
//           { "formula": "=B1+1" } for a cell that is itself a formula.
//   ranges  name -> A1 range, used in a case's formula as {NAME}.
//   cases   { label, formula, excel }. `excel` is what Excel returned: a number, a string, a boolean, or
//           { "error": "#N/A" }. Leave it out for a new case; this script fills it in.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("./excel-verified-cases.json", import.meta.url);
const args = new Set(process.argv.slice(2));
const spec = JSON.parse(readFileSync(FILE, "utf8"));

const ERROR_NAMES = { 1: "#NULL!", 2: "#DIV/0!", 3: "#VALUE!", 4: "#REF!", 5: "#NAME?", 6: "#NUM!", 7: "#N/A" };
// A result may itself contain a line break, so each one ends with this instead.
const END = "<<end>>";
const RAW_COLUMN = "AY";
const RESULT_COLUMN = "AZ";

const quote = (text) => `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const expand = (formula) => formula.replace(/\{(\w+)\}/g, (_, name) => {
  if (!spec.ranges[name]) throw new Error(`Unknown range {${name}}`);
  return spec.ranges[name];
});
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const todo = spec.cases.map((c, index) => ({ c, index })).filter(({ c }) => args.has("--all") || c.excel === undefined);
if (todo.length === 0) {
  console.log("Every case already has a result. Use --all to run them again.");
  process.exit(0);
}

const lines = ['tell application "Microsoft Excel"', "  set display alerts to false", "  set wb to make new workbook", "  set ws to active sheet of wb"];
for (const [address, cell] of Object.entries(spec.cells)) {
  const range = `range "${address}" of ws`;
  if (typeof cell === "object" && cell.formula) lines.push(`  set formula2 of ${range} to ${quote(cell.formula)}`);
  else if (typeof cell === "object" && cell.text !== undefined) lines.push(`  set number format of ${range} to "@"`, `  set value of ${range} to ${quote(cell.text)}`);
  else if (typeof cell === "number" || typeof cell === "boolean") lines.push(`  set value of ${range} to ${cell}`);
  else lines.push(`  set value of ${range} to ${quote(cell)}`);
}

// Each case's formula goes in a cell of its own, and a second cell tags what it returned with its type and Excel's
// own text for it: a number keeps its 15 digits, a text that looks like a number stays text, and an error says which
// one. (The formula is kept out of the tagging one: Excel silently drops a long formula that repeats a long one.)
todo.forEach(({ c }, row) => {
  const raw = `${RAW_COLUMN}${row + 1}`;
  const tagged = `${RESULT_COLUMN}${row + 1}`;
  const tag = `=IF(ISERROR(${raw}),"e:"&ERROR.TYPE(${raw}),IF(ISNUMBER(${raw}),"n:"&${raw},IF(ISLOGICAL(${raw}),"b:"&${raw},"s:"&${raw})))`;
  lines.push(`  try`, `    set formula2 of range "${raw}" of ws to ${quote(`=${expand(c.formula)}`)}`, `    set formula2 of range "${tagged}" of ws to ${quote(tag)}`, `  end try`);
});
lines.push('  set out to ""');
lines.push(`  repeat with i from 1 to ${todo.length}`);
lines.push(`    set kept to has formula of range ("${RAW_COLUMN}" & i) of ws`);
lines.push(`    if kept then`);
lines.push(`      set out to out & (value2 of range ("${RESULT_COLUMN}" & i) of ws as text) & "${END}"`);
lines.push(`    else`);
lines.push(`      set out to out & "x:" & "${END}"`);
lines.push(`    end if`);
lines.push("  end repeat");
lines.push('  set out to out & "VERSION:" & (version as text) & "' + END + '"');
lines.push("  close wb saving no");
lines.push("  return out");
lines.push("end tell");
const script = lines.join("\n");

if (args.has("--dry-run")) {
  console.log(script);
  process.exit(0);
}

const run = spawnSync("osascript", ["-e", script], { encoding: "utf8", timeout: 180_000 });
if (run.status !== 0) {
  console.error(run.stderr || run.error?.message || "osascript failed");
  process.exit(1);
}

const output = run.stdout.replace(/\n$/, "").split(END);
output.pop();
const version = output.pop()?.replace(/^VERSION:/, "") ?? "unknown";
if (output.length !== todo.length) {
  console.error(`Expected ${todo.length} results, got ${output.length}.`);
  process.exit(1);
}

let changed = 0;
todo.forEach(({ c }, row) => {
  const line = output[row];
  const tag = line.slice(0, 2);
  const text = line.slice(2);
  let result;
  if (tag === "n:") result = Number(text);
  else if (tag === "b:") result = text === "TRUE";
  else if (tag === "e:") result = { error: ERROR_NAMES[Number(text)] ?? `#ERROR.TYPE(${text})` };
  else if (tag === "s:") result = text;
  else {
    console.error(`  rejected by Excel: ${c.label}: ${c.formula}`);
    return;
  }
  if (c.excel !== undefined && !equal(c.excel, result)) {
    changed++;
    console.log(`  CHANGED ${c.label}: ${JSON.stringify(c.excel)} -> ${JSON.stringify(result)}`);
  }
  c.excel = result;
});

spec.excelVersion = `${version} (Microsoft Excel for Mac, run ${new Date().toISOString().slice(0, 10)})`;
writeFileSync(FILE, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`Ran ${todo.length} case(s) in Excel ${version}${changed ? `; ${changed} changed` : ""}.`);
