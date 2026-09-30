// Builds the web app's static desktop export and copies it to dist/renderer,
// which the app:// protocol handler serves. See apps/web/next.config.ts.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.resolve(desktopDir, "..", "web");
const exportDir = path.join(webDir, ".next-desktop");
const target = path.join(desktopDir, "dist", "renderer");

if (!fs.existsSync(path.join(webDir, "node_modules"))) {
  console.error("apps/web has no node_modules. Run `pnpm install` in apps/web first.");
  process.exit(1);
}

fs.rmSync(exportDir, { recursive: true, force: true });
const build = spawnSync("pnpm", ["exec", "next", "build"], {
  cwd: webDir,
  stdio: "inherit",
  env: { ...process.env, COMPOSITION_TARGET: "desktop" },
});
if (build.status !== 0) process.exit(build.status ?? 1);

if (!fs.existsSync(path.join(exportDir, "index.html"))) {
  console.error(`Expected a static export at ${exportDir}, but index.html is missing.`);
  process.exit(1);
}
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(exportDir, target, { recursive: true });
console.log(`renderer -> ${path.relative(desktopDir, target)}`);
