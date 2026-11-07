// Loads the gitignored env files the wizard wrote, without printing anything. Shared by the deploy,
// drill, teardown and check scripts.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const ENV_FILES = [".env.tokens.local", ".env.fly.local", ".env.r2.local", ".env.neon.local", ".env.convex.local", ".env.candidates.local"];

export function loadEnv(): void {
  for (const name of ENV_FILES) {
    const file = join(ROOT, name);
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Run scripts/wizard.sh (it writes the .env.*.local files).`);
  return v;
}

export function flyApps(): { lean: string; pg: string } {
  const suffix = need("FLY_APP_SUFFIX");
  return { lean: `comp-sync-lean-${suffix}`, pg: `comp-sync-pg-${suffix}` };
}
