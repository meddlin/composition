// Vendors the pinned draw.io editor, which a note's <Drawio> diagrams are drawn in.
//
//   pnpm fetch:drawio                      into public/drawio (served at /drawio/ by the web app)
//   pnpm fetch:drawio --out <dir>          somewhere else (the desktop app's resources/drawio)
//   pnpm fetch:drawio --update v32.6.0     move the pin to another release, then fetch it
//
// The release, the commit it is, the files kept and one digest over those files live in
// drawio.lock.json. The archive is downloaded by commit, unpacked in a temporary folder, and
// copied over only if the digest of what was kept matches the lock; otherwise nothing is written.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { archiveRoot, archiveUrl, isIncluded, listFiles, sha256OfFile, treeDigest, validateLock } from "./drawio-lock.mjs";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockFile = path.join(webDir, "drawio.lock.json");
const WEBAPP = "src/main/webapp";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? null : (args[at + 1] ?? null);
};
const out = path.resolve(process.cwd(), flag("--out") ?? path.join(webDir, "public", "drawio"));
const updateTo = flag("--update");

let lock = JSON.parse(fs.readFileSync(lockFile, "utf-8"));

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** The vendored files of an unpacked `src/main/webapp`, plus the repository's LICENSE (Apache-2.0 asks that it travels). */
function collect(unpacked, root) {
  const webapp = path.join(unpacked, root, WEBAPP);
  const files = listFiles(webapp).filter((file) => isIncluded(lock, file.path));
  const license = path.join(unpacked, root, "LICENSE");
  if (fs.existsSync(license)) files.push({ path: "LICENSE", sha256: sha256OfFile(license), size: fs.statSync(license).size });
  return { webapp, license, files };
}

async function download() {
  const url = archiveUrl(lock);
  console.log(`downloading draw.io ${lock.version}\n  ${url}`);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "drawio-"));
  const archive = path.join(work, "drawio.tar.gz");
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) fail(`download failed, HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archive));
  const root = archiveRoot(lock);
  execFileSync("tar", ["-xzf", archive, "-C", work, `${root}/${WEBAPP}`, `${root}/LICENSE`], { stdio: "inherit" });
  return { work, root };
}

if (updateTo) {
  const response = await fetch(`https://api.github.com/repos/${lock.repository}/commits/${updateTo}`, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!response.ok) fail(`could not resolve ${updateTo}: HTTP ${response.status}`);
  // The commit, not the tag object: an annotated tag points at a tag object.
  lock = { ...lock, version: updateTo, commit: (await response.json()).sha };
}

const current = (() => {
  if (!fs.existsSync(out)) return null;
  const files = listFiles(out);
  return { files, digest: treeDigest(files) };
})();

if (!updateTo) {
  const problems = validateLock(lock);
  if (problems.length > 0) fail(`drawio.lock.json is invalid:\n  - ${problems.join("\n  - ")}`);
  if (current?.digest === lock.treeSha256) {
    console.log(`already present (${lock.version}, checksum matches): ${path.relative(process.cwd(), out) || "."}`);
    process.exit(0);
  }
}

const { work, root } = await download();
try {
  const { webapp, license, files } = collect(work, root);
  const digest = treeDigest(files);
  const size = files.reduce((sum, file) => sum + file.size, 0);

  if (updateTo) {
    lock = { ...lock, treeSha256: digest, files: files.length, size };
    const problems = validateLock(lock);
    if (problems.length > 0) fail(`the new lock would be invalid:\n  - ${problems.join("\n  - ")}`);
    fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`drawio.lock.json now pins ${lock.version} (${lock.commit}): ${files.length} files, ${(size / 1048576).toFixed(1)} MiB`);
  } else if (digest !== lock.treeSha256) {
    fail(`checksum mismatch; nothing was written.\n  expected ${lock.treeSha256}\n  actual   ${digest}`);
  }

  fs.rmSync(out, { recursive: true, force: true });
  for (const file of files) {
    const from = file.path === "LICENSE" ? license : path.join(webapp, file.path);
    const to = path.join(out, file.path);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  console.log(`ok -> ${path.relative(process.cwd(), out) || "."} (${files.length} files, ${(size / 1048576).toFixed(1)} MiB)`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
