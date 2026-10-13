#!/usr/bin/env node
// Runs Opengrep (a Semgrep-compatible static analyzer) over the app projects.
// Shared by `pnpm opengrep*` and the Opengrep GitHub workflow, so both scan the
// same way.
//
// Usage: node scripts/opengrep.mjs [cli|desktop|web ...]
// With no arguments, scans every project. Exits 1 if any project has findings.
//
// Requires `opengrep` on PATH: https://github.com/opengrep/opengrep#installation
// The rules (opengrep/opengrep-rules, pinned below) are fetched into
// .opengrep-rules on first run, or set OPENGREP_RULES_DIR to use your own checkout.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROJECTS = ["cli", "desktop", "web"];

const RULES_REPO = "https://github.com/opengrep/opengrep-rules.git";
// Pinned to a commit so rule updates never change results unreviewed.
const RULES_COMMIT = "f1d2b562b414783763fd02a6ed2736eaed622efa";

// Security rules only: the full packs also carry style and i18n checks
// (e.g. react-props-spreading) that bury real findings.
const RULE_ROOTS = ["javascript", "typescript", "bash", "yaml/github-actions", "generic/secrets", "generic/ci"];

const EXCLUDES = ["node_modules", "dist", "release", "*.test.*"];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every directory named `security` under the given rule roots. */
export function findSecurityRuleDirs(rulesDir, roots = RULE_ROOTS) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (entry.name === "security") found.push(path);
      else walk(path);
    }
  };
  for (const root of roots) {
    if (existsSync(join(rulesDir, root))) walk(join(rulesDir, root));
  }
  return found.sort();
}

export function buildScanArgs(ruleDirs, target) {
  return [
    "scan",
    "--error",
    "--disable-version-check",
    ...EXCLUDES.flatMap((pattern) => ["--exclude", pattern]),
    ...ruleDirs.flatMap((dir) => ["-f", dir]),
    target,
  ];
}

export function resolveProjects(args) {
  if (args.length === 0 || args.includes("all")) return PROJECTS;
  const unknown = args.filter((arg) => !PROJECTS.includes(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown project(s): ${unknown.join(", ")}. Expected one of: ${PROJECTS.join(", ")}, all.`);
  }
  return [...new Set(args)];
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", ...options });
}

function ensureOpengrep() {
  const result = run("opengrep", ["--version"]);
  if (result.error || result.status !== 0) {
    throw new Error(
      "opengrep was not found on PATH. Install it from https://github.com/opengrep/opengrep#installation",
    );
  }
}

function ensureRules() {
  if (process.env.OPENGREP_RULES_DIR) return resolve(process.env.OPENGREP_RULES_DIR);

  const dir = join(repoRoot, ".opengrep-rules");
  const head = existsSync(join(dir, ".git")) ? run("git", ["-C", dir, "rev-parse", "HEAD"]).stdout.trim() : "";
  if (head === RULES_COMMIT) return dir;

  console.log(`Fetching opengrep-rules@${RULES_COMMIT.slice(0, 7)} into ${relative(repoRoot, dir)}`);
  mkdirSync(dir, { recursive: true });
  for (const args of [
    ["init", "--quiet"],
    ["fetch", "--quiet", "--depth", "1", RULES_REPO, RULES_COMMIT],
    ["checkout", "--quiet", "--detach", "FETCH_HEAD"],
  ]) {
    const result = run("git", ["-C", dir, ...args], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed while fetching the Opengrep rules`);
  }
  return dir;
}

function main(args) {
  const projects = resolveProjects(args);
  ensureOpengrep();
  const ruleDirs = findSecurityRuleDirs(ensureRules());
  if (ruleDirs.length === 0) throw new Error("No security rule directories found in the Opengrep rules checkout.");

  const failed = [];
  for (const project of projects) {
    console.log(`\n=== opengrep: apps/${project} ===`);
    const result = spawnSync("opengrep", buildScanArgs(ruleDirs, `apps/${project}`), {
      cwd: repoRoot,
      stdio: "inherit",
    });
    if (result.status !== 0) failed.push(project);
  }

  if (failed.length > 0) {
    console.error(`\nOpengrep found issues (or failed) in: ${failed.map((p) => `apps/${p}`).join(", ")}`);
    process.exit(1);
  }
  console.log(`\nOpengrep: no findings in ${projects.map((p) => `apps/${p}`).join(", ")}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
