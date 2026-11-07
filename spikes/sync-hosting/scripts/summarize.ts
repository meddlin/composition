// Turns the newest result file per scenario into a Markdown table: node scripts/summarize.ts [local|real]
// Writes results/<where>/SUMMARY.md and prints it.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/env.ts";

const where = process.argv[2] ?? "real";
const dir = join(ROOT, "results", where);
const CANDIDATES = ["lean", "postgres", "convex"];

type Json = Record<string, any>;
const latest = new Map<string, Json>(); // "candidate/scenario" -> newest result
for (const c of CANDIDATES) {
  const cdir = join(dir, c);
  if (!existsSync(cdir)) continue;
  for (const f of readdirSync(cdir).filter((x) => x.endsWith(".json")).sort()) {
    const r = JSON.parse(readFileSync(join(cdir, f), "utf8")) as Json;
    latest.set(`${c}/${r.scenario}`, r);
  }
}

const g = (c: string, scenario: string, path: string): unknown => {
  let v: unknown = latest.get(`${c}/${scenario}`)?.metrics;
  for (const k of path.split(".")) v = (v as Json | undefined)?.[k];
  return v;
};
const fmt = (v: unknown, unit = ""): string => (v === undefined || v === null || (typeof v === "number" && Number.isNaN(v)) ? "–" : `${typeof v === "number" ? Math.round(v * 10) / 10 : String(v)}${unit}`);
const passed = (c: string, scenario: string): string => {
  const r = latest.get(`${c}/${scenario}`);
  return r ? (r.checks.every((x: Json) => x.ok) ? "pass" : "FAIL") : "–";
};

const rows: [string, (c: string) => string][] = [
  ["Push ack, typical / p95 (ms)", (c) => `${fmt(g(c, "normal", "ackMs.p50"))} / ${fmt(g(c, "normal", "ackMs.p95"))}`],
  ["Propagation to device B, typical / p95 (ms)", (c) => `${fmt(g(c, "normal", "propagationMs.p50"))} / ${fmt(g(c, "normal", "propagationMs.p95"))}`],
  ["Burst of 500: last edit to B converged (ms); edits per push", (c) => `${fmt(g(c, "burst", "lastEditToConvergedMs"))}; ${fmt(g(c, "burst", "editsPerPush"))}`],
  ["Burst push ack p95 (ms)", (c) => fmt(g(c, "burst", "pushAckMs.p95"))],
  ["First push after idle / warm median (ms)", (c) => `${fmt(g(c, "idle", "afterIdle.ackMs"))} / ${fmt(g(c, "idle", "warmAckMs.p50"))}`],
  ["10 MB first sync: upload (ms) / empty-device pull (ms)", (c) => `${fmt(g(c, "library", "upload.ms"))} / ${fmt(g(c, "library", "initialPull.ms"))}`],
  ["Concurrent pushes: duplicate or out-of-place versions", (c) => `${fmt(g(c, "concurrent", "duplicateVersions"))} / ${fmt(g(c, "concurrent", "versionsOutOfPlace"))}`],
  ["Concurrent pushes: 5xx retries / given up / p95 / max (ms)", (c) => `${fmt(g(c, "concurrent", "retriesOn5xxOrNetwork"))} / ${fmt(g(c, "concurrent", "pushesGivenUp"))} / ${fmt(g(c, "concurrent", "latencyMs.p95"))} / ${fmt(g(c, "concurrent", "latencyMs.max"))}`],
  ["Faults: texts lost / replica divergences", (c) => `${fmt(g(c, "faults", "lostEdits"))} / ${fmt(g(c, "faults", "divergences"))}`],
  ["Kill the API: longest sync pause (ms); edits lost", (c) => `${fmt(g(c, "outage-api", "longestSilentGapMs"))}; ${fmt(g(c, "outage-api", "editsLost"))}`],
  ["Kill the database: longest sync pause (ms); edits lost", (c) => `${fmt(g(c, "outage-database", "longestSilentGapMs"))}; ${fmt(g(c, "outage-database", "editsLost"))}`],
  ["Restore: command (ms); records the server lost; lost for good", (c) => `${fmt(g(c, "restore", "restoreCommandMs"))}; ${fmt(g(c, "restore", "recordsLostByServerInRestore"))}; ${fmt(g(c, "restore", "recordsLostPermanently"))}`],
  ["Restore: devices noticed the new epoch / healed (ms)", (c) => `${fmt(g(c, "restore", "devicesNoticedNewEpochAfterMs"))} / ${fmt(g(c, "restore", "healedAfterMs"))}`],
  ["Restore: epoch rotated by hand?", (c) => fmt(g(c, "restore", "epochRotatedByHandStep") === undefined ? undefined : g(c, "restore", "epochRotatedByHandStep") ? "yes (extra step)" : "no (automatic)")],
];

const out = [`# Scenario results (${where})`, "", `| Measure | ${CANDIDATES.join(" | ")} |`, `|---|${CANDIDATES.map(() => "---").join("|")}|`];
for (const [label, f] of rows) out.push(`| ${label} | ${CANDIDATES.map(f).join(" | ")} |`);
out.push("", "Checks: " + ["normal", "burst", "library", "concurrent", "faults", "idle", "outage-api", "outage-database", "restore"].map((s) => `${s} ${CANDIDATES.map((c) => `${c}=${passed(c, s)}`).join(" ")}`).join("; "));
const when = [...latest.values()].map((r) => r.startedAt as string).sort();
if (when.length) out.push("", `Runs from ${when[0]} to ${when.at(-1)}. Raw files sit beside this one.`);
writeFileSync(join(dir, "SUMMARY.md"), out.join("\n") + "\n");
console.log(out.join("\n"));
