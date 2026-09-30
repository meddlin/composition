// Downloads the pinned community Meilisearch binary for the app to bundle.
//
//   pnpm fetch:meilisearch                 both macOS architectures
//   pnpm fetch:meilisearch mac-arm64       one of them
//
// The version, asset names and SHA-256 digests live in meilisearch.lock.json.
// A download that doesn't match its digest is deleted and fails the run.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { downloadUrl, validateLock } from "./meilisearch-lock.mjs";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(fs.readFileSync(path.join(desktopDir, "meilisearch.lock.json"), "utf-8"));

const problems = validateLock(lock);
if (problems.length > 0) {
  console.error(`meilisearch.lock.json is invalid:\n  - ${problems.join("\n  - ")}`);
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
    console.error(`No ${platform} asset in meilisearch.lock.json`);
    process.exit(1);
  }
  const dir = path.join(desktopDir, "resources", "meilisearch", platform);
  const target = path.join(dir, "meilisearch");

  if (fs.existsSync(target) && (await sha256Of(target)) === asset.sha256) {
    console.log(`${platform}: already present (${lock.version}, checksum matches)`);
    continue;
  }

  const url = downloadUrl(lock, platform);
  console.log(`${platform}: downloading ${asset.name} ${lock.version} (${(asset.size / 1048576).toFixed(0)} MiB)\n  ${url}`);
  fs.mkdirSync(dir, { recursive: true });
  const partial = `${target}.partial`;
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
  fs.renameSync(partial, target);
  fs.chmodSync(target, 0o755);
  console.log(`${platform}: ok -> ${path.relative(desktopDir, target)}`);
}
