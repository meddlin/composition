import fs from "node:fs";
import { protocol } from "electron";
import { mimeTypeFor, resolveRendererFile } from "./rendererFiles";

export const APP_SCHEME = "app";
export const APP_HOST = "composition";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/**
 * Content Security Policy for the UI. Next's static export inlines small
 * scripts and styles, so those need 'unsafe-inline'; everything else is
 * locked to our own origin. `https:` images stay allowed so Markdown images
 * behave as they do in the web app. There is no network access for scripts
 * (`connect-src 'self'`): all data goes over IPC.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Must run before the app is ready (Electron requirement). */
export function registerSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      // `standard` makes relative URLs resolve; `secure` and `supportFetchAPI`
      // let Next's client router fetch its route payloads.
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

/** Serves the exported renderer from `rendererRoot` at app://composition/. */
export function registerAppProtocol(rendererRoot: string): void {
  const isFile = (file: string) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  };
  const headers = (file: string) => ({
    "content-type": mimeTypeFor(file),
    "content-security-policy": CONTENT_SECURITY_POLICY,
    "x-content-type-options": "nosniff",
  });

  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    const url = new URL(request.url);
    const file = url.host === APP_HOST ? resolveRendererFile(rendererRoot, url.pathname, isFile) : null;

    if (!file) {
      const notFound = resolveRendererFile(rendererRoot, "/404.html", isFile);
      const body = notFound ? await fs.promises.readFile(notFound) : "Not found";
      return new Response(body, {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": CONTENT_SECURITY_POLICY },
      });
    }
    return new Response(await fs.promises.readFile(file), { headers: headers(file) });
  });
}
