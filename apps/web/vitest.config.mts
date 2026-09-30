import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Pure modules run in node; component/hook tests opt into jsdom with a
    // `// @vitest-environment jsdom` docblock at the top of the file.
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
