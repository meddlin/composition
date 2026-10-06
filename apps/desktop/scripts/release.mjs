#!/usr/bin/env node
// Builds the macOS release artifacts: the signed, notarized DMG and ZIP for each
// architecture, checked and checksummed, in apps/desktop/release/. The "Release desktop"
// workflow runs this same script, so a local run and a CI run produce the same thing.
//
//   pnpm release                    sign + notarize both architectures
//   pnpm release --check            only check the requirements, build nothing
//   pnpm release --arch arm64       one architecture (arm64, x64 or both)
//   pnpm release --unsigned         skip signing and notarization (testing only)
//   pnpm release --tag desktop-v0.1.0   also require package.json's version to match the tag
//
// Setup, and what each missing requirement means: docs/deployment/manual-build-release.md.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHES, archesFor, checksumFile, isInside, parseArgs, parseSigningIdentities, tagVersion } from "./release-lib.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopDir, "../..");
const releaseDir = path.join(desktopDir, "release");
const doc = "docs/deployment/manual-build-release.md";

const USAGE = `Usage: pnpm release [--arch arm64|x64|both] [--unsigned] [--check] [--tag desktop-vX.Y.Z]`;

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\n${USAGE}`);
  process.exit(2);
}
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf-8"));
const arches = archesFor(options.arch);
const inCI = process.env.GITHUB_ACTIONS === "true";
// CI has no login keychain: it signs with a certificate passed in as CSC_LINK.
const certFromEnv = Boolean(process.env.CSC_LINK);

function capture(command, args, cwd = desktopDir) {
  const result = spawnSync(command, args, { cwd, encoding: "utf-8" });
  return { ok: result.status === 0, out: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() };
}

function run(label, command, args, cwd = desktopDir) {
  console.log(`\n==> ${label}\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\nFailed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

// ---- requirements ---------------------------------------------------------------------------

/** @returns {{level: "missing" | "warning", what: string, fix: string}[]} */
function checkRequirements() {
  const findings = [];
  const missing = (what, fix) => findings.push({ level: "missing", what, fix });
  const warning = (what, fix) => findings.push({ level: "warning", what, fix });
  const env = process.env;

  if (process.platform !== "darwin") {
    missing("This is not macOS.", "Signing and notarizing need macOS.");
  }

  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 14)) {
    warning(
      `Node ${process.versions.node} is below 22.14.`,
      "Recommended for the web app's install and build. Switch with your Node version manager.",
    );
  }

  if (!capture("pnpm", ["--version"]).ok) {
    missing("pnpm is not installed.", "Install pnpm 11 (the root package.json pins the version).");
  }

  if (options.tag !== null && tagVersion(options.tag) !== pkg.version) {
    missing(
      `The tag ${options.tag} doesn't match the version in apps/desktop/package.json (${pkg.version}).`,
      `Set "version" to ${tagVersion(options.tag)} and commit it, or push the tag desktop-v${pkg.version}.`,
    );
  }

  if (/PROVISIONAL/.test(fs.readFileSync(path.join(desktopDir, "electron-builder.yml"), "utf-8"))) {
    warning(
      "The app identifier in electron-builder.yml is still marked PROVISIONAL.",
      "Fine for testing. Settle it before the first public release: it is part of the code signature, and changing it later orphans existing installs.",
    );
  }

  if (!inCI) {
    const dirty = capture("git", ["status", "--porcelain", "--untracked-files=no"], repoRoot);
    if (dirty.ok && dirty.out !== "") {
      warning("There are uncommitted changes to tracked files.", "The build won't match any commit. Commit or stash them for a real release.");
    }
    const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"], repoRoot);
    if (branch.ok && branch.out !== "main") {
      warning(`You are on "${branch.out}", not main.`, "A release is normally built from main.");
    }
  }

  if (options.unsigned) return findings;

  // Signing certificate.
  if (certFromEnv) {
    if (!env.CSC_KEY_PASSWORD) {
      missing("CSC_LINK is set but CSC_KEY_PASSWORD is not.", "Set CSC_KEY_PASSWORD to the password the .p12 was exported with.");
    }
  } else if (inCI) {
    missing("CSC_LINK is not set.", "Add the base64 .p12 as the CSC_LINK secret (see the CI section of the manual-build-release doc).");
  } else if (process.platform === "darwin") {
    const { valid, unusable } = parseSigningIdentities(capture("security", ["find-identity", "-p", "codesigning"]).out);
    if (valid.length === 0 && unusable.length > 0) {
      missing(
        `"${unusable[0].name}" is installed but not valid.`,
        `Usually the Developer ID - G2 intermediate certificate is missing, or the certificate expired. See ${doc} step 1.4.`,
      );
    } else if (valid.length === 0) {
      missing(
        "No Developer ID Application signing identity in your keychains.",
        `Install the certificate into the login keychain (not iCloud). If it is installed but has no private key under it, the CSR came from another Mac. See ${doc} step 1.`,
      );
    } else if (valid.length > 1 && !env.CSC_NAME) {
      warning(
        `${valid.length} Developer ID Application identities found; electron-builder will pick one.`,
        `Set CSC_NAME to the name of the one you want, for example CSC_NAME="${valid[0].name.replace("Developer ID Application: ", "")}".`,
      );
    }
  }

  // Notarization credentials.
  const unset = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"].filter((name) => !env[name]);
  if (unset.length > 0) {
    missing(
      `Not set: ${unset.join(", ")}.`,
      `Notarization needs the App Store Connect API key (path to the .p8, its Key ID and the Issuer ID). See ${doc} steps 2 and 3.`,
    );
  }
  if (env.APPLE_API_KEY) {
    if (!fs.existsSync(env.APPLE_API_KEY)) {
      missing(`APPLE_API_KEY points to a file that doesn't exist: ${env.APPLE_API_KEY}`, "It must be the path to the downloaded AuthKey_XXXXXXXXXX.p8.");
    } else if (isInside(repoRoot, env.APPLE_API_KEY)) {
      warning("The .p8 key is inside the repository.", "Move it out (for example ~/.private_keys/) so it can't be committed.");
    }
  }

  return findings;
}

function reportRequirements(findings) {
  if (findings.length === 0) {
    console.log("All requirements are in place.");
    return;
  }
  for (const { level, what, fix } of findings) {
    console.log(`${level === "missing" ? "  MISSING" : "  warning"}  ${what}\n           ${fix}`);
  }
}

// ---- build ----------------------------------------------------------------------------------

function build() {
  // Start clean so old artifacts can't end up in the checksums or the release.
  fs.rmSync(releaseDir, { recursive: true, force: true });

  // Install web first: the desktop build bundles code and styles from it.
  run("Install web dependencies", "pnpm", ["--dir", path.join(repoRoot, "apps/web"), "install", "--frozen-lockfile"]);
  run("Install desktop dependencies", "pnpm", ["install", "--frozen-lockfile"]);
  run("Fetch Meilisearch", "pnpm", ["fetch:meilisearch", ...arches.map((arch) => ARCHES[arch].meilisearch)]);
  run("Build the app", "pnpm", ["build"]);

  const builderArgs = ["exec", "electron-builder", "--mac", ...arches.map((arch) => ARCHES[arch].builderFlag)];
  if (options.unsigned) builderArgs.push("-c.mac.identity=null");
  run(options.unsigned ? "Package (unsigned)" : "Package, sign and notarize", "pnpm", builderArgs);
}

// ---- verify ---------------------------------------------------------------------------------

function packagedApps() {
  const apps = fs
    .readdirSync(releaseDir)
    .filter((entry) => /^mac(-|$)/.test(entry))
    .map((entry) => path.join(releaseDir, entry, `${pkg.productName}.app`))
    .filter((app) => fs.existsSync(app));
  return apps;
}

/** Checks the packaged apps; returns the failures. */
function verify() {
  const failures = [];
  const apps = packagedApps();
  const seen = [];

  for (const app of apps) {
    const name = path.relative(releaseDir, app);
    const archs = capture("lipo", ["-archs", path.join(app, "Contents/MacOS", pkg.productName)]).out;
    seen.push(archs);
    console.log(`\n${name}  (${archs})`);

    const check = (label, command, args, passes) => {
      const result = capture(command, args);
      const ok = result.ok && passes(result.out);
      console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}`);
      if (!ok) failures.push(`${name}: ${label}\n${result.out}`);
    };

    if (options.unsigned) continue;
    check("signature is intact (codesign --verify --deep --strict)", "codesign", ["--verify", "--deep", "--strict", app], () => true);
    check(
      "bundled Meilisearch is signed",
      "codesign",
      ["--verify", "--strict", path.join(app, "Contents/Resources/meilisearch/meilisearch")],
      () => true,
    );
    check(
      "signed with a Developer ID Application certificate",
      "codesign",
      ["-dv", "--verbose=2", app],
      (out) => /Authority=Developer ID Application:/.test(out) && /flags=0x[0-9a-f]+\(runtime\)/.test(out),
    );
    check("Gatekeeper accepts it as notarized (spctl --assess)", "spctl", ["--assess", "--type", "execute", "--verbose", app], (out) =>
      /source=Notarized Developer ID/.test(out),
    );
    check("notarization ticket is stapled (stapler validate)", "xcrun", ["stapler", "validate", app], () => true);
  }

  const expected = arches.map((arch) => ARCHES[arch].lipo).sort();
  if (seen.slice().sort().join() !== expected.join()) {
    failures.push(`Expected apps for ${expected.join(", ")} but found ${seen.join(", ") || "none"} in release/.`);
  }
  return failures;
}

function writeChecksums() {
  const files = fs
    .readdirSync(releaseDir)
    .filter((file) => file.endsWith(".dmg") || file.endsWith(".zip"))
    .sort();
  if (files.length === 0) {
    console.error("No .dmg or .zip files were produced.");
    process.exit(1);
  }
  const entries = files.map((name) => ({
    name,
    sha256: createHash("sha256").update(fs.readFileSync(path.join(releaseDir, name))).digest("hex"),
  }));
  fs.writeFileSync(path.join(releaseDir, "SHA256SUMS.txt"), checksumFile(entries));
  return files;
}

// ---- main -----------------------------------------------------------------------------------

console.log(`Composition desktop ${pkg.version}: ${arches.join(" + ")}, ${options.unsigned ? "UNSIGNED" : "signed and notarized"}\n`);

const findings = checkRequirements();
reportRequirements(findings);
const blocking = findings.filter((finding) => finding.level === "missing");

if (blocking.length > 0) {
  console.error(
    `\n${blocking.length} missing requirement${blocking.length === 1 ? "" : "s"}.` +
      ` Setup steps: ${doc}. For a test build that isn't signed, add --unsigned.`,
  );
  process.exit(1);
}
if (options.check) process.exit(0);

if (!options.unsigned && !inCI) {
  console.log("\nIf macOS asks for your login keychain password, enter it and click Always Allow.");
}

build();
const failures = verify();
if (failures.length > 0) {
  console.error(`\nVerification failed:\n\n${failures.join("\n\n")}`);
  process.exit(1);
}
const files = writeChecksums();

console.log(`\nDone. In ${path.relative(repoRoot, releaseDir)}/:`);
for (const file of [...files, "SHA256SUMS.txt"]) console.log(`  ${file}`);
if (options.unsigned) {
  console.log("\nThese builds are UNSIGNED: for your own testing only. Don't publish them as a release.");
} else {
  console.log(
    `\nNext: open the DMG on a Mac, drag the app to Applications and check search works,\nthen publish a draft release (docs/desktop-build-and-release.md, step 8).`,
  );
}
