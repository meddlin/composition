// Empties the replica bucket and tries to delete it. The wizard asks for an Object Read & Write token scoped
// to this one bucket, which can delete objects but may not be allowed to delete the bucket itself; if so this
// says so and the (now empty, free) bucket can be deleted in the Cloudflare dashboard.

import { DeleteBucketCommand, DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { loadEnv, need } from "./lib/env.ts";

loadEnv();
const bucket = need("R2_BUCKET");
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${need("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: need("R2_ACCESS_KEY_ID"), secretAccessKey: need("R2_SECRET_ACCESS_KEY") },
});

let deleted = 0;
for (;;) {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1000 }));
  const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
  if (keys.length === 0) break;
  await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
  deleted += keys.length;
}
console.log(`R2 bucket ${bucket}: deleted ${deleted} objects`);
try {
  await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
  console.log(`R2 bucket ${bucket}: deleted`);
} catch (err) {
  console.log(`R2 bucket ${bucket}: now empty, but this token cannot delete the bucket (${err instanceof Error ? err.name : "error"}). Delete it in the dashboard: R2 > ${bucket} > Settings > Delete bucket.`);
}
