#!/usr/bin/env node
/**
 * Turns the JSON files measure.mjs writes into one table per run, side by side, and lists the hard failures.
 *
 *   node summarize.mjs results/1k.json results/10k.json
 *
 * Prints Markdown (readable in a terminal and fit for a GitHub job summary) and exits 1 if anything hard failed: a step that
 * timed out or crashed, a load that never finished, a run that stopped before its end. Speed is only reported, never failed
 * on: absolute times move with the machine (a CI runner is not a laptop), so a slow number is for a person to read.
 */
import fs from "node:fs";
import path from "node:path";

const find = (run, pattern) => run.steps.find((step) => pattern.test(step.name));
const seconds = (ms) => (ms === undefined || ms === null ? undefined : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
const millis = (ms) => (ms === undefined || ms === null ? undefined : `${Math.round(ms)} ms`);
const megabytes = (kb) => (kb === undefined || kb === null ? undefined : `${(kb / 1024).toFixed(kb < 10 * 1024 ? 1 : 0)} MB`);
const slowest = (run, pattern, pick = (step) => step.ms) => {
  const values = run.steps.filter((step) => pattern.test(step.name) && !step.failed).map(pick).filter((value) => value !== undefined);
  return values.length ? Math.max(...values) : undefined;
};
const load = (run) => run.steps.find((step) => step.name === "load /" && !step.failed);

/** One row per thing worth watching: [label, how to read it from a run]. A row nobody has a value for is left out. */
const ROWS = [
  ["First page (HTML)", (r) => (load(r)?.htmlMB === undefined ? undefined : `${load(r).htmlMB} MB`)],
  ["Until a click works", (r) => seconds(load(r)?.interactiveMs)],
  ["Longest freeze while loading", (r) => seconds(load(r)?.maxLongMs)],
  ["DOM nodes after load", (r) => load(r)?.domNodes?.toLocaleString("en-US")],
  ["JS heap after load", (r) => (load(r)?.jsHeapMB === undefined ? undefined : `${load(r).jsHeapMB} MB`)],
  ["Keystroke, Markdown tab (median)", (r) => millis(find(r, /^typing: Markdown/)?.keyLatencyMs?.p50)],
  ["Keystroke, Split tab (median)", (r) => millis(find(r, /^typing: Split/)?.keyLatencyMs?.p50)],
  ["Keystroke, Live tab (median)", (r) => millis(find(r, /^typing: Live/)?.keyLatencyMs?.p50)],
  ["Link picker keystroke (median)", (r) => millis(find(r, /^link picker/)?.keyLatencyMs?.p50)],
  ["Switch editor tab (slowest)", (r) => seconds(slowest(r, /^tab: -> (Markdown|Split|Live|Preview)$/))],
  ["Open a note (slowest)", (r) => seconds(slowest(r, /^open: /))],
  ["Collapse all groups", (r) => seconds(find(r, /^sidebar: collapse all/)?.ms)],
  ["Expand all groups", (r) => seconds(find(r, /^sidebar: expand all/)?.ms)],
  ["Change the sort (slowest)", (r) => seconds(slowest(r, /^sidebar: sort/))],
  ["Switch notebook (slowest)", (r) => seconds(slowest(r, /^sidebar: switch notebook/))],
  ["Home page", (r) => seconds(find(r, /^page: Home/)?.ms)],
  ["Settings page", (r) => seconds(find(r, /^page: Settings/)?.ms)],
  ["Autosave response", (r) => megabytes(find(r, /^autosave/)?.saves?.[0]?.resKB)],
  ["Autosave round trip", (r) => millis(find(r, /^autosave/)?.saves?.[0]?.ms)],
  ["Main thread blocked by an autosave", (r) => seconds(find(r, /^autosave/)?.blockedMs)],
];

/** What went hard wrong in one run, as short sentences. */
export function failuresOf(run) {
  const problems = [];
  if (run.fatal) problems.push(`the harness itself failed: ${String(run.fatal).split("\n")[0]}`);
  if (!run.finishedAt && !run.fatal) problems.push("the run stopped before its end");
  for (const step of run.steps) if (step.failed) problems.push(`${step.name}: ${step.failed}`);
  return problems;
}

/** The page errors a run logged (a hydration mismatch, say), once each, without the stack. */
export function pageErrorsOf(run) {
  const seen = new Set();
  for (const step of run.steps) for (const error of step.errors ?? []) seen.add(error.replace(/\s+/g, " ").slice(0, 110));
  return [...seen];
}

/**
 * @param {{ label: string, run: { steps: any[], finishedAt?: string, fatal?: string } }[]} runs
 * @returns {{ markdown: string, failures: { label: string, problems: string[] }[] }}
 */
export function summarize(runs) {
  const lines = ["## Stress test", ""];
  const rows = ROWS.map(([name, read]) => [name, runs.map(({ run }) => read(run))]).filter(([, values]) => values.some((v) => v !== undefined));
  if (rows.length) {
    lines.push(`| | ${runs.map(({ label }) => label).join(" | ")} |`, `|---|${runs.map(() => "---:").join("|")}|`);
    for (const [name, values] of rows) lines.push(`| ${name} | ${values.map((v) => v ?? "–").join(" | ")} |`);
    lines.push("");
  }

  const failures = runs.map(({ label, run }) => ({ label, problems: failuresOf(run) })).filter(({ problems }) => problems.length);
  if (failures.length) {
    lines.push("### Failed", "");
    for (const { label, problems } of failures) for (const problem of problems) lines.push(`- **${label}**: ${problem}`);
    lines.push("");
  } else {
    lines.push("Every step completed (no timeouts, crashes or unfinished runs).", "");
  }

  const errors = runs.map(({ label, run }) => ({ label, errors: pageErrorsOf(run) })).filter(({ errors }) => errors.length);
  if (errors.length) {
    lines.push("### Page errors logged", "");
    for (const { label, errors: list } of errors) for (const error of list) lines.push(`- **${label}**: \`${error}\``);
    lines.push("");
  }

  lines.push("Times are one run on this machine: compare sizes within a run, and a run with an earlier one only on the same kind of machine.");
  return { markdown: lines.join("\n"), failures };
}

function readRun(file) {
  try {
    return { label: path.basename(file, ".json"), run: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    return { label: path.basename(file, ".json"), run: { steps: [], fatal: `could not read ${file}: ${error instanceof Error ? error.message : error}` } };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("usage: node summarize.mjs <results.json>...");
    process.exit(2);
  }
  // Smallest database first, so the columns read as a scale.
  const order = (label) => {
    const size = /^(\d+)(k?)/i.exec(label);
    return size ? Number(size[1]) * (size[2] ? 1000 : 1) : Number.MAX_SAFE_INTEGER;
  };
  const runs = files.map(readRun).sort((a, b) => order(a.label) - order(b.label));
  const { markdown, failures } = summarize(runs);
  console.log(markdown);
  process.exit(failures.length ? 1 : 0);
}
