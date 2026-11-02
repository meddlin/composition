import { execFile } from "node:child_process";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Failure } from "../errors";
import type { ChatGptStatus } from "../types";
import { deleteCredentials, readCredentials, writeCredentials } from "./credentials";
import {
  buildAuthorizeUrl,
  CALLBACK_PATH,
  exchangeCode,
  newHostId,
  newPkce,
  PLAN_USAGE_SCOPE,
  readCallback,
  refreshTokens,
  type Credentials,
  type Fetch,
} from "./oauth";

/** The port OpenAI's examples use; another is taken when it is busy (Codex's own sign-in listens here too). */
const PREFERRED_PORT = 1455;
/** How long the browser has to come back after the user is sent to ChatGPT. */
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
/** A token this close to the end of its hour is renewed first, so one never dies halfway through an answer. */
const RENEW_BEFORE_MS = 5 * 60_000;

const PAGE_HEAD = '<!doctype html><meta charset="utf-8"><title>Composition</title>';

export type AccessToken = { ok: true; accessToken: string } | { ok: false; failure: Failure };

export type SignInStart = { error?: string };

export type ChatGptSession = {
  status(): ChatGptStatus;
  /** Opens ChatGPT's approval page in the browser and waits for it to come back to this computer. */
  startSignIn(): Promise<SignInStart>;
  /** Forgets the account here, and stops a sign-in that is waiting. */
  signOut(): void;
  /** A token that works now, renewed first when it is about to expire. */
  accessToken(): Promise<AccessToken>;
};

export type SessionOptions = {
  /** Read on every use, so a test (or a changed settings path) takes effect without rebuilding the session. */
  credentialsFile: () => string;
  fetch?: Fetch;
  now?: () => number;
  /** Shows the approval page to the user. The default asks the operating system to open it in the default browser. */
  openUrl?: (url: string) => Promise<void>;
  /** The loopback ports to try, in order; 0 means any free one. */
  ports?: readonly number[];
  timeoutMs?: number;
};

function openInBrowser(url: string): Promise<void> {
  const [command, ...args] =
    process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url.replace(/&/g, "^&")] : ["xdg-open", url];
  return new Promise((resolve, reject) => {
    execFile(command, args, (error) => (error ? reject(error) : resolve()));
  });
}

function listenOnLoopback(server: http.Server, ports: readonly number[]): Promise<number> {
  const attempt = (index: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE" && index + 1 < ports.length) resolve(attempt(index + 1));
        else reject(error);
      };
      server.once("error", onError);
      server.listen(ports[index], "127.0.0.1", () => {
        server.off("error", onError);
        resolve((server.address() as AddressInfo).port);
      });
    });
  return attempt(0);
}

const authFailure = (message: string): Failure => ({ kind: "auth", message });

export function createChatGptSession(options: SessionOptions): ChatGptSession {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const openUrl = options.openUrl ?? openInBrowser;
  const ports = options.ports ?? [PREFERRED_PORT, 0];
  const timeoutMs = options.timeoutMs ?? SIGN_IN_TIMEOUT_MS;

  let waiting: { stop(): void } | undefined;
  /** The browser has come back and the code is being exchanged for tokens. */
  let finishing = false;
  let lastError: string | undefined;
  let renewing: Promise<AccessToken> | undefined;

  function stopWaiting() {
    waiting?.stop();
    waiting = undefined;
  }

  async function finishSignIn(
    code: string,
    issuedClientId: string | undefined,
    pkce: { verifier: string },
    redirectUri: string,
    hostId: string,
    knownClientId: string | undefined,
  ): Promise<void> {
    finishing = true;
    try {
      await complete(code, issuedClientId, pkce, redirectUri, hostId, knownClientId);
    } finally {
      finishing = false;
    }
  }

  async function complete(
    code: string,
    issuedClientId: string | undefined,
    pkce: { verifier: string },
    redirectUri: string,
    hostId: string,
    knownClientId: string | undefined,
  ): Promise<void> {
    const clientId = issuedClientId ?? knownClientId;
    if (!clientId) {
      lastError = "ChatGPT did not say which client was registered, so the sign-in could not be finished.";
      return;
    }
    const result = await exchangeCode({ clientId, code, verifier: pkce.verifier, redirectUri }, now(), fetchImpl);
    if (!result.ok) {
      lastError = result.error;
      return;
    }
    if (!result.tokens.scopes.includes(PLAN_USAGE_SCOPE)) {
      lastError = "ChatGPT signed you in but did not allow this app to use your plan. Try again and allow it on the approval page.";
      return;
    }
    const { tokens } = result;
    writeCredentials(options.credentialsFile(), {
      clientId,
      hostId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      ...(tokens.email !== undefined && { email: tokens.email }),
    });
    lastError = undefined;
  }

  async function startSignIn(): Promise<SignInStart> {
    stopWaiting();
    lastError = undefined;
    const known = readCredentials(options.credentialsFile());
    const pkce = newPkce();
    const hostId = known?.hostId ?? newHostId();

    let redirectUri = "";
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      // Only the browser's own return trip is answered: another page or a rebinding host name is not.
      const hostOk = request.headers.host === new URL(redirectUri).host;
      if (!hostOk || url.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end();
        return;
      }
      const callback = readCallback(url.searchParams, pkce.state);
      const text = callback.ok ? "Signed in. You can close this tab and go back to Composition." : callback.error;
      response.writeHead(callback.ok ? 200 : 400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(`${PAGE_HEAD}<p>${text.replace(/[&<>]/g, "")}</p>`);
      if (!callback.ok && callback.stray) return;
      stopWaiting();
      if (!callback.ok) {
        lastError = callback.error;
        return;
      }
      void finishSignIn(callback.code, callback.clientId, pkce, redirectUri, hostId, known?.clientId).catch((error: unknown) => {
        lastError = error instanceof Error ? error.message : String(error);
      });
    });

    let port: number;
    try {
      port = await listenOnLoopback(server, ports);
    } catch {
      return { error: "Couldn't listen on this computer to finish the sign-in. Another program may be using the port." };
    }
    redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const timer = setTimeout(() => {
      stopWaiting();
      lastError = "The sign-in was not finished in time. Try again.";
    }, timeoutMs);
    timer.unref();
    waiting = {
      stop() {
        clearTimeout(timer);
        server.close();
        server.closeAllConnections();
      },
    };

    const url = buildAuthorizeUrl({ redirectUri, pkce, hostId, ...(known && { clientId: known.clientId }) });
    try {
      await openUrl(url);
    } catch {
      stopWaiting();
      return { error: `Couldn't open your browser. Open this address yourself to sign in: ${url}` };
    }
    return {};
  }

  function status(): ChatGptStatus {
    const credentials = readCredentials(options.credentialsFile());
    if (credentials) return { state: "signed-in", ...(credentials.email !== undefined && { email: credentials.email }) };
    if (waiting || finishing) return { state: "pending" };
    return { state: "signed-out", ...(lastError !== undefined && { error: lastError }) };
  }

  function signOut() {
    stopWaiting();
    lastError = undefined;
    deleteCredentials(options.credentialsFile());
  }

  async function renew(credentials: Credentials): Promise<AccessToken> {
    const result = await refreshTokens(credentials, now(), fetchImpl);
    if (result.ok) {
      // The old refresh token is dead from here on, so the new one must be on disk before anything else happens.
      writeCredentials(options.credentialsFile(), {
        ...credentials,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        expiresAt: result.tokens.expiresAt,
        ...(result.tokens.email !== undefined && { email: result.tokens.email }),
      });
      return { ok: true, accessToken: result.tokens.accessToken };
    }
    if (result.invalid) {
      deleteCredentials(options.credentialsFile());
      return { ok: false, failure: authFailure("Your ChatGPT sign-in has expired or was removed. Sign in again in Settings.") };
    }
    // A hiccup on the way: a token that has not run out yet still works.
    if (credentials.expiresAt > now()) return { ok: true, accessToken: credentials.accessToken };
    return { ok: false, failure: { kind: "unreachable", message: result.error } };
  }

  async function accessToken(): Promise<AccessToken> {
    const credentials = readCredentials(options.credentialsFile());
    if (!credentials) return { ok: false, failure: authFailure("You are not signed in to ChatGPT. Sign in in Settings.") };
    if (credentials.expiresAt - now() > RENEW_BEFORE_MS) return { ok: true, accessToken: credentials.accessToken };
    // Two turns at once share one renewal: a second would present a refresh token the first just retired.
    renewing ??= renew(credentials).finally(() => {
      renewing = undefined;
    });
    return renewing;
  }

  return { status, startSignIn, signOut, accessToken };
}
