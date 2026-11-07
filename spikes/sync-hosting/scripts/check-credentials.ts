// Checks every credential the wizard saved and prints pass/fail only, never a value.

import { execFile } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import pg from "pg";
import { ROOT, loadEnv } from "./lib/env.ts";

loadEnv();
const run = promisify(execFile);
let failed = 0;

async function check(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    console.log(`  ok    ${name}: ${await fn()}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL  ${name}: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`);
  }
}

const has = (...names: string[]) => names.every((n) => process.env[n]);

await check("tokens", async () => {
  if (!has("SYNC_DEV_TOKENS", "SYNC_ADMIN_TOKEN")) throw new Error("run `pnpm gen-tokens`");
  return `${Object.keys(JSON.parse(process.env.SYNC_DEV_TOKENS!)).length} device tokens`;
});

await check("fly", async () => {
  if (!has("FLY_ORG", "FLY_REGION", "FLY_APP_SUFFIX")) throw new Error("missing FLY_* values");
  const { stdout } = await run("fly", ["auth", "whoami"]);
  return `signed in as ${stdout.trim()}, region ${process.env.FLY_REGION}`;
});

await check("r2", async () => {
  if (!has("R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")) throw new Error("missing R2_* values");
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
  await s3.send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET! }));
  return `bucket ${process.env.R2_BUCKET} reachable`;
});

await check("neon database", async () => {
  if (!has("NEON_DATABASE_URL")) throw new Error("missing NEON_DATABASE_URL");
  const client = new pg.Client({ connectionString: process.env.NEON_DATABASE_URL, connectionTimeoutMillis: 30_000 });
  const t = performance.now();
  await client.connect();
  const { rows } = await client.query<{ v: string }>("select current_setting('server_version') as v");
  await client.end();
  return `Postgres ${rows[0]!.v}, connected in ${Math.round(performance.now() - t)} ms`;
});

await check("neon api", async () => {
  if (!has("NEON_API_KEY", "NEON_PROJECT_ID")) throw new Error("missing NEON_API_KEY / NEON_PROJECT_ID");
  const res = await fetch(`https://console.neon.tech/api/v2/projects/${process.env.NEON_PROJECT_ID}`, {
    headers: { authorization: `Bearer ${process.env.NEON_API_KEY}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { project?: { region_id?: string; pg_version?: number } };
  return `project found, region ${body.project?.region_id}, Postgres ${body.project?.pg_version}`;
});

await check("convex", async () => {
  // A local anonymous `convex dev` leaves .env.local behind; the CLI would mix it up with the deploy key.
  const local = join(ROOT, ".env.local");
  const hidden = join(ROOT, ".env.local.hidden");
  const hide = existsSync(local) && readFileSync(local, "utf8").includes("CONVEX_DEPLOYMENT=");
  if (hide) renameSync(local, hidden);
  try {
    return await checkConvex();
  } finally {
    if (hide) renameSync(hidden, local);
  }
});

async function checkConvex(): Promise<string> {
  if (!has("CONVEX_URL", "CONVEX_SITE_URL", "CONVEX_DEPLOY_KEY")) throw new Error("missing CONVEX_* values");
  if (!process.env.CONVEX_DEPLOY_KEY!.startsWith("prod:")) throw new Error("deploy key does not start with prod:");
  const { stdout } = await run("pnpm", ["exec", "convex", "env", "list", "--names-only"], { cwd: ROOT, env: process.env });
  return `deploy key accepted (${stdout.trim().split("\n").filter(Boolean).length} env vars set)`;
}

console.log(failed === 0 ? "\nAll credentials check out." : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
