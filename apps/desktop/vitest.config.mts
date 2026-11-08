import fs from "node:fs";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The export worker imports its two fonts as bytes (esbuild's "binary" loader in scripts/build-main.mjs); a test gets the same.
  plugins: [
    {
      name: "ttf-as-bytes",
      enforce: "pre",
      load(id) {
        const file = id.split("?")[0];
        if (!file.endsWith(".ttf")) return null;
        return `export default new Uint8Array(Buffer.from(${JSON.stringify(fs.readFileSync(file).toString("base64"))}, "base64"));`;
      },
    },
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Meilisearch and Electron-facing tests spawn real processes.
    testTimeout: 15_000,
  },
});
