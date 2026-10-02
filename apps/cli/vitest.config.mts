import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const cliDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // The shared data layer lives in apps/web, where `better-sqlite3` is built for
      // web's Node. The CLI runs on a newer Node, so tests, like the esbuild bundle
      // (see scripts/build.mjs), must load this package's own copy.
      {
        find: /^better-sqlite3$/,
        replacement: path.join(cliDir, "node_modules", "better-sqlite3"),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
    // Meilisearch and terminal-rendering tests spawn real processes and wait on workers.
    testTimeout: 20_000,
  },
});
