// Assembles the license notices that ship inside the app (Contents/Resources/licenses):
//
//   - Electron's and Chromium's licenses, which Electron's own distribution
//     includes but electron-builder doesn't copy into a macOS app
//   - Meilisearch's MIT notice (licenses/meilisearch-LICENSE-MIT.txt, tracked)
//   - THIRD_PARTY_NOTICES.txt: the license text of every JavaScript package the
//     app ships, computed as the runtime dependency closure of the packages the
//     renderer and main process import (optional dependencies excluded, so
//     e.g. Next's sharp/libvips image binaries, which aren't shipped, aren't listed)
//
// Output goes to resources/licenses/ (git-ignored), which electron-builder copies.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.resolve(desktopDir, "..", "web");
const outDir = path.join(desktopDir, "resources", "licenses");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const warnings = [];

// ---- Electron + Chromium
const electronPackage = path.join(desktopDir, "node_modules", "electron");
if (!fs.existsSync(path.join(electronPackage, "dist"))) {
  // Electron 44 downloads its binary lazily; the license files live next to it.
  spawnSync(process.execPath, [path.join(electronPackage, "install.js")], { stdio: "inherit" });
}
for (const [from, to] of [
  ["LICENSE", "electron-LICENSE.txt"],
  ["LICENSES.chromium.html", "LICENSES.chromium.html"],
]) {
  const source = path.join(electronPackage, "dist", from);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(outDir, to));
  else warnings.push(`Electron's ${from} was not found at ${source}`);
}

// ---- Meilisearch
fs.copyFileSync(
  path.join(desktopDir, "licenses", "meilisearch-LICENSE-MIT.txt"),
  path.join(outDir, "meilisearch-LICENSE-MIT.txt"),
);
const meiliThirdParty = path.join(desktopDir, "licenses", "meilisearch-third-party.txt");
if (fs.existsSync(meiliThirdParty)) {
  fs.copyFileSync(meiliThirdParty, path.join(outDir, "meilisearch-third-party.txt"));
} else {
  warnings.push(
    "licenses/meilisearch-third-party.txt is missing: the license list for the Rust crates inside " +
      "the Meilisearch binary has not been generated (docs/desktop-app-plan.md, Licensing Meilisearch). " +
      "Required before a public release.",
  );
}

// ---- JavaScript dependencies
function closure(projectDir, roots) {
  const result = spawnSync(
    "pnpm",
    ["list", "--prod", "--json", "--depth", "Infinity", "--no-optional"],
    { cwd: projectDir, encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`pnpm list failed in ${projectDir}: ${result.stderr}`);
  const [project] = JSON.parse(result.stdout);
  const found = new Map();
  const walk = (dependencies) => {
    for (const [name, info] of Object.entries(dependencies ?? {})) {
      const key = `${name}@${info.version}`;
      if (found.has(key)) continue;
      found.set(key, info.path);
      walk(info.dependencies);
    }
  };
  for (const root of roots) {
    const info = project.dependencies?.[root];
    if (!info) {
      warnings.push(`${root} is not a production dependency of ${path.basename(projectDir)}`);
      continue;
    }
    found.set(`${root}@${info.version}`, info.path);
    walk(info.dependencies);
  }
  return found;
}

const packages = new Map([
  // Bundled into the renderer (static export) and the main process (esbuild).
  ...closure(webDir, [
    "react",
    "react-dom",
    "react-markdown",
    "remark-gfm",
    "remark-mdx",
    "rehype-highlight",
    "lowlight",
    // shadcn/ui's runtime (apps/web/src/components/ui) and the animation CSS compiled into the stylesheet.
    "radix-ui",
    "lucide-react",
    "class-variance-authority",
    "cn",
    "tw-animate-css",
    "next",
    "meilisearch",
    "js-yaml",
  ]),
  // Native module loaded at runtime from node_modules.
  ...closure(desktopDir, ["better-sqlite3"]),
]);

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;
const sections = [];
for (const [key, dir] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  let license = "unknown";
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
    license = typeof manifest.license === "string" ? manifest.license : JSON.stringify(manifest.license ?? "unknown");
  } catch {
    // keep "unknown"
  }
  const files = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile());
  if (files.length === 0) warnings.push(`${key} (${license}) has no license file in its package`);
  const body = files.map((f) => fs.readFileSync(path.join(dir, f), "utf-8").trim()).join("\n\n");
  sections.push(`${"=".repeat(78)}\n${key}  (${license})\n${"=".repeat(78)}\n\n${body || "(no license file included in the package)"}\n`);
}

fs.writeFileSync(
  path.join(outDir, "THIRD_PARTY_NOTICES.txt"),
  [
    "Third-party software included in Composition (JavaScript packages)",
    "",
    `${packages.size} packages. Generated by scripts/collect-licenses.mjs.`,
    "Electron and Chromium: see electron-LICENSE.txt and LICENSES.chromium.html.",
    "Meilisearch: see meilisearch-LICENSE-MIT.txt and meilisearch-third-party.txt.",
    "",
    ...sections,
  ].join("\n"),
);
fs.writeFileSync(
  path.join(outDir, "README.txt"),
  [
    "Licenses for software included in Composition",
    "",
    "electron-LICENSE.txt            Electron (MIT)",
    "LICENSES.chromium.html          Chromium and its dependencies",
    "meilisearch-LICENSE-MIT.txt     Meilisearch (MIT), the bundled search engine",
    "meilisearch-third-party.txt     Licenses of the libraries inside the Meilisearch binary",
    "THIRD_PARTY_NOTICES.txt         JavaScript packages used by the app",
    "",
  ].join("\n"),
);

console.log(`licenses -> ${path.relative(desktopDir, outDir)} (${packages.size} JavaScript packages)`);
for (const warning of warnings) console.warn(`WARNING: ${warning}`);
