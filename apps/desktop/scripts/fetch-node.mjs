// Downloads the pinned official Node.js runtime that the bundled command line tool runs on.
//
//   pnpm fetch:node                 both macOS architectures
//   pnpm fetch:node mac-arm64       one of them
//
// The version and SHA-256 digests live in node.lock.json. The tarball is checked against its
// digest before anything is unpacked; a mismatch deletes it and fails the run. Only the `node`
// binary and Node's LICENSE are kept, in resources/node/<platform>/.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { downloadUrl, validateLock } from "./node-lock.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(desktopDir, "node.lock.json"), "utf-8"));

const problems = validateLock(lock);
if (problems.length > 0) {
  console.error(`node.lock.json is invalid:\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}

const requested = process.argv.slice(2);
const platforms = requested.length > 0 ? requested : Object.keys(lock.assets);

async function sha256Of(file) {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

for (const platform of platforms) {
  const asset = lock.assets[platform];
  if (!asset) {
    console.error(`No ${platform} asset in node.lock.json`);
    process.exit(1);
  }
  const dir = path.join(desktopDir, "resources", "node", platform);
  const target = path.join(dir, "node");
  // Written last, so a half-finished earlier run is never mistaken for a good one.
  const stamp = path.join(dir, "tarball.sha256");

  if (fs.existsSync(target) && fs.existsSync(stamp) && fs.readFileSync(stamp, "utf-8").trim() === asset.sha256) {
    console.log(`${platform}: already present (${lock.version}, checksum matches)`);
    continue;
  }

  const url = downloadUrl(lock, platform);
  console.log(`${platform}: downloading ${asset.name} (${(asset.size / 1048576).toFixed(0)} MiB)\n  ${url}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const partial = path.join(dir, `${asset.name}.partial`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    console.error(`${platform}: download failed, HTTP ${response.status}`);
    process.exit(1);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));

  const actual = await sha256Of(partial);
  if (actual !== asset.sha256) {
    fs.rmSync(partial, { force: true });
    console.error(`${platform}: checksum mismatch.\n  expected ${asset.sha256}\n  actual   ${actual}`);
    process.exit(1);
  }

  // The tarball has a single top-level folder named after itself.
  const root = asset.name.replace(/\.tar\.gz$/, "");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "composition-node-"));
  const untar = spawnSync("tar", ["-xzf", partial, "-C", scratch, "--strip-components=1", `${root}/bin/node`, `${root}/LICENSE`], {
    encoding: "utf-8",
  });
  if (untar.status !== 0) {
    console.error(`${platform}: couldn't unpack ${asset.name}: ${untar.stderr}`);
    fs.rmSync(scratch, { recursive: true, force: true });
    process.exit(1);
  }
  fs.renameSync(path.join(scratch, "bin", "node"), target);
  fs.renameSync(path.join(scratch, "LICENSE"), path.join(dir, "LICENSE"));
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(partial, { force: true });
  fs.chmodSync(target, 0o755);
  fs.writeFileSync(stamp, `${asset.sha256}\n`);
  console.log(`${platform}: ok -> ${path.relative(desktopDir, target)}`);
}
