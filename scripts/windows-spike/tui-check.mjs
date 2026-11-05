// Runs the real terminal app inside a pseudo-console (ConPTY on Windows) and looks at what it drew.
//
//   NODE_EXE=<node 26>  CLI_DIR=<apps/cli>  HARNESS_DIR=<dir with node-pty and @xterm/headless installed>
//   SPIKE_DIR=<scratch>  [MEILI_BIN=<meilisearch>]  node tui-check.mjs
//
// The app runs on NODE_EXE with a scratch home, so it creates its own settings and database. We feed the
// bytes it writes into a headless xterm to get the screen as text, wait for the footer hint ("q quit"),
// press q, and expect a clean exit. The screen and the app's own log go to $SPIKE_OUT for the artifact.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { record } from "./record.mjs";

const need = (name) => {
  if (!process.env[name]) throw new Error(`${name} is not set`);
  return process.env[name];
};
const nodeExe = need("NODE_EXE");
const cliDir = path.resolve(need("CLI_DIR"));
const harnessDir = path.resolve(need("HARNESS_DIR"));
const scratch = path.join(need("SPIKE_DIR"), "tui-check");
const outDir = process.env.SPIKE_OUT ?? scratch;
const label = path.basename(nodeExe);
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(path.join(scratch, "home"), { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const require = createRequire(path.join(harnessDir, "package.json"));
const pty = require("node-pty");
const { Terminal } = require("@xterm/headless");

const COLS = 120;
const ROWS = 40;
const term = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
const screen = () => {
  const lines = [];
  for (let row = 0; row < ROWS; row++) lines.push(term.buffer.active.getLine(row)?.translateToString(true) ?? "");
  return lines.join("\n").replace(/\s+$/, "");
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const home = path.join(scratch, "home");
const env = { ...process.env, HOME: home, USERPROFILE: home, COLORTERM: "truecolor", TERM: "xterm-256color" };
if (process.env.MEILI_BIN) env.COMPOSITION_MEILI_BIN = process.env.MEILI_BIN;

const startedAt = Date.now();
const child = pty.spawn(nodeExe, [path.join(cliDir, "bin", "composition.mjs")], { name: "xterm-256color", cols: COLS, rows: ROWS, cwd: cliDir, env });
let exit = null;
let raw = "";
child.onData((data) => {
  raw += data;
  term.write(data);
});
child.onExit((result) => (exit = result));

let painted = null;
while (Date.now() - startedAt < 45_000 && !exit) {
  if (/q quit/i.test(screen())) {
    painted = Date.now() - startedAt;
    break;
  }
  await sleep(250);
}
await sleep(500);
const snapshot = screen();
fs.writeFileSync(path.join(outDir, `tui-screen-${label}.txt`), snapshot || "(blank)");
record(
  `${label}: the terminal app draws its UI in a ConPTY`,
  painted !== null,
  painted !== null ? `footer hint visible after ${painted} ms` : exit ? `exited early ${JSON.stringify(exit)}; ${raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim().slice(0, 200)}` : `no footer hint after 45 s; screen: ${snapshot.slice(0, 200)}`,
);

if (painted !== null) {
  child.write("q");
  const waitedFrom = Date.now();
  while (!exit && Date.now() - waitedFrom < 15_000) await sleep(200);
  record(`${label}: q quits cleanly`, exit !== null && exit.exitCode === 0, exit ? `exit code ${exit.exitCode} after ${Date.now() - waitedFrom} ms` : "still running after 15 s");
}
if (!exit) {
  child.kill();
  await sleep(1000);
}

const log = path.join(home, ".composition-cli", "cli.log");
if (fs.existsSync(log)) {
  fs.copyFileSync(log, path.join(outDir, `cli-${label}.log`));
  record(`${label}: the app's own log`, null, fs.readFileSync(log, "utf-8").trim().split("\n").slice(-3).join(" | "));
}
process.exit(0);
