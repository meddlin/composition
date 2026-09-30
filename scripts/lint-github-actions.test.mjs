import assert from "node:assert/strict";
import { test } from "node:test";
import { lintWorkflow } from "./lint-github-actions.mjs";

const SHA = "11d5960a326750d5838078e36cf38b85af677262";
const problemsFor = (line) => lintWorkflow(line).map((p) => p.message);

test("accepts a commit SHA with a version comment", () => {
  assert.deepEqual(problemsFor(`      - uses: actions/checkout@${SHA} # v4.4.0`), []);
  assert.deepEqual(problemsFor(`        uses: owner/repo/sub/path@${SHA} # v1.2`), []);
});

test("rejects tags and branches", () => {
  assert.equal(problemsFor("- uses: actions/checkout@v4").length, 1);
  assert.equal(problemsFor("- uses: actions/checkout@main").length, 1);
  assert.equal(problemsFor("- uses: actions/checkout").length, 1);
});

test("rejects short SHAs", () => {
  assert.equal(problemsFor(`- uses: actions/checkout@${SHA.slice(0, 7)} # v4.4.0`).length, 1);
});

test("requires a version comment", () => {
  assert.equal(problemsFor(`- uses: actions/checkout@${SHA}`).length, 1);
  assert.equal(problemsFor(`- uses: actions/checkout@${SHA} # latest`).length, 1);
  assert.equal(problemsFor(`- uses: actions/checkout@${SHA} # v4`).length, 1);
});

test("handles quoted refs", () => {
  assert.deepEqual(problemsFor(`- uses: "actions/checkout@${SHA}" # v4.4.0`), []);
  assert.equal(problemsFor(`- uses: 'actions/checkout@v4'`).length, 1);
});

test("exempts local actions, requires digests for docker images", () => {
  assert.deepEqual(problemsFor("- uses: ./.github/actions/setup"), []);
  assert.equal(problemsFor("- uses: docker://alpine:3.20").length, 1);
  assert.deepEqual(problemsFor(`- uses: docker://alpine@sha256:${"a".repeat(64)}`), []);
});

test("ignores commented-out lines and non-uses keys", () => {
  assert.deepEqual(problemsFor("      # - uses: actions/checkout@v4"), []);
  assert.deepEqual(problemsFor("      - name: uses: nothing"), []);
});

test("reports line numbers", () => {
  const [problem] = lintWorkflow(`steps:\n  - uses: actions/checkout@v4\n`);
  assert.equal(problem.line, 2);
});
