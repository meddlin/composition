import crypto from "node:crypto";

/**
 * Sign in with ChatGPT, the open-source flow that lets an app spend the user's ChatGPT plan instead of an API
 * key (https://developers.openai.com/siwc/token-sharing-open-source/sign-in). A public OAuth client with PKCE:
 * the first sign-in registers as `dynamic_agent_client` and OpenAI answers with a client id of its own, which is
 * saved and used from then on. No secret is involved.
 */
const AUTHORIZE_URL = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_URL = "https://auth.openai.com/api/accounts/oauth/token";
export const CHATGPT_RESOURCE = "https://api.openai.com/v1";
const REGISTRATION_CLIENT_ID = "dynamic_agent_client";
const SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
export const PLAN_USAGE_SCOPE = "chatgpt.tokens.use.direct";
const APP_NAME = "Composition";

/** The path OpenAI was told about; later sign-ins may use another port but must keep the scheme, host and path. */
export const CALLBACK_PATH = "/auth/callback";

export type Credentials = {
  /** The client id OpenAI issued for this registration (never `dynamic_agent_client`). */
  clientId: string;
  /** Stable for this install: sent with every sign-in so OpenAI can tell hosts apart. Opaque, not a secret. */
  hostId: string;
  accessToken: string;
  refreshToken: string;
  /** When the access token stops working, in milliseconds since the epoch. */
  expiresAt: number;
  /** The signed-in account's email, for the Settings page to show. */
  email?: string;
};

export type Pkce = { verifier: string; challenge: string; state: string; nonce: string };

export function newPkce(): Pkce {
  const verifier = crypto.randomBytes(48).toString("base64url");
  return {
    verifier,
    challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    state: crypto.randomBytes(16).toString("base64url"),
    nonce: crypto.randomBytes(16).toString("base64url"),
  };
}

/** The host id is a URN, per OpenAI's own example; a plain string is refused with `invalid_authorize_request`. */
export const newHostId = (): string => `urn:uuid:${crypto.randomUUID()}`;

/**
 * The address to send the browser to. A returning user passes the `clientId` OpenAI issued; a first sign-in
 * leaves it out, registers as `dynamic_agent_client` and names the app (a name is only sent on registration).
 */
export function buildAuthorizeUrl(options: { redirectUri: string; pkce: Pkce; hostId: string; clientId?: string }): string {
  const { redirectUri, pkce, hostId, clientId } = options;
  const url = new URL(AUTHORIZE_URL);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: clientId ?? REGISTRATION_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: SCOPE,
    resource: CHATGPT_RESOURCE,
    state: pkce.state,
    nonce: pkce.nonce,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    ext_agent_host_id: hostId,
    ...(clientId === undefined && { agent_name_hint: APP_NAME }),
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export type Callback =
  | { ok: true; code: string; clientId: string | undefined }
  | { ok: false; error: string; /** Not an answer to this attempt at all (another page, a stale tab): ignore it and keep waiting. */ stray?: boolean };

/** What the browser brought back to the loopback address. `state` must be the one this attempt sent. */
export function readCallback(params: URLSearchParams, expectedState: string): Callback {
  if (params.get("state") !== expectedState) {
    return { ok: false, error: "The sign-in answer did not match this attempt, so it was ignored.", stray: true };
  }
  const refused = params.get("error");
  if (refused) {
    const detail = params.get("error_description");
    return { ok: false, error: refused === "access_denied" ? "Sign-in was cancelled." : `ChatGPT refused the sign-in: ${detail ?? refused}.` };
  }
  const code = params.get("code");
  if (!code) return { ok: false, error: "ChatGPT did not send back a sign-in code." };
  return { ok: true, code, clientId: params.get("client_id") ?? undefined };
}

type TokenReply = {
  access_token?: unknown;
  refresh_token?: unknown;
  id_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
};

export type Tokens = { accessToken: string; refreshToken: string; expiresAt: number; email?: string; scopes: string[] };

export type TokenResult = { ok: true; tokens: Tokens } | { ok: false; error: string; /** The grant is no longer good: sign in again. */ invalid: boolean };

/** Whatever `fetch` is, so a test can stand in for the network. */
export type Fetch = typeof fetch;

async function requestTokens(body: Record<string, string>, now: number, fetchImpl: Fetch, signal?: AbortSignal): Promise<TokenResult> {
  let response: Response;
  try {
    response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal,
    });
  } catch {
    return { ok: false, error: "Couldn't reach OpenAI to sign in. Check the network connection.", invalid: false };
  }
  let reply: TokenReply = {};
  try {
    reply = (await response.json()) as TokenReply;
  } catch {
    // Not JSON: handled below.
  }
  if (!response.ok) {
    const said = typeof reply.error_description === "string" ? reply.error_description : typeof reply.error === "string" ? reply.error : "";
    const invalid = reply.error === "invalid_grant" || response.status === 400 || response.status === 401;
    return { ok: false, error: `OpenAI refused the sign-in${said ? `: ${said}` : ` (${response.status})`}.`, invalid };
  }
  if (typeof reply.access_token !== "string" || typeof reply.refresh_token !== "string" || typeof reply.expires_in !== "number") {
    return { ok: false, error: "OpenAI's sign-in answer was not what was expected.", invalid: false };
  }
  return {
    ok: true,
    tokens: {
      accessToken: reply.access_token,
      refreshToken: reply.refresh_token,
      expiresAt: now + reply.expires_in * 1000,
      email: emailOf(reply.id_token),
      scopes: typeof reply.scope === "string" ? reply.scope.split(" ") : [],
    },
  };
}

/**
 * The email in an ID token, only to show the user which account is signed in. The token came straight from
 * OpenAI over TLS in reply to our own request, and nothing is decided from this value, so it is read without
 * verifying the signature.
 */
function emailOf(idToken: unknown): string | undefined {
  if (typeof idToken !== "string") return undefined;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: unknown };
    return typeof payload.email === "string" ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

export function exchangeCode(
  options: { clientId: string; code: string; verifier: string; redirectUri: string },
  now: number,
  fetchImpl: Fetch = fetch,
  signal?: AbortSignal,
): Promise<TokenResult> {
  return requestTokens(
    {
      grant_type: "authorization_code",
      client_id: options.clientId,
      code: options.code,
      code_verifier: options.verifier,
      redirect_uri: options.redirectUri,
      resource: CHATGPT_RESOURCE,
    },
    now,
    fetchImpl,
    signal,
  );
}

/** Each refresh returns a new refresh token and the old one stops working, so the caller must save both together. */
export function refreshTokens(
  credentials: Pick<Credentials, "clientId" | "refreshToken">,
  now: number,
  fetchImpl: Fetch = fetch,
  signal?: AbortSignal,
): Promise<TokenResult> {
  return requestTokens(
    { grant_type: "refresh_token", client_id: credentials.clientId, refresh_token: credentials.refreshToken, resource: CHATGPT_RESOURCE },
    now,
    fetchImpl,
    signal,
  );
}
