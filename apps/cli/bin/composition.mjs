#!/usr/bin/env node
// Launcher for the Composition terminal app.
//
// The shebang is deliberately plain. OpenTUI needs Node's experimental `node:ffi`,
// which Node 26.10 enables by default; a `--experimental-ffi` flag in the shebang
// would make older Nodes die with "bad option" before this guard could explain.
import { readFileSync } from "node:fs";

const MIN = [26, 10];
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < MIN[0] || (major === MIN[0] && minor < MIN[1])) {
  console.error(
    `Composition needs Node ${MIN.join(".")} or newer (this is ${process.versions.node}).\n` +
      "Install it with nvm (`nvm install 26`) and try again.",
  );
  process.exit(1);
}

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  console.log(pkg.version);
  process.exit(0);
}

// FFI is experimental, so Node prints a warning that would scribble over the screen.
process.removeAllListeners("warning");

await import("../dist/main.mjs");
