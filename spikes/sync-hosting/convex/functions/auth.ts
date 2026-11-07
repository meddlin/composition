// Static per-device dev tokens (no Clerk: sign-in is spike S4). The tokens live in the deployment's
// environment variables, set by scripts/deploy-convex.sh from .env.tokens.local.

export interface Identity {
  user: string;
  device: string;
}

export function identify(token: string | undefined): Identity | null {
  if (!token) return null;
  const json = process.env.SYNC_DEV_TOKENS;
  if (!json) return null;
  const tokens = JSON.parse(json) as Record<string, Identity>;
  return tokens[token] ?? null;
}

export function isAdmin(token: string | undefined): boolean {
  const admin = process.env.SYNC_ADMIN_TOKEN;
  return !!admin && token === admin;
}
