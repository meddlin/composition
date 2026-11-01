import type { AssistantModels, SaveAssistantSettingsInput, SaveAssistantSettingsResult } from "./api";
import { forgetEndpoint, resolveEndpoint, type Endpoint } from "./assistant/endpoint";
import type { Failure } from "./assistant/errors";
import { isCloudModelName, listModels, modelInfo } from "./assistant/models";
import { streamChat } from "./assistant/ollama";
import { isLoopback } from "./assistant/serverUrl";
import { checkAssistantSettings, DEFAULT_ASSISTANT_SETTINGS, type AssistantSettings } from "./assistant/settings";
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

/**
 * Runs `run` against the address to use now: the saved server, or the alternate when the server doesn't answer.
 * If the chosen address turns out to have nothing there (the network changed since it was chosen), the choice
 * is dropped and made again once, so a switch between networks needs no second attempt from the user.
 */
async function viaEndpoint<T extends { ok: boolean; kind?: string }>(
  settings: AssistantSettings,
  signal: AbortSignal | undefined,
  run: (url: string) => Promise<T>,
): Promise<{ endpoint: Endpoint; result: T } | { failure: Failure }> {
  let endpoint = await resolveEndpoint(settings, signal);
  if (!endpoint.ok) return { failure: endpoint.failure };
  let result = await run(endpoint.url);
  if (!result.ok && result.kind === "unreachable" && settings.alternateUrl !== undefined) {
    forgetEndpoint();
    endpoint = await resolveEndpoint(settings, signal);
    if (!endpoint.ok) return { failure: endpoint.failure };
    result = await run(endpoint.url);
  }
  return { endpoint, result };
}

/** `timeoutMs` is for tests; the contract takes no arguments. */
export async function listAssistantModels(timeoutMs = LIST_TIMEOUT_MS): Promise<AssistantModels> {
  const settings = loadWebSettings().assistant ?? DEFAULT_ASSISTANT_SETTINGS;
  const { contextTokens } = settings;
  const signal = AbortSignal.timeout(timeoutMs);
  const reached = await viaEndpoint(settings, signal, (url) => listModels(url, signal));

  if ("failure" in reached) {
    const { serverUrl } = settings;
    return { serverUrl, local: isLoopback(serverUrl), viaAlternate: false, contextTokens, models: [], hiddenCloud: 0, error: reached.failure };
  }
  const { endpoint, result } = reached;
  const where = { serverUrl: endpoint.url, local: isLoopback(endpoint.url), viaAlternate: endpoint.alternate, contextTokens };
  if (!result.ok) return { ...where, models: [], hiddenCloud: 0, error: { kind: result.kind, message: result.message } };
  return { ...where, models: result.models, hiddenCloud: result.hiddenCloud };
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
  const settings = loadWebSettings().assistant ?? DEFAULT_ASSISTANT_SETTINGS;
  if (isCloudModelName(request.model)) {
    yield { type: "error", kind: "refused", message: OTHER_HOST(request.model) };
    return;
  }
  const reached = await viaEndpoint(settings, signal, (url) => modelInfo(url, request.model, signal));
  if ("failure" in reached) {
    yield { type: "error", ...reached.failure };
    return;
  }
  const { endpoint, result: info } = reached;
  if (!info.ok) {
    yield { type: "error", kind: info.kind, message: info.message };
    return;
  }
  if (info.remote) {
    yield { type: "error", kind: "refused", message: OTHER_HOST(request.model) };
    return;
  }
  yield* streamChat(endpoint.url, request, signal);
}
