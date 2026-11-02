import { describe, expect, it, vi } from "vitest";
import { buildAuthorizeUrl, exchangeCode, newHostId, newPkce, readCallback, refreshTokens } from "./oauth";

const idToken = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

const reply = (body: unknown, status = 200) => vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch;

describe("buildAuthorizeUrl", () => {
  const pkce = newPkce();
  const redirectUri = "http://127.0.0.1:1455/auth/callback";

  it("registers as the dynamic client on a first sign-in, naming the app", () => {
    const url = new URL(buildAuthorizeUrl({ redirectUri, pkce, hostId: "urn:uuid:1" }));
    expect(url.origin + url.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    const p = url.searchParams;
    expect(p.get("client_id")).toBe("dynamic_agent_client");
    expect(p.get("agent_name_hint")).toBe("Composition");
    expect(p.get("ext_agent_host_id")).toBe("urn:uuid:1");
    expect(p.get("redirect_uri")).toBe(redirectUri);
    expect(p.get("resource")).toBe("https://api.openai.com/v1");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe(pkce.challenge);
    expect(p.get("state")).toBe(pkce.state);
    expect(p.get("scope")?.split(" ")).toContain("chatgpt.tokens.use.direct");
  });

  it("uses the issued client id, and no name, on a return visit", () => {
    const p = new URL(buildAuthorizeUrl({ redirectUri, pkce, hostId: "urn:uuid:1", clientId: "oaiapp_abc" })).searchParams;
    expect(p.get("client_id")).toBe("oaiapp_abc");
    expect(p.has("agent_name_hint")).toBe(false);
  });
});

describe("newHostId", () => {
  it("is a urn:uuid, the form the authorize endpoint accepts", () => {
    expect(newHostId()).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
  });
});

describe("readCallback", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("returns the code and the issued client id", () => {
    expect(readCallback(params("code=c&state=s&client_id=oaiapp_1"), "s")).toEqual({ ok: true, code: "c", clientId: "oaiapp_1" });
  });

  it("treats another state as a stray answer to ignore", () => {
    expect(readCallback(params("code=c&state=other"), "s")).toMatchObject({ ok: false, stray: true });
  });

  it("says a cancelled approval was cancelled", () => {
    expect(readCallback(params("error=access_denied&state=s"), "s")).toEqual({ ok: false, error: "Sign-in was cancelled." });
  });

  it("fails when there is no code", () => {
    expect(readCallback(params("state=s"), "s")).toMatchObject({ ok: false });
  });
});

describe("exchangeCode and refreshTokens", () => {
  const body = {
    access_token: "a1",
    refresh_token: "r1",
    expires_in: 3600,
    scope: "openid chatgpt.tokens.use.direct",
    id_token: idToken({ email: "me@example.com" }),
  };

  it("turns a grant into tokens that expire an hour from now, with the email and scopes", async () => {
    const fetchImpl = reply(body);
    const result = await exchangeCode({ clientId: "oaiapp_1", code: "c", verifier: "v", redirectUri: "http://127.0.0.1:1/auth/callback" }, 1000, fetchImpl);
    expect(result).toEqual({
      ok: true,
      tokens: { accessToken: "a1", refreshToken: "r1", expiresAt: 1000 + 3_600_000, email: "me@example.com", scopes: ["openid", "chatgpt.tokens.use.direct"] },
    });
    const sent = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as URLSearchParams;
    expect(Object.fromEntries(sent)).toMatchObject({ grant_type: "authorization_code", client_id: "oaiapp_1", code: "c", code_verifier: "v", resource: "https://api.openai.com/v1" });
  });

  it("sends the refresh grant with the resource", async () => {
    const fetchImpl = reply(body);
    await refreshTokens({ clientId: "oaiapp_1", refreshToken: "old" }, 0, fetchImpl);
    const sent = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as URLSearchParams;
    expect(Object.fromEntries(sent)).toEqual({ grant_type: "refresh_token", client_id: "oaiapp_1", refresh_token: "old", resource: "https://api.openai.com/v1" });
  });

  it("marks a revoked grant as invalid, so the caller signs out", async () => {
    const result = await refreshTokens({ clientId: "c", refreshToken: "r" }, 0, reply({ error: "invalid_grant" }, 400));
    expect(result).toMatchObject({ ok: false, invalid: true });
  });

  it("does not mark a server fault or a network failure as invalid", async () => {
    expect(await refreshTokens({ clientId: "c", refreshToken: "r" }, 0, reply({}, 503))).toMatchObject({ ok: false, invalid: false });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await refreshTokens({ clientId: "c", refreshToken: "r" }, 0, down)).toMatchObject({ ok: false, invalid: false });
  });

  it("rejects an answer without the tokens", async () => {
    expect(await refreshTokens({ clientId: "c", refreshToken: "r" }, 0, reply({ access_token: "a" }))).toMatchObject({ ok: false });
  });
});
