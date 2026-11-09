// Builds `entry.tsx` into dist/preview.{js,css} with the Vite that apps/web already has installed. Run through build.sh.
// Mirrors what next.config.ts does for the desktop export: the `.desktop.ts` variants win (for the image URL, which the
// Linux shell serves at app://composition/ exactly as Electron does), and `@/` means apps/web/src.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../../../web");
const dep = (name) => path.join(web, "node_modules", name);

export default {
  root: web, // so apps/web/postcss.config.mjs (Tailwind) applies to the CSS
  configFile: false,
  logLevel: "info",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  resolve: {
    tsconfigPaths: true,
    extensions: [".desktop.tsx", ".desktop.ts", ".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
    alias: [
      // The entry is outside apps/web's tsconfig, so `@/` is spelled out for it.
      { find: /^@\//, replacement: path.join(web, "src") + "/" },
      // The entry lives outside apps/web, so its own bare imports are pointed at apps/web's copies.
      { find: /^react$/, replacement: dep("react") },
      { find: /^react\/(.*)$/, replacement: dep("react") + "/$1" },
      { find: /^react-dom\/(.*)$/, replacement: dep("react-dom") + "/$1" },
      { find: /^rehype-highlight$/, replacement: dep("rehype-highlight") },
      { find: /^lowlight$/, replacement: dep("lowlight") },
    ],
  },
  build: {
    outDir: path.join(here, "dist"),
    emptyOutDir: true,
    minify: true,
    cssCodeSplit: false,
    lib: { entry: path.join(here, "entry.tsx"), formats: ["iife"], name: "CompositionPreview", fileName: () => "preview.js", cssFileName: "preview" },
  },
};
