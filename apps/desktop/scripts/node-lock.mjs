// Validation for node.lock.json, shared by the fetch script and its test.

const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PLATFORM = /^mac-(arm64|x64)$/;

/** The oldest Node the bundled CLI runs on: node:ffi is on by default from 26.10 (apps/cli/bin/composition.mjs). */
export const MIN_NODE = [26, 10, 0];

/** Negative, zero or positive, like a sort comparator, for [major, minor, patch] triples. */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Returns a list of problems with the lock; empty means it is usable. */
export function validateLock(lock) {
  const problems = [];
  const version = VERSION.exec(lock?.version ?? "");
  if (!version) {
    problems.push(`version must look like v26.12.0, got ${lock?.version}`);
  } else if (compareVersions(version.slice(1).map(Number), MIN_NODE) < 0) {
    problems.push(`${lock.version} is older than the ${MIN_NODE.join(".")} the command line tool needs`);
  }
  const assets = lock?.assets ?? {};
  if (Object.keys(assets).length === 0) problems.push("no assets listed");
  for (const [platform, asset] of Object.entries(assets)) {
    if (!PLATFORM.test(platform)) problems.push(`${platform}: unsupported platform key`);
    const arch = platform.replace(/^mac-/, "");
    if (asset?.name !== `node-${lock?.version}-darwin-${arch}.tar.gz`) {
      problems.push(`${platform}: asset name must be node-${lock?.version}-darwin-${arch}.tar.gz, got ${asset?.name}`);
    }
    if (!SHA256.test(asset?.sha256 ?? "")) problems.push(`${platform}: sha256 must be 64 lowercase hex characters`);
    if (!Number.isInteger(asset?.size) || asset.size <= 0) problems.push(`${platform}: size must be a positive integer`);
  }
  return problems;
}

export function downloadUrl(lock, platform) {
  return `https://nodejs.org/dist/${lock.version}/${lock.assets[platform].name}`;
}
