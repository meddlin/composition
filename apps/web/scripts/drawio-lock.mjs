// Validation and hashing for drawio.lock.json, shared by the fetch script and its test.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const VERSION = /^v\d+\.\d+\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Returns a list of problems with the lock; empty means it is usable. */
export function validateLock(lock) {
  const problems = [];
  if (lock?.repository !== "jgraph/drawio") problems.push("repository must be jgraph/drawio");
  if (!VERSION.test(lock?.version ?? "")) problems.push(`version must look like v1.2.3, got ${lock?.version}`);
  if (!COMMIT.test(lock?.commit ?? "")) problems.push("commit must be a full 40-character lowercase SHA");
  if (!Array.isArray(lock?.include) || lock.include.length === 0) problems.push("include must list at least one path");
  for (const entry of lock?.include ?? []) {
    if (typeof entry !== "string" || entry === "" || entry.startsWith("/") || entry.includes("..")) {
      problems.push(`include entry ${JSON.stringify(entry)} must be a relative path without ..`);
    }
  }
  if (!SHA256.test(lock?.treeSha256 ?? "")) problems.push("treeSha256 must be 64 lowercase hex characters");
  if (!Number.isInteger(lock?.files) || lock.files <= 0) problems.push("files must be a positive integer");
  if (!Number.isInteger(lock?.size) || lock.size <= 0) problems.push("size must be a positive integer");
  return problems;
}

/** The tarball for a commit. Pinned by commit, never by tag, because a tag can be moved. */
export function archiveUrl(lock) {
  return `https://codeload.github.com/${lock.repository}/tar.gz/${lock.commit}`;
}

/** The folder GitHub puts a commit's archive in. */
export const archiveRoot = (lock) => `drawio-${lock.commit}`;

/**
 * Whether a file of draw.io's `src/main/webapp` is vendored. An entry ending in `/` is a folder;
 * any other is a path prefix (`js/shapes-` takes the versioned shape file). Source maps never are.
 */
export function isIncluded(lock, relativePath) {
  if (relativePath.endsWith(".map")) return false;
  return lock.include.some((entry) => relativePath.startsWith(entry));
}

/**
 * One digest for a set of files, independent of how they were packed: the SHA-256 of
 * `<file digest>  <path>` lines in path order. A tarball's own digest is not used because GitHub
 * regenerates archives and does not promise the bytes stay the same.
 */
export function treeDigest(files) {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => `${file.sha256}  ${file.path}\n`);
  return createHash("sha256").update(lines.join("")).digest("hex");
}

export function sha256OfFile(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Every file under `dir` with its digest and size, paths relative to it with `/` separators. */
export function listFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        found.push({
          path: path.relative(dir, full).split(path.sep).join("/"),
          sha256: sha256OfFile(full),
          size: fs.statSync(full).size,
        });
      }
    }
  };
  walk(dir);
  return found;
}
