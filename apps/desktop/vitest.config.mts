import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Meilisearch and Electron-facing tests spawn real processes.
    testTimeout: 15_000,
  },
});
