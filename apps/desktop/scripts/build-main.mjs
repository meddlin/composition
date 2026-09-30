// Bundles the Electron main process and the preload script with esbuild.
//
// The main process imports the web app's framework-free data layer
// (apps/web/src/lib/composition, through src/main/backend.ts), so it is
// bundled in. better-sqlite3 is a native addon and stays external: it is
// loaded at runtime from this package's node_modules.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24", // Electron 44 bundles Node 24
  sourcemap: true,
  logLevel: "info",
  absWorkingDir: desktopDir,
};

const configs = [
  {
    ...common,
    entryPoints: ["src/main/index.ts"],
    outfile: "dist/main.js",
    external: ["electron", "better-sqlite3"],
  },
  {
    // Sandboxed preload scripts can only require "electron" (and a few
    // built-ins), so everything else is bundled into the one file.
    ...common,
    entryPoints: ["src/preload/index.ts"],
    outfile: "dist/preload.js",
    external: ["electron"],
  },
];

if (watch) {
  for (const config of configs) await (await context(config)).watch();
} else {
  for (const config of configs) await build(config);
}
