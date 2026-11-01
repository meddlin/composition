// The fixture behind the to-do manual test (docs/manual-tests/todo-archival.md).
//
//   pnpm manual:todo setup --scenario behind|first-run|archive|retention [--weeks N] [--keep MONTHS|forever] [--home DIR]
//   pnpm manual:todo age --weeks N [--home DIR]
//   pnpm manual:todo report [--home DIR]
//   pnpm manual:todo launch [--home DIR]
//
// It works on a scratch home (default /tmp/composition-manual-todo), never your real notes: the database is
// <home>/.composition and the app's settings are <home>/userData, which is where `COMPOSITION_DEV_HOME` makes the
// development app look. `setup` refuses a database that already holds to-dos.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webModules = path.resolve(desktopDir, "..", "web", "node_modules");

const [command, ...rest] = process.argv.slice(2);
const option = (name) => {
  const at = rest.indexOf(`--${name}`);
  return at >= 0 ? rest[at + 1] : undefined;
};
const home = path.resolve(option("home") ?? path.join(os.tmpdir(), "composition-manual-todo"));

const usage = `Usage: pnpm manual:todo <command> [options]

  setup  --scenario behind|first-run|archive|retention [--weeks N] [--keep MONTHS|forever] [--home DIR]
         behind      N weeks (default 3) have ended since the app last ran, with work in each
         first-run   a database from before the weekly cycle: completed items with no history
         archive     archived items of every kind, up to date, and a report that mentions one
         retention   removed items 6 and 18 months and 3, 4.5 and 6 years old
         --keep      also sets how long archived items are kept, so the first launch purges at once
  age    --weeks N [--home DIR]    pretend N more weeks went by (closes that many at the next launch)
  report [--home DIR]              print what the database holds, to compare with the app
  launch [--home DIR]              print the command that starts the app on that home

The default home is ${path.join(os.tmpdir(), "composition-manual-todo")}.`;

if (command === "launch") {
  console.log(`COMPOSITION_DEV_HOME=${home} pnpm --dir apps/desktop dev`);
  process.exit(0);
}
if (!["setup", "age", "report"].includes(command)) {
  console.error(command ? `Unknown command "${command}".\n` : "");
  console.error(usage);
  process.exit(command ? 2 : 0);
}

// The tool is TypeScript that reaches into apps/web, so it is bundled for the run; better-sqlite3 stays a real module.
fs.mkdirSync(path.join(home, "userData"), { recursive: true });
const bundle = path.join(os.tmpdir(), "composition-todo-manual-tool.cjs");
await build({
  entryPoints: [path.join(desktopDir, "src", "tools", "todoManualRun.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["better-sqlite3"],
  outfile: bundle,
  logLevel: "error",
});

const result = spawnSync(process.execPath, [bundle, command, ...rest], {
  stdio: "inherit",
  env: {
    ...process.env,
    HOME: home,
    COMPOSITION_SETTINGS_PATH: path.join(home, "userData", "settings.json"),
    NODE_PATH: webModules,
  },
});
process.exit(result.status ?? 1);
