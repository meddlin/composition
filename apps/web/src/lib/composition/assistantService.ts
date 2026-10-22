import type { AssistantModels, SaveAssistantSettingsInput, SaveAssistantSettingsResult } from "./api";
import { isCloudModelName, listModels, modelInfo } from "./assistant/models";
import { streamChat } from "./assistant/ollama";
import { isLoopback } from "./assistant/serverUrl";
import { checkAssistantSettings, DEFAULT_ASSISTANT_SETTINGS } from "./assistant/settings";
import type { ChatEvent, ChatRequest } from "./assistant/types";
import { loadWebSettings, saveWebSettings } from "./webSettings";

/** How long to wait for a server to list its models before giving up. */
const LIST_TIMEOUT_MS = 10_000;

export async function saveAssistantSettings(input: SaveAssistantSettingsInput): Promise<SaveAssistantSettingsResult> {
  const checked = checkAssistantSettings(input);
  if (!checked.ok) return { error: checked.error };
  // Replace only this setting, so an unsaved edit elsewhere on the Settings page isn't persisted with it.
  saveWebSettings({ ...loadWebSettings(), assistant: checked.settings });
  return { settings: checked.settings };
}

/** `timeoutMs` is for tests; the contract takes no arguments. */
export async function listAssistantModels(timeoutMs = LIST_TIMEOUT_MS): Promise<AssistantModels> {
  const { serverUrl, contextTokens } = loadWebSettings().assistant ?? DEFAULT_ASSISTANT_SETTINGS;
  const local = isLoopback(serverUrl);
  const result = await listModels(serverUrl, AbortSignal.timeout(timeoutMs));
  if (!result.ok) {
    return { serverUrl, local, contextTokens, models: [], hiddenCloud: 0, error: { kind: result.kind, message: result.message } };
  }
  return { serverUrl, local, contextTokens, models: result.models, hiddenCloud: result.hiddenCloud };
}

const OTHER_HOST = (model: string) =>
  `"${model}" would run on another host (ollama.com, for example), not on the server you chose, so the AI helper does not use it.`;

/**
 * One chat turn against the saved server, for the web route and the desktop main process alike. The address comes
 * from the settings, never from the caller. A model that would run elsewhere (a cloud name, or a stub the server
 * lists locally but forwards) is refused before any of the conversation is sent. `request` must already have
 * passed `checkChatRequest`.
 */
export async function* streamAssistantChat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
  const { serverUrl } = loadWebSettings().assistant ?? DEFAULT_ASSISTANT_SETTINGS;
  if (isCloudModelName(request.model)) {
    yield { type: "error", kind: "refused", message: OTHER_HOST(request.model) };
    return;
  }
  const info = await modelInfo(serverUrl, request.model, signal);
  if (!info.ok) {
    yield { type: "error", kind: info.kind, message: info.message };
    return;
  }
  if (info.remote) {
    yield { type: "error", kind: "refused", message: OTHER_HOST(request.model) };
    return;
  }
  yield* streamChat(serverUrl, request, signal);
}
