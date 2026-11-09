// Spike S3: can the web app's REAL note preview (NoteMarkdown and the ten MDX components) be built as a standalone page that
// a WebView2 control could host? It imports the components straight from apps/web/src (nothing there is edited) and swaps
// the one module the app already swaps per build (imageUrl) for a WebView2 virtual-host version.
// Build: apps/windows/spikes/preview/build.sh
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../../../web");
const webModules = path.join(web, "node_modules");
// apps/web has the PostCSS flavour of Tailwind (it builds with Next), not the Vite plugin, so use that one.
const tailwindPostcss = createRequire(path.join(web, "package.json"))("@tailwindcss/postcss") as (o: { base: string }) => unknown;

export default {
  root: here,
  plugins: [],
  css: { postcss: { plugins: [tailwindPostcss({ base: web })] } },
  // no @vitejs/plugin-react in apps/web: plain automatic-runtime JSX is enough for a page with no HMR
  oxc: { jsx: { runtime: "automatic" } },
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      // the module the desktop build also replaces (next.config.ts): where stored images are fetched from
      { find: "@/lib/composition/imageUrl", replacement: path.join(here, "imageUrl.webview2.ts") },
      { find: /^@\//, replacement: path.join(web, "src") + "/" },
      // this folder is outside apps/web, so its own bare imports need pointing at apps/web's copies
      { find: /^react$/, replacement: path.join(webModules, "react") },
      { find: /^react\/jsx-runtime$/, replacement: path.join(webModules, "react/jsx-runtime") },
      { find: /^react-dom\/client$/, replacement: path.join(webModules, "react-dom/client") },
    ],
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: path.join(here, "dist"),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
};
