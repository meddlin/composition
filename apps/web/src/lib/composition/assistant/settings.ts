import { DEFAULT_SERVER_URL, parseServerUrl } from "./serverUrl";

export type AssistantSettings = {
  /** The Ollama server's address, normalized (see `parseServerUrl`). */
  serverUrl: string;
  /** The context window asked of the server on every request, in tokens. */
  contextTokens: number;
};

export const DEFAULT_CONTEXT_TOKENS = 8192;
export const MIN_CONTEXT_TOKENS = 1024;
export const MAX_CONTEXT_TOKENS = 1_048_576;

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  serverUrl: DEFAULT_SERVER_URL,
  contextTokens: DEFAULT_CONTEXT_TOKENS,
};

const isContextTokens = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= MIN_CONTEXT_TOKENS && value <= MAX_CONTEXT_TOKENS;

/**
 * Settings as read back from the settings file, which anyone may have edited. Each setting that is missing or
 * unusable falls back to its default and leaves the other alone.
 */
export function parseAssistantSettings(value: unknown): AssistantSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_ASSISTANT_SETTINGS;
  const saved = value as Record<string, unknown>;
  const address = typeof saved.serverUrl === "string" ? parseServerUrl(saved.serverUrl) : undefined;
  return {
    serverUrl: address?.ok ? address.url : DEFAULT_ASSISTANT_SETTINGS.serverUrl,
    contextTokens: isContextTokens(saved.contextTokens) ? saved.contextTokens : DEFAULT_CONTEXT_TOKENS,
  };
}

export type CheckedSettings = { ok: true; settings: AssistantSettings } | { ok: false; error: string };

/** Checks what the user entered before it is saved, and says what is wrong when it cannot be. */
export function checkAssistantSettings(input: unknown): CheckedSettings {
  if (typeof input !== "object" || input === null) return { ok: false, error: "Those settings aren't in a form that can be saved." };
  const { serverUrl, contextTokens } = input as Record<string, unknown>;
  if (typeof serverUrl !== "string" || typeof contextTokens !== "number") {
    return { ok: false, error: "Those settings aren't in a form that can be saved." };
  }

  const address = parseServerUrl(serverUrl);
  if (!address.ok) return { ok: false, error: address.error };

  if (!isContextTokens(contextTokens)) {
    return {
      ok: false,
      error: `The context size must be a whole number of tokens from ${MIN_CONTEXT_TOKENS.toLocaleString("en-US")} to ${MAX_CONTEXT_TOKENS.toLocaleString("en-US")}.`,
    };
  }
  return { ok: true, settings: { serverUrl: address.url, contextTokens } };
}
