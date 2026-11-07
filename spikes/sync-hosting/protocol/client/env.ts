// Where the clients find tokens and candidate URLs. Same SYNC_DEV_TOKENS the servers read.

export type CandidateName = "lean" | "postgres" | "convex";
export const CANDIDATES: CandidateName[] = ["lean", "postgres", "convex"];

export function parseDevTokens(json = process.env.SYNC_DEV_TOKENS): Record<string, { user: string; device: string }> {
  if (!json) throw new Error("SYNC_DEV_TOKENS is not set. Run `pnpm gen-tokens` (it writes .env.tokens.local).");
  return JSON.parse(json) as Record<string, { user: string; device: string }>;
}

export function tokenFor(user: string, device: string): string {
  const found = Object.entries(parseDevTokens()).find(([, id]) => id.user === user && id.device === device);
  if (!found) throw new Error(`no dev token for ${user}/${device}; run \`pnpm gen-tokens\``);
  return found[0];
}

export function adminToken(): string | undefined {
  return process.env.SYNC_ADMIN_TOKEN;
}

const LOCAL_DEFAULTS: Record<CandidateName, string> = {
  lean: "http://127.0.0.1:8787",
  postgres: "http://127.0.0.1:8788",
  convex: "http://127.0.0.1:3211",
};

/** BASE_URL wins; else CANDIDATE picks SYNC_URL_<NAME> (set by the deploy scripts) or a local default. */
export function resolveBaseUrl(candidate?: string): { name: CandidateName | "custom"; url: string } {
  if (process.env.BASE_URL && !candidate) return { name: "custom", url: process.env.BASE_URL.replace(/\/$/, "") };
  const name = (candidate ?? process.env.CANDIDATE ?? "lean") as CandidateName;
  if (!CANDIDATES.includes(name)) throw new Error(`unknown candidate ${name}; use one of ${CANDIDATES.join(", ")}`);
  const url = process.env[`SYNC_URL_${name.toUpperCase()}`] ?? LOCAL_DEFAULTS[name];
  return { name, url: url.replace(/\/$/, "") };
}
