#!/usr/bin/env node
// Lints GitHub Actions workflows so every third-party action is pinned to an
// immutable full-length commit SHA, in the GitHub-recommended form:
//
//   uses: <owner>/<repo>@<40-char commit sha> # v<major>.<minor>[.<patch>]
//
// Tags and branches are mutable, so `@v4` or `@main` can silently change what
// runs in CI. Local actions (`./...`) are exempt; `docker://` references must
// be pinned to a `@sha256:` digest.
//
// Usage: node scripts/lint-github-actions.mjs [file-or-dir ...]
// Defaults to .github/workflows and .github/actions.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { pathToFileURL } from "node:url";

const USES_LINE = /^\s*(?:-\s+)?uses:\s*(?<ref>"[^"]*"|'[^']*'|[^\s#]+)\s*(?:#(?<comment>.*))?$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const DOCKER_DIGEST = /^docker:\/\/\S+@sha256:[0-9a-f]{64}$/;
const VERSION_COMMENT = /^\s*v\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?(?:\s|$)/;

/** @returns {{line: number, message: string}[]} */
export function lintWorkflow(source) {
  const problems = [];

  source.split(/\r?\n/).forEach((text, index) => {
    const match = USES_LINE.exec(text);
    if (!match) return;

    const line = index + 1;
    const ref = match.groups.ref.replace(/^["']|["']$/g, "");
    const comment = match.groups.comment;

    if (ref.startsWith("./")) return;

    if (ref.startsWith("docker://")) {
      if (!DOCKER_DIGEST.test(ref)) {
        problems.push({ line, message: `${ref}: Docker image must be pinned to a @sha256:<digest>` });
      }
      return;
    }

    const at = ref.lastIndexOf("@");
    const pin = at === -1 ? "" : ref.slice(at + 1);
    if (!COMMIT_SHA.test(pin)) {
      problems.push({
        line,
        message: `${ref}: must be pinned to a full 40-character commit SHA, e.g. ${at === -1 ? ref : ref.slice(0, at)}@<sha> # v1.2.3`,
      });
      return;
    }

    if (comment === undefined || !VERSION_COMMENT.test(comment)) {
      problems.push({
        line,
        message: `${ref}: pinned actions need a trailing version comment, e.g. "# v1.2.3"`,
      });
    }
  });

  return problems;
}

function collectFiles(target) {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  return readdirSync(target, { withFileTypes: true }).flatMap((entry) => {
    const path = join(target, entry.name);
    if (entry.isDirectory()) return collectFiles(path);
    return [".yml", ".yaml"].includes(extname(entry.name)) ? [path] : [];
  });
}

function main(args) {
  const targets = args.length > 0 ? args : [".github/workflows", ".github/actions"];
  const files = targets.flatMap(collectFiles);
  let failures = 0;

  for (const file of files) {
    for (const { line, message } of lintWorkflow(readFileSync(file, "utf8"))) {
      failures += 1;
      // `::error` renders as an inline annotation in GitHub Actions, and is plain text locally.
      console.error(`::error file=${file},line=${line}::${message}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} unpinned GitHub Action reference(s) found in ${files.length} file(s).`);
    process.exit(1);
  }
  console.log(`Checked ${files.length} workflow file(s): all actions are pinned to commit SHAs.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
