import type { NextConfig } from "next";

/**
 * One codebase, two builds.
 *
 * - web (default): the server-rendered app backed by Server Actions.
 * - desktop (`COMPOSITION_TARGET=desktop`): a static export that Electron
 *   serves from disk, talking to the main process over IPC. A static export
 *   can't run Server Actions or server-rendered pages, so this build swaps in
 *   sibling `*.desktop.*` files:
 *     - route files (`page.desktop.tsx`, `layout.desktop.tsx`) via
 *       `pageExtensions`; a route with no desktop file, like /docs, isn't built;
 *     - everything else (`client.desktop.ts`, `navLinks.desktop.ts`) via
 *       Turbopack's `resolveExtensions`, which tries `.desktop.*` first.
 */
const desktop = process.env.COMPOSITION_TARGET === "desktop";

const nextConfig: NextConfig = desktop
  ? {
      output: "export",
      // Its own build directory, so a desktop build never clobbers the web
      // build's cache or generated types (and vice versa). The static export
      // itself is written here too.
      distDir: ".next-desktop",
      // /settings -> settings/index.html, which the app:// handler serves as-is.
      trailingSlash: true,
      images: { unoptimized: true },
      pageExtensions: ["desktop.tsx", "desktop.ts"],
      turbopack: {
        resolveExtensions: [
          ".desktop.tsx",
          ".desktop.ts",
          ".tsx",
          ".ts",
          ".jsx",
          ".js",
          ".mjs",
          ".json",
        ],
      },
    }
  : {
      experimental: {
        // Pasted images travel to the Server Action as request bodies; the 1 MB
        // default would reject most screenshots. Room for MAX_IMAGE_BYTES plus
        // the encoding overhead.
        serverActions: { bodySizeLimit: "12mb" },
      },
    };

export default nextConfig;
