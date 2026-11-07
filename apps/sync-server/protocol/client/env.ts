// Where the contract suite finds the server and the tokens it signs in with.

/** A server you started yourself is expected here unless BASE_URL says otherwise. */
const DEFAULT_BASE_URL = "http://127.0.0.1:8787";

export function baseUrl(): string {
  return (process.env.BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
}

/** SYNC_DEV_TOKENS is a JSON object of token -> {user, device}. `pnpm test` builds it from tokens made by lean/tokens.ts. */
export function parseDevTokens(json = process.env.SYNC_DEV_TOKENS): Record<string, { user: string; device: string }> {
  if (!json) throw new Error("SYNC_DEV_TOKENS is not set. Run `pnpm test`, or see the top of protocol/contract/suite.test.ts.");
  return JSON.parse(json) as Record<string, { user: string; device: string }>;
}

export function tokenFor(user: string, device: string): string {
  const found = Object.entries(parseDevTokens()).find(([, id]) => id.user === user && id.device === device);
  if (!found) throw new Error(`no token for ${user}/${device} in SYNC_DEV_TOKENS`);
  return found[0];
}

export function adminToken(): string | undefined {
  return process.env.SYNC_ADMIN_TOKEN;
}
