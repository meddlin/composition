// Assembles the command line tool that ships inside the desktop app, one folder per
// platform, in resources/cli/<platform>/ (electron-builder copies it to Contents/Resources/cli/
// in the macOS app, resources/cli/ in the Linux one):
//
//   composition        launcher (cli/composition), the file the app links onto the PATH
//   node               the pinned Node 26 (pnpm fetch:node)
//   app/               apps/cli's bundle, plus a production-only node_modules for that architecture
//
//   pnpm stage:cli                 every platform (the Linux one only when run on Linux)
//   pnpm stage:cli mac-arm64       one of them (mac-arm64, mac-x64, linux-x64)
//   pnpm stage:cli --skip-build    reuse apps/cli/dist instead of rebuilding it
//
// Run `pnpm fetch:node` first, and install apps/cli's dependencies (the bundle is built there).
//
// Why a separate install per platform: OpenTUI's native library is its own per-platform
// package, and an install normally fetches only the running machine's. pnpm's
// `supportedArchitectures` fetches the other one, so the Intel app is staged correctly from an
// Apple Silicon Mac. The lockfile is apps/cli's own, so the versions are the ones CLI tests ran on.
// The Linux build needs the glibc packages (Ubuntu), not the musl ones (Alpine), hence `libc`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = path.resolve(desktopDir, "..", "cli");
// `os`/`cpu` are Node's names, as pnpm and the native packages use them; `arch` is what `lipo` (macOS) and
// `file` (Linux) report for a native file of that architecture.
const TARGETS = {
  "mac-arm64": { os: "darwin", cpu: "arm64", arch: "arm64" },
  "mac-x64": { os: "darwin", cpu: "x64", arch: "x86_64" },
  "linux-x64": { os: "linux", cpu: "x64", arch: "x86-64" },
};

const args = process.argv.slice(2);
const skipBuild = args.includes("--skip-build");
const requested = args.filter((arg) => !arg.startsWith("--"));
// With no platform named, every one this machine can check: a Mac stages the Mac apps, Linux stages the Linux app.
const hostOs = process.platform === "darwin" ? "darwin" : "linux";
const platforms = requested.length > 0 ? requested : Object.keys(TARGETS).filter((platform) => TARGETS[platform].os === hostOs);

function run(label, command, commandArgs, cwd) {
  console.log(`\n==> ${label}\n$ ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\nFailed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(`stage-cli: ${message}`);
  process.exit(1);
}

for (const platform of platforms) {
  if (!TARGETS[platform]) fail(`unknown platform ${platform} (expected ${Object.keys(TARGETS).join(", ")})`);
}
if (!fs.existsSync(path.join(cliDir, "node_modules"))) {
  fail("apps/cli has no node_modules. Run `pnpm --dir ../cli install --frozen-lockfile` first.");
}

if (!skipBuild) run("Build the CLI bundle", "pnpm", ["build"], cliDir);
const bundle = path.join(cliDir, "dist", "main.mjs");
if (!fs.existsSync(bundle)) fail(`${path.relative(desktopDir, bundle)} doesn't exist. Run without --skip-build.`);

/** Lists files under `dir` (relative paths), skipping nothing. */
function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full)];
  });
}

for (const platform of platforms) {
  const { os: targetOs, cpu, arch } = TARGETS[platform];
  const nodeBinary = path.join(desktopDir, "resources", "node", platform, "node");
  if (!fs.existsSync(nodeBinary)) fail(`${platform}: ${path.relative(desktopDir, nodeBinary)} is missing. Run \`pnpm fetch:node ${platform}\`.`);

  const out = path.join(desktopDir, "resources", "cli", platform);
  const app = path.join(out, "app");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(app, "bin"), { recursive: true });
  fs.mkdirSync(path.join(app, "dist"), { recursive: true });

  // The bundle and its launcher. dist/ also holds the developer tools (seed, playground) and
  // source maps, which the app doesn't need.
  fs.copyFileSync(path.join(cliDir, "bin", "composition.mjs"), path.join(app, "bin", "composition.mjs"));
  fs.copyFileSync(bundle, path.join(app, "dist", "main.mjs"));

  // The manifest and lockfile go together, so `--frozen-lockfile` holds. Only production
  // dependencies are installed; the devDependencies in the manifest are ignored by --prod.
  fs.copyFileSync(path.join(cliDir, "package.json"), path.join(app, "package.json"));
  fs.copyFileSync(path.join(cliDir, "pnpm-lock.yaml"), path.join(app, "pnpm-lock.yaml"));
  fs.writeFileSync(
    path.join(app, "pnpm-workspace.yaml"),
    [
      "# Generated by apps/desktop/scripts/stage-cli.mjs.",
      "# A flat node_modules, so it copies into the app as plain files (no symlinks into a store).",
      "nodeLinker: hoisted",
      "# Fetch this architecture's native packages, whatever machine this runs on.",
      "supportedArchitectures:",
      `  os: [${targetOs}]`,
      `  cpu: [${cpu}]`,
      ...(targetOs === "linux" ? ["  libc: [glibc]"] : []),
      "# Nothing is built or run at install: better-sqlite3 13 ships N-API prebuilds.",
      "allowBuilds:",
      "  better-sqlite3: false",
      "  esbuild: false",
      "",
    ].join("\n"),
  );
  run(`${platform}: install the CLI's production dependencies`, "pnpm", ["install", "--prod", "--frozen-lockfile", "--ignore-scripts"], app);

  // The install's own bookkeeping isn't needed at runtime.
  for (const name of ["pnpm-lock.yaml", "pnpm-workspace.yaml"]) fs.rmSync(path.join(app, name), { force: true });
  fs.rmSync(path.join(app, "node_modules", ".bin"), { recursive: true, force: true });
  fs.rmSync(path.join(app, "node_modules", ".modules.yaml"), { force: true });
  fs.rmSync(path.join(app, "node_modules", ".pnpm"), { recursive: true, force: true });

  // TypeScript and the @types packages arrive only as peers of OpenTUI's React bindings, for types.
  for (const name of ["typescript", "@typescript", "@types"]) fs.rmSync(path.join(app, "node_modules", name), { recursive: true, force: true });

  // better-sqlite3 13: keep only this platform's prebuild. On the Mac a foreign-OS binary would also
  // fail code signing, which expects every executable to be Mach-O. On Linux, "linux-x64.node" is the
  // glibc build; "linuxmusl-x64.node" (Alpine) is dropped with the rest.
  const sqlite = path.join(app, "node_modules", "better-sqlite3");
  for (const name of ["deps", "src", "binding.gyp", "build"]) fs.rmSync(path.join(sqlite, name), { recursive: true, force: true });
  const prebuilds = path.join(sqlite, "prebuilds");
  const prebuild = `${targetOs}-${cpu}.node`;
  if (!fs.existsSync(path.join(prebuilds, prebuild))) fail(`${platform}: better-sqlite3 has no ${targetOs}-${cpu} prebuild`);
  for (const file of fs.readdirSync(prebuilds)) {
    if (file !== prebuild) fs.rmSync(path.join(prebuilds, file), { force: true });
  }

  // OpenTUI's native library: exactly this architecture's package must be present.
  const opentui = fs.readdirSync(path.join(app, "node_modules", "@opentui")).filter((name) => name.startsWith("core-"));
  if (opentui.join() !== `core-${targetOs}-${cpu}`) fail(`${platform}: expected only @opentui/core-${targetOs}-${cpu}, found ${opentui.join(", ") || "none"}`);

  // Every native file, and the Node binary, must be this architecture. Checked where a tool can tell:
  // `lipo` on a Mac, `file` on Linux. (The other machine's apps are checked when they are built there.)
  const native = walk(app).filter((file) => /\.(node|dylib|so)(\.\d+)*$/.test(file));
  const checker = targetOs === "darwin" && process.platform === "darwin" ? "lipo" : targetOs === "linux" && process.platform === "linux" ? "file" : null;
  if (checker) {
    for (const file of [...native.map((name) => path.join(app, name)), nodeBinary]) {
      const result = checker === "lipo" ? spawnSync("lipo", ["-archs", file], { encoding: "utf-8" }) : spawnSync("file", ["-b", file], { encoding: "utf-8" });
      const found = result.stdout.trim();
      const matches = checker === "lipo" ? found.split(/\s+/).includes(arch) : /^ELF 64-bit/.test(found) && found.includes(arch);
      if (result.status !== 0 || !matches) fail(`${platform}: ${path.relative(out, file)} is ${found || "unreadable"}, expected ${arch}`);
    }
    console.log(`${platform}: ${native.length} native file(s) and Node, all ${arch}`);
  }

  fs.copyFileSync(nodeBinary, path.join(out, "node"));
  fs.chmodSync(path.join(out, "node"), 0o755);
  fs.copyFileSync(path.join(desktopDir, "cli", "composition"), path.join(out, "composition"));
  fs.chmodSync(path.join(out, "composition"), 0o755);

  const files = walk(out);
  console.log(`${platform}: staged ${files.length} files -> ${path.relative(desktopDir, out)}`);
}
