import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCredentials, writeCredentials } from "./credentials";
import type { Credentials } from "./oauth";
import { createChatGptSession } from "./session";

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "chatgpt-session-"));
  file = path.join(dir, "chatgpt-auth.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const idToken = `x.${Buffer.from(JSON.stringify({ email: "me@example.com" })).toString("base64url")}.y`;
const granted = { access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, scope: "openid chatgpt.tokens.use.direct", id_token: idToken };

const saved = (over: Partial<Credentials> = {}): Credentials => ({
  clientId: "oaiapp_1",
  hostId: "urn:uuid:host",
  accessToken: "old-access",
  refreshToken: "old-refresh",
  expiresAt: 10_000_000,
  ...over,
});

/** The browser's part of the sign-in: read the authorize address, then come back to the loopback address. */
function approvingBrowser(query: (state: string) => string) {
  const opened: URL[] = [];
  const openUrl = async (address: string) => {
    const url = new URL(address);
    opened.push(url);
    const back = `${url.searchParams.get("redirect_uri")}?${query(url.searchParams.get("state")!)}`;
    // The test may end the sign-in before this arrives; that is not a failure of the code under test.
    void fetch(back).catch(() => {});
  };
  return { opened, openUrl };
}

const settle = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
};

describe("sign-in", () => {
  it("registers, exchanges the code, and saves the account with the issued client id", async () => {
    const fetchImpl = vi.fn(async () => Response.json(granted)) as unknown as typeof fetch;
    const browser = approvingBrowser((state) => `code=the-code&state=${state}&client_id=oaiapp_new`);
    const session = createChatGptSession({ credentialsFile: () => file, fetch: fetchImpl, openUrl: browser.openUrl, ports: [0], now: () => 1000 });

    expect(session.status()).toEqual({ state: "signed-out" });
    expect(await session.startSignIn()).toEqual({});
    expect(browser.opened[0].searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(browser.opened[0].searchParams.get("ext_agent_host_id")).toMatch(/^urn:uuid:/);
    expect(browser.opened[0].searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);

    await settle(() => session.status().state === "signed-in");
    expect(session.status()).toEqual({ state: "signed-in", email: "me@example.com" });
    expect(readCredentials(file)).toMatchObject({ clientId: "oaiapp_new", accessToken: "access-1", refreshToken: "refresh-1", expiresAt: 1000 + 3_600_000 });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it("is pending until the browser comes back", async () => {
    const session = createChatGptSession({ credentialsFile: () => file, openUrl: async () => {}, ports: [0] });
    await session.startSignIn();
    expect(session.status()).toEqual({ state: "pending" });
    session.signOut();
    expect(session.status()).toEqual({ state: "signed-out" });
  });

  it("does not sign in when the plan-usage permission was not granted", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ...granted, scope: "openid" })) as unknown as typeof fetch;
    const browser = approvingBrowser((state) => `code=c&state=${state}&client_id=oaiapp_1`);
    const session = createChatGptSession({ credentialsFile: () => file, fetch: fetchImpl, openUrl: browser.openUrl, ports: [0] });
    await session.startSignIn();
    await settle(() => session.status().state === "signed-out" && "error" in session.status());
    expect(session.status()).toMatchObject({ state: "signed-out", error: expect.stringMatching(/use your plan/) });
    expect(readCredentials(file)).toBeUndefined();
  });

  it("reports a cancelled approval", async () => {
    const browser = approvingBrowser((state) => `error=access_denied&state=${state}`);
    const session = createChatGptSession({ credentialsFile: () => file, openUrl: browser.openUrl, ports: [0] });
    await session.startSignIn();
    await settle(() => session.status().state === "signed-out");
    expect(session.status()).toEqual({ state: "signed-out", error: "Sign-in was cancelled." });
  });

  it("ignores an answer carrying another state and keeps waiting", async () => {
    const browser = approvingBrowser(() => "code=c&state=not-mine&client_id=oaiapp_1");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const session = createChatGptSession({ credentialsFile: () => file, fetch: fetchImpl, openUrl: browser.openUrl, ports: [0] });
    await session.startSignIn();
    await new Promise((r) => setTimeout(r, 100));
    expect(session.status()).toEqual({ state: "pending" });
    expect(fetchImpl).not.toHaveBeenCalled();
    session.signOut();
  });

  it("falls back to another port when the first is taken", async () => {
    const taken = (await import("node:http")).createServer();
    await new Promise<void>((r) => taken.listen(0, "127.0.0.1", r));
    const busy = (taken.address() as { port: number }).port;
    const browser = approvingBrowser(() => "x=1");
    const session = createChatGptSession({ credentialsFile: () => file, openUrl: browser.openUrl, ports: [busy, 0] });
    expect(await session.startSignIn()).toEqual({});
    expect(browser.opened[0].searchParams.get("redirect_uri")).not.toContain(`:${busy}/`);
    session.signOut();
    taken.close();
  });

  it("gives the address to open by hand when the browser cannot be opened", async () => {
    const session = createChatGptSession({
      credentialsFile: () => file,
      openUrl: async () => {
        throw new Error("no browser");
      },
      ports: [0],
    });
    const result = await session.startSignIn();
    expect(result.error).toContain("https://auth.openai.com/api/accounts/authorize");
    expect(session.status()).toEqual({ state: "signed-out" });
  });
});

describe("accessToken", () => {
  it("says to sign in when there is no account", async () => {
    const session = createChatGptSession({ credentialsFile: () => file });
    expect(await session.accessToken()).toMatchObject({ ok: false, failure: { kind: "auth" } });
  });

  it("returns the saved token while it has time left", async () => {
    writeCredentials(file, saved());
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const session = createChatGptSession({ credentialsFile: () => file, fetch: fetchImpl, now: () => 1000 });
    expect(await session.accessToken()).toEqual({ ok: true, accessToken: "old-access" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("renews a token that is about to expire, saving the new refresh token", async () => {
    writeCredentials(file, saved({ expiresAt: 1000 + 60_000 }));
    const fetchImpl = vi.fn(async () => Response.json(granted)) as unknown as typeof fetch;
    const session = createChatGptSession({ credentialsFile: () => file, fetch: fetchImpl, now: () => 1000 });
    expect(await session.accessToken()).toEqual({ ok: true, accessToken: "access-1" });
    expect(readCredentials(file)).toMatchObject({ clientId: "oaiapp_1", hostId: "urn:uuid:host", accessToken: "access-1", refreshToken: "refresh-1" });
  });

  it("shares one renewal between turns that ask together", async () => {
    writeCredentials(file, saved({ expiresAt: 1000 }));
    const fetchImpl = vi.fn(async () => Response.json(granted)) as unknown as typeof fetch;
    const session = createChatGptSession({ credentialsFile: () => file, fetch: fetchImpl, now: () => 1000 });
    const [a, b] = await Promise.all([session.accessToken(), session.accessToken()]);
    expect(a).toEqual(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("signs out when the refresh token was revoked", async () => {
    writeCredentials(file, saved({ expiresAt: 1000 }));
    const fetchImpl = vi.fn(async () => Response.json({ error: "invalid_grant" }, { status: 400 })) as unknown as typeof fetch;
    const session = createChatGptSession({ credentialsFile: () => file, fetch: fetchImpl, now: () => 1000 });
    expect(await session.accessToken()).toMatchObject({ ok: false, failure: { kind: "auth", message: expect.stringMatching(/Sign in again/) } });
    expect(readCredentials(file)).toBeUndefined();
  });

  it("keeps using a token that has not run out when a renewal fails for another reason", async () => {
    writeCredentials(file, saved({ expiresAt: 1000 + 60_000 }));
    const fetchImpl = vi.fn(async () => Response.json({}, { status: 503 })) as unknown as typeof fetch;
    const session = createChatGptSession({ credentialsFile: () => file, fetch: fetchImpl, now: () => 1000 });
    expect(await session.accessToken()).toEqual({ ok: true, accessToken: "old-access" });
    expect(readCredentials(file)).toMatchObject({ refreshToken: "old-refresh" });
  });
});

describe("signOut", () => {
  it("forgets the account on this computer", () => {
    writeCredentials(file, saved());
    const session = createChatGptSession({ credentialsFile: () => file });
    expect(session.status()).toMatchObject({ state: "signed-in" });
    session.signOut();
    expect(session.status()).toEqual({ state: "signed-out" });
    expect(fs.existsSync(file)).toBe(false);
  });
});
