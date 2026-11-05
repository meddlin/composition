// Turns the spike's results into a Markdown table for the job summary ($GITHUB_STEP_SUMMARY) and the log.
//   SPIKE_RESULTS   the JSON lines the checks appended
//   STEP_OUTCOMES   JSON: { "<label>": "success" | "failure" | "skipped" | "cancelled", ... } for the steps that ran a tool
//   SPIKE_OUT       folder holding the unit-test logs (web.log, desktop.log, ...); their "Tests" lines are quoted
//   SPIKE_TITLE     heading, e.g. the runner image
import fs from "node:fs";
import path from "node:path";

const lines = [];
const title = process.env.SPIKE_TITLE ?? "Windows spike";
lines.push(`## ${title}`, "");

const results = [];
try {
  for (const line of fs.readFileSync(process.env.SPIKE_RESULTS ?? "", "utf-8").split("\n")) if (line.trim()) results.push(JSON.parse(line));
} catch {
  lines.push("_No check results were recorded._", "");
}

if (results.length > 0) {
  lines.push("| Result | Check | Detail |", "|---|---|---|");
  for (const { check, ok, detail } of results) {
    const mark = ok === null ? "ℹ️" : ok ? "✅" : "❌";
    lines.push(`| ${mark} | ${check} | ${detail.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
}

const outcomes = JSON.parse(process.env.STEP_OUTCOMES ?? "{}");
if (Object.keys(outcomes).length > 0) {
  lines.push("| Step | Outcome |", "|---|---|");
  for (const [step, outcome] of Object.entries(outcomes)) lines.push(`| ${step} | ${outcome === "success" ? "✅" : outcome === "skipped" ? "⏭️" : "❌"} ${outcome} |`);
  lines.push("");
}

const outDir = process.env.SPIKE_OUT;
if (outDir && fs.existsSync(outDir)) {
  const quoted = [];
  for (const file of fs.readdirSync(outDir).filter((name) => name.endsWith(".log")).sort()) {
    const text = fs.readFileSync(path.join(outDir, file), "utf-8").replace(/\x1b\[[0-9;]*m/g, "");
    const found = text.split("\n").filter((line) => /^\s*(Test Files|Tests)\s+/.test(line) || /^# (pass|fail|tests)\b/.test(line));
    if (found.length > 0) quoted.push(`**${file}**`, "```", ...found.map((line) => line.trim()), "```");
  }
  if (quoted.length > 0) lines.push("### Unit test totals", "", ...quoted, "");
}

const text = `${lines.join("\n")}\n`;
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
