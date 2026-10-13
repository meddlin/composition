import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildScanArgs, findSecurityRuleDirs, resolveProjects } from "./opengrep.mjs";

test("scans every project by default and for `all`", () => {
  assert.deepEqual(resolveProjects([]), ["cli", "desktop", "web"]);
  assert.deepEqual(resolveProjects(["all"]), ["cli", "desktop", "web"]);
});

test("resolves named projects and rejects unknown ones", () => {
  assert.deepEqual(resolveProjects(["web", "cli", "web"]), ["web", "cli"]);
  assert.throws(() => resolveProjects(["mobile"]), /Unknown project\(s\): mobile/);
});

test("finds only security rule directories under the configured roots", () => {
  const rules = mkdtempSync(join(tmpdir(), "opengrep-rules-"));
  try {
    for (const dir of [
      "javascript/lang/security/audit",
      "javascript/express/security",
      "javascript/lang/correctness",
      "python/lang/security",
      "yaml/github-actions/security",
      "yaml/kubernetes/security",
    ]) {
      mkdirSync(join(rules, dir), { recursive: true });
    }
    assert.deepEqual(
      findSecurityRuleDirs(rules).map((dir) => dir.slice(rules.length + 1)),
      ["javascript/express/security", "javascript/lang/security", "yaml/github-actions/security"],
    );
  } finally {
    rmSync(rules, { recursive: true, force: true });
  }
});

test("builds scan args that fail on findings and target the project", () => {
  const args = buildScanArgs(["/rules/a", "/rules/b"], "apps/web");
  assert.equal(args[0], "scan");
  assert.ok(args.includes("--error"));
  assert.deepEqual(args.slice(-5), ["-f", "/rules/a", "-f", "/rules/b", "apps/web"]);
});
