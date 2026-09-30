// Development loop: the web app's desktop build under `next dev` (hot reload),
// and Electron loading it.
//
//   pnpm dev
//   COMPOSITION_DEV_HOME=/tmp/composition-dev pnpm dev
//
// By default this uses your real data: notes in ~/.composition and the app's
// settings and search index in ~/Library/Application Support/Composition.
// With COMPOSITION_DEV_HOME set, the app gets a scratch home instead (notes in
// <dir>/.composition, everything else in <dir>/userData), so experiments never
// touch real notes. Overriding HOME alone isn't enough: Electron keeps its own
// data folder wherever the OS says, regardless of $HOME.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.resolve(desktopDir, "..", "web");
const port = process.env.COMPOSITION_DEV_PORT ?? "3100";
const url = `http://localhost:${port}`;

const next = spawn("pnpm", ["exec", "next", "dev", "--port", port], {
  cwd: webDir,
  stdio: "inherit",
  env: { ...process.env, COMPOSITION_TARGET: "desktop" },
});

let electron = null;
function shutdown(code = 0) {
  electron?.kill("SIGTERM");
  next.kill("SIGTERM");
  process.exit(code);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
next.on("exit", (code) => {
  if (!electron) process.exit(code ?? 1);
});

async function waitForServer() {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.error(`next dev did not come up at ${url}`);
  shutdown(1);
}

await waitForServer();

await new Promise((resolve, reject) => {
  const build = spawn(process.execPath, [path.join(desktopDir, "scripts", "build-main.mjs")], { stdio: "inherit" });
  build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("main build failed"))));
});

const devHome = process.env.COMPOSITION_DEV_HOME;
if (devHome) fs.mkdirSync(devHome, { recursive: true });
console.log(devHome ? `Scratch home: ${devHome}` : "Using your real notes (~/.composition).");

electron = spawn(
  electronPath,
  [desktopDir, ...(devHome ? [`--user-data-dir=${path.join(devHome, "userData")}`] : [])],
  {
    stdio: "inherit",
    // HOME is changed for Electron only, never for pnpm/next above.
    env: { ...process.env, COMPOSITION_DEV_URL: url, ...(devHome ? { HOME: devHome } : {}) },
  },
);
electron.on("exit", (code) => shutdown(code ?? 0));
