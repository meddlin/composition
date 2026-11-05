// Downloads the two Windows binaries the plan bundles, checked against pinned digests, into $SPIKE_DIR:
//   node.exe             Node v26.12.0 (nodejs.org publishes the bare exe as well as the zip)
//   composition-node.exe a copy of it under the name the plan proposes, so the rename is tested too
//   meilisearch.exe      Meilisearch v1.53.1, the community build
// The digests are the ones in docs/windows-build-plan.md (SHASUMS256.txt and the release's asset digest).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const dir = process.env.SPIKE_DIR;
if (!dir) throw new Error("SPIKE_DIR is not set");
fs.mkdirSync(dir, { recursive: true });

const assets = [
  {
    file: "node.exe",
    url: "https://nodejs.org/dist/v26.12.0/win-x64/node.exe",
    sha256: "1a14457b043fe82fd2fc027959595e91d138a8185c7ca6c02c15c16632b51aa4",
  },
  {
    file: "meilisearch.exe",
    url: "https://github.com/meilisearch/meilisearch/releases/download/v1.53.1/meilisearch-windows-amd64.exe",
    sha256: "1c242ec430f222346c26eb0971bea5d70f748d5ed10cd7b1c40fb00df51aca86",
  },
];

for (const asset of assets) {
  const target = path.join(dir, asset.file);
  console.log(`downloading ${asset.url}`);
  const response = await fetch(asset.url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`${asset.file}: HTTP ${response.status}`);
  const hash = createHash("sha256");
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    fs.createWriteStream(target),
  );
  const actual = hash.digest("hex");
  if (actual !== asset.sha256) {
    fs.rmSync(target, { force: true });
    throw new Error(`${asset.file}: checksum mismatch\n  expected ${asset.sha256}\n  actual   ${actual}`);
  }
  console.log(`${asset.file}: ok (${fs.statSync(target).size} bytes)`);
}

fs.copyFileSync(path.join(dir, "node.exe"), path.join(dir, "composition-node.exe"));
for (const file of ["node.exe", "composition-node.exe", "meilisearch.exe"]) fs.chmodSync(path.join(dir, file), 0o755);
console.log("composition-node.exe: copied from node.exe");
