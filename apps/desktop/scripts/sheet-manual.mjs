// The fixture behind the sheet manual test (docs/manual-tests/sheet.md).
//
//   pnpm manual:sheet setup [--home DIR]
//   pnpm manual:sheet check BOOK.xlsx [MORE.xlsx ...] [--names]
//   pnpm manual:sheet launch [--home DIR]
//
// `setup` works on a scratch home (default <tmp>/composition-manual-sheet), never your real notes: the database is
// <home>/.composition, the app's settings are <home>/userData (where `COMPOSITION_DEV_HOME` makes the development app look), and
// the workbooks to import are in <home>/workbooks. It refuses a database that already holds notes. `check` reads your own
// workbooks and touches no database.
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
const defaultHome = path.join(os.tmpdir(), "composition-manual-sheet");
const home = path.resolve(option("home") ?? defaultHome);

const usageText = `Usage: pnpm manual:sheet <command> [options]

  setup  [--home DIR]
         makes three notes (a tour of sheets, a note to promote and paste in, an imported sheet to re-import) and the
         workbooks to import: orders.xlsx, carried.xlsx, old-1904.xlsx, big.xlsx, and two files that are not workbooks
  check  BOOK.xlsx [MORE.xlsx ...] [--names]
         what an import of each sheet of your workbooks would do: how many formulas stay formulas, are carried, or become
         values, and why. It prints counts and function names, never a cell; sheet names only with --names
  launch [--home DIR]
         print the commands that start the desktop app, the web app or the terminal app on that home

The default home is `;
// Kept apart from the help text above: a template literal with <command> and a ${...} reads as HTML to opengrep.
const usage = usageText + defaultHome + ".";

if (command === "launch") {
  console.log("The desktop app:");
  console.log(`  COMPOSITION_DEV_HOME=${home} pnpm --dir apps/desktop dev`);
  console.log("The web app, at http://localhost:3000:");
  console.log(`  HOME=${home} COMPOSITION_SETTINGS_PATH=${path.join(home, "userData", "settings.json")} pnpm --dir apps/web dev`);
  console.log("The terminal app:");
  console.log(`  COMPOSITION_DEV_HOME=${home} pnpm --dir apps/cli dev`);
  process.exit(0);
}
if (!["setup", "check"].includes(command)) {
  console.error(command ? `Unknown command "${command}".\n` : "");
  console.error(usage);
  process.exit(command ? 2 : 0);
}

// The tool is TypeScript that reaches into apps/web, so it is bundled for the run; better-sqlite3 stays a real module.
fs.mkdirSync(path.join(home, "userData"), { recursive: true });
const bundle = path.join(os.tmpdir(), "composition-sheet-manual-tool.cjs");
await build({
  entryPoints: [path.join(desktopDir, "src", "tools", "sheetManualRun.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["better-sqlite3"],
  outfile: bundle,
  logLevel: "error",
});

// `check` takes paths as typed, so they are made absolute here, against where the command was run (pnpm runs a root script there).
const args = command === "check" ? rest.map((arg, i) => (arg.startsWith("--") || rest[i - 1] === "--home" ? arg : path.resolve(arg))) : rest;
const result = spawnSync(process.execPath, [bundle, command, ...args, ...(command === "setup" ? ["--home", home] : [])], {
  stdio: "inherit",
  env: {
    ...process.env,
    HOME: home,
    COMPOSITION_SETTINGS_PATH: path.join(home, "userData", "settings.json"),
    NODE_PATH: webModules,
  },
});
process.exit(result.status ?? 1);
