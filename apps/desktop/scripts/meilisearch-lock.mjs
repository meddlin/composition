// Validation for meilisearch.lock.json, shared by the fetch script and its test.

const VERSION = /^v\d+\.\d+\.\d+$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** Returns a list of problems with the lock; empty means it is usable. */
export function validateLock(lock) {
  const problems = [];
  if (lock?.repository !== "meilisearch/meilisearch") problems.push("repository must be meilisearch/meilisearch");
  if (!VERSION.test(lock?.version ?? "")) problems.push(`version must look like v1.2.3, got ${lock?.version}`);
  const assets = lock?.assets ?? {};
  if (Object.keys(assets).length === 0) problems.push("no assets listed");
  for (const [platform, asset] of Object.entries(assets)) {
    if (!/^mac-(arm64|x64)$/.test(platform)) problems.push(`${platform}: unsupported platform key`);
    // Enterprise builds are BUSL-licensed and not allowed in production.
    if (/enterprise/i.test(asset?.name ?? "")) problems.push(`${platform}: ${asset.name} is an Enterprise Edition build`);
    if (!/^meilisearch-[a-z0-9.-]+$/.test(asset?.name ?? "")) problems.push(`${platform}: unexpected asset name ${asset?.name}`);
    if (!SHA256.test(asset?.sha256 ?? "")) problems.push(`${platform}: sha256 must be 64 lowercase hex characters`);
    if (!Number.isInteger(asset?.size) || asset.size <= 0) problems.push(`${platform}: size must be a positive integer`);
  }
  return problems;
}

export function downloadUrl(lock, platform) {
  return `https://github.com/${lock.repository}/releases/download/${lock.version}/${lock.assets[platform].name}`;
}
