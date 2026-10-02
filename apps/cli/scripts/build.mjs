// Bundles the terminal app with esbuild.
//
// The entry imports the web app's framework-free data layer (apps/web/src/lib/composition)
// and desktop's Meilisearch process code (apps/desktop/src/main), all through
// src/backend.ts, so they are bundled in; their pure-JS dependencies (js-yaml, meilisearch)
// are resolved from apps/web/node_modules, so web's dependencies must be installed first.
// Native or runtime-loaded packages stay external and load from this package's node_modules.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const cliDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

const config = {
  // The app, and the two developer tools (`pnpm seed`, `pnpm search:playground`).
  entryPoints: {
    main: "src/main.tsx",
    seed: "src/tools/seed.ts",
    "search-playground": "src/tools/searchPlayground.ts",
  },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node26",
  sourcemap: true,
  logLevel: "info",
  absWorkingDir: cliDir,
  jsx: "automatic",
  jsxImportSource: "@opentui/react",
  // OpenTUI loads its native library and tree-sitter worker from its own files;
  // better-sqlite3 is a native addon. React must be the one copy OpenTUI uses.
  external: ["@opentui/*", "better-sqlite3", "react", "react/*"],
  // Some bundled CommonJS code calls require(); give ESM output a real one.
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
};

if (watch) {
  await (await context(config)).watch();
} else {
  await build(config);
}
