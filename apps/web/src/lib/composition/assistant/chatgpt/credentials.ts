import fs from "node:fs";
import path from "node:path";
import type { Credentials } from "./oauth";

/**
 * The signed-in ChatGPT account's tokens, in a file of their own beside the settings file and readable only by
 * the user (OpenAI's guidance for this flow). Never in the settings file itself, which the Settings page reads
 * and which the renderer is sent: a token must not reach a page.
 */
export const CREDENTIALS_FILE = "chatgpt-auth.json";

export const credentialsPathFor = (settingsFile: string): string => path.join(path.dirname(settingsFile), CREDENTIALS_FILE);

const text = (value: unknown): value is string => typeof value === "string" && value !== "";

/** What was saved, or undefined when there is nothing usable (no file, or one that was edited or damaged). */
export function readCredentials(file: string): Credentials | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const saved = parsed as Record<string, unknown>;
  if (!text(saved.clientId) || !text(saved.hostId) || !text(saved.accessToken) || !text(saved.refreshToken) || typeof saved.expiresAt !== "number") {
    return undefined;
  }
  return {
    clientId: saved.clientId,
    hostId: saved.hostId,
    accessToken: saved.accessToken,
    refreshToken: saved.refreshToken,
    expiresAt: saved.expiresAt,
    ...(text(saved.email) && { email: saved.email }),
  };
}

/** Written to a temporary file first and renamed over the old one, so a crash cannot leave half a token. */
export function writeCredentials(file: string, credentials: Credentials): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(credentials), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/**
 * Forgets the account on this computer. The app also stays listed in ChatGPT under Settings > Security and login >
 * Sign in with ChatGPT until the user removes it there.
 */
export function deleteCredentials(file: string): void {
  fs.rmSync(file, { force: true });
}
