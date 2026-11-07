// Scenario runner.
//   pnpm scenario normal --candidate lean
//   pnpm scenario all                     # the measurement scenarios that need no external commands
//   pnpm scenario outage --candidate lean --down-cmd "..." --up-cmd "..."
// Results are written to results/<local|real>/<candidate>/<scenario>-<timestamp>.json (--no-write to skip).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { burst } from "./burst.ts";
import { Context, type Result } from "./common.ts";
import { concurrent } from "./concurrent.ts";
import { faults } from "./faults.ts";
import { idle } from "./idle.ts";
import { library } from "./library.ts";
import { normal } from "./normal.ts";
import { outage } from "./outage.ts";
import { restore } from "./restore.ts";

const SCENARIOS: Record<string, (ctx: Context) => Promise<Result>> = { normal, burst, library, concurrent, faults, idle, outage, restore };
const MEASURED = ["normal", "burst", "library", "concurrent", "faults"];

// --key value, --key=value, or a bare --flag; anything else is a scenario name.
const values: Record<string, string | boolean> = {};
const positionals: string[] = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (!arg.startsWith("--")) {
    positionals.push(arg);
    continue;
  }
  const eq = arg.indexOf("=");
  if (eq > 0) values[arg.slice(2, eq)] = arg.slice(eq + 1);
  else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) values[arg.slice(2)] = argv[++i]!;
  else values[arg.slice(2)] = true;
}
const names = positionals[0] === "all" ? MEASURED : positionals.length ? positionals : MEASURED;
for (const n of names) if (!SCENARIOS[n]) throw new Error(`unknown scenario ${n}; known: ${Object.keys(SCENARIOS).join(", ")}`);

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let failed = 0;
for (const name of names) {
  const ctx = new Context(values as Record<string, string | boolean | undefined>);
  await ctx.init();
  console.log(`\n▶ ${name} against ${ctx.candidate} ${ctx.baseUrl} (${ctx.where})`);
  let result: Result;
  try {
    result = await SCENARIOS[name]!(ctx);
  } catch (err) {
    result = {
      scenario: name, candidate: ctx.candidate, baseUrl: ctx.baseUrl, where: ctx.where, serverKind: ctx.info.server,
      startedAt: new Date().toISOString(), finishedAt: "", params: {}, metrics: {},
      checks: [{ name: "scenario ran to completion", ok: false, detail: err instanceof Error ? (err.stack ?? err.message) : String(err) }], notes: [],
    };
  } finally {
    ctx.finish();
  }
  result.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(result.metrics, null, 2));
  for (const c of result.checks) console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  for (const n of result.notes) console.log(`  note: ${n}`);
  if (result.checks.some((c) => !c.ok)) failed += 1;
  if (!values["no-write"]) {
    const dir = join(root, "results", result.where, String(result.candidate));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${result.scenario}-${result.startedAt.replace(/[-:]/g, "").replace(/\..*/, "")}.json`);
    writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
    console.log(`  wrote ${file.replace(root + "/", "")}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
