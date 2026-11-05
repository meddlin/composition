// Runs under a given runtime (the downloaded Node 26, a renamed copy of it, or Electron with
// ELECTRON_RUN_AS_NODE=1) and records whether the native pieces load:
//   node:ffi, better-sqlite3's prebuilt .node (with WAL on a real file), and OpenTUI's native library.
//
//   node native-check.mjs --sqlite <dir that resolves better-sqlite3> [--opentui <apps/cli>] [--label name]
//
// Always exits 0 after recording; a crash of the script itself is a result too.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { record } from "./record.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? path.resolve(args[at + 1]) : null;
};
const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : path.basename(process.execPath);
const sqliteDir = option("sqlite");
const opentuiDir = option("opentui");

record(`${label}: runtime`, null, `${process.version} ${process.platform}-${process.arch}${process.versions.electron ? ` electron ${process.versions.electron}` : ""} ${process.execPath}`);

try {
  await import("node:ffi");
  record(`${label}: node:ffi imports`, true);
} catch (error) {
  // Expected under Electron, whose Node has no node:ffi; a failure anywhere else is the finding.
  record(`${label}: node:ffi imports`, process.versions.electron ? null : false, error.message);
}

if (sqliteDir) {
  try {
    const Database = createRequire(path.join(sqliteDir, "package.json"))("better-sqlite3");
    const memory = new Database(":memory:");
    const version = memory.prepare("select sqlite_version() as v").get().v;
    memory.close();
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "spike-sqlite-"));
    const db = new Database(path.join(scratch, "wal.db"));
    const mode = db.pragma("journal_mode = WAL", { simple: true });
    db.exec("create table t(x); insert into t values (1), (2);");
    const count = db.prepare("select count(*) as n from t").get().n;
    db.close();
    fs.rmSync(scratch, { recursive: true, force: true });
    record(`${label}: better-sqlite3 loads and uses WAL`, mode === "wal" && count === 2, `sqlite ${version}, journal_mode=${mode}, rows=${count}`);
  } catch (error) {
    record(`${label}: better-sqlite3 loads and uses WAL`, false, error.stack ?? error.message);
  }
}

if (opentuiDir) {
  try {
    // The package's `exports` has no ./package.json and no `require` condition, so find the files by hand.
    const pkgDir = fs.realpathSync(path.join(opentuiDir, "node_modules", "@opentui", "core"));
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8"));
    const entry = (key) => {
      const target = pkg.exports[key];
      const file = typeof target === "string" ? target : (target.node ?? target.import ?? target.default);
      return pathToFileURL(path.join(pkgDir, typeof file === "string" ? file : file.default ?? file.import));
    };
    const core = await import(entry("."));
    record(`${label}: @opentui/core imports`, true, `${Object.keys(core).length} exports`);

    const testing = await import(entry("./testing"));
    const { renderer, renderOnce, captureCharFrame } = await testing.createTestRenderer({ width: 40, height: 6 });
    await renderOnce();
    const frame = captureCharFrame();
    renderer.destroy();
    record(`${label}: OpenTUI native library renders a frame`, typeof frame === "string" && frame.length > 0, `frame is ${frame.length} chars`);
  } catch (error) {
    record(`${label}: OpenTUI native library renders a frame`, false, error.stack ?? error.message);
  }
}
