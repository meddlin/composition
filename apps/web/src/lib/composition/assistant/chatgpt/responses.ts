import type { Failure } from "../errors";
import type { ModelSummary } from "../models";
import type { ChatEvent, ChatMessage, ChatRequest } from "../types";
import { CHATGPT_RESOURCE, type Fetch } from "./oauth";
import { readSse, SseError } from "./sse";

/**
 * One chat turn against ChatGPT through the user's plan: `POST /v1/responses`, streamed. The preview takes a
 * narrow set of fields: the system prompt goes in `instructions` (a system-role message is refused), the whole
 * conversation is sent every time (there is no `previous_response_id`), `store` is false and `stream` is true, and
 * `temperature`, `max_output_tokens` and the like are not accepted, so none is sent. Every failure comes back as an
 * `error` event, and nothing is thrown.
 * https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
 */

const QUOTED_LENGTH = 300;

const failed = (failure: Failure): ChatEvent => ({ type: "error", ...failure });

/** The request's messages as the Responses API wants them: system text pulled out, the rest in order. */
export function toResponsesInput(messages: ChatMessage[]): { instructions: string | undefined; input: { role: "user" | "assistant"; content: string }[] } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content);
  const input = messages.filter((m): m is ChatMessage & { role: "user" | "assistant" } => m.role !== "system").map(({ role, content }) => ({ role, content }));
  return { instructions: system.length > 0 ? system.join("\n\n") : undefined, input };
}

type Reply = { error?: { message?: unknown; code?: unknown } | null };

const USAGE_LIMIT_CODES = new Set(["subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable"]);

/** What an error code or message from the service means to a person. */
export function describeError(code: unknown, message: unknown): Failure {
  const said = typeof message === "string" && message !== "" ? message : undefined;
  if (typeof code === "string" && USAGE_LIMIT_CODES.has(code)) {
    return {
      kind: "server",
      message: "Your ChatGPT plan's usage limit for this app has been reached, so it can't answer right now. Raise the limit in ChatGPT (Settings > Security and login > Sign in with ChatGPT), wait for it to reset, or use an Ollama model.",
    };
  }
  return { kind: "server", message: `ChatGPT said: ${said ?? (typeof code === "string" ? code : "an error")}` };
}

async function failureFromResponse(response: Response, model: string): Promise<Failure> {
  const text = (await response.text().catch(() => "")).slice(0, QUOTED_LENGTH);
  let code: unknown;
  let message: unknown;
  try {
    const parsed = JSON.parse(text) as Reply;
    code = parsed.error?.code;
    message = parsed.error?.message;
  } catch {
    // Not JSON: a proxy's error page, say.
  }
  if (response.status === 401) {
    return { kind: "auth", message: "ChatGPT did not accept the saved sign-in. Sign in again in Settings." };
  }
  if (typeof code === "string" && USAGE_LIMIT_CODES.has(code)) return describeError(code, message);
  if (response.status === 403) {
    return { kind: "auth", message: "ChatGPT refused this request. Your plan may not include it; check Settings > Security and login > Sign in with ChatGPT in ChatGPT." };
  }
  if (response.status === 404 || response.status === 400) {
    return { kind: "model-missing", message: `ChatGPT would not use "${model}"${typeof message === "string" ? `: ${message}` : "."} Pick another model.` };
  }
  if (response.status === 429) return { kind: "server", message: "ChatGPT is limiting requests right now. Wait a moment and try again." };
  return typeof message === "string" || typeof code === "string"
    ? describeError(code, message)
    : { kind: "server", message: `ChatGPT answered with an error (${response.status}).` };
}

type StreamData = {
  type?: unknown;
  delta?: unknown;
  response?: { error?: { message?: unknown; code?: unknown } | null; usage?: { input_tokens?: unknown; output_tokens?: unknown }; incomplete_details?: { reason?: unknown } };
  code?: unknown;
  message?: unknown;
};

export async function* streamChat(
  accessToken: string,
  request: ChatRequest,
  signal?: AbortSignal,
  fetchImpl: Fetch = fetch,
): AsyncGenerator<ChatEvent> {
  if (request.messages.length === 0) {
    yield failed({ kind: "invalid-request", message: "There is nothing to send: the conversation is empty." });
    return;
  }
  const { instructions, input } = toResponsesInput(request.messages);

  let response: Response;
  try {
    response = await fetchImpl(`${CHATGPT_RESOURCE}/responses`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        ...(instructions !== undefined && { instructions }),
        input,
        store: false,
        stream: true,
      }),
      signal,
    });
  } catch (error) {
    yield (error as { name?: string } | null)?.name === "AbortError"
      ? failed({ kind: "aborted", message: "Stopped." })
      : failed({ kind: "unreachable", message: "Couldn't reach ChatGPT. Check the network connection." });
    return;
  }
  if (!response.ok) {
    yield failed(await failureFromResponse(response, request.model));
    return;
  }
  if (response.body === null) {
    yield failed({ kind: "bad-response", message: "ChatGPT answered with nothing to read." });
    return;
  }

  try {
    let thinking = false;
    let usage: ChatEvent | undefined;
    for await (const { data } of readSse(response.body)) {
      const event = data as StreamData;
      switch (event.type) {
        case "response.output_text.delta":
          if (typeof event.delta === "string" && event.delta !== "") {
            thinking = false;
            yield { type: "delta", text: event.delta };
          }
          break;
        case "response.reasoning_summary_text.delta":
        case "response.reasoning_text.delta":
          if (!thinking) {
            thinking = true;
            yield { type: "thinking" };
          }
          break;
        case "response.completed": {
          const counts = event.response?.usage;
          const promptTokens = typeof counts?.input_tokens === "number" ? counts.input_tokens : undefined;
          const outputTokens = typeof counts?.output_tokens === "number" ? counts.output_tokens : undefined;
          if (promptTokens !== undefined || outputTokens !== undefined) {
            usage = { type: "usage", ...(promptTokens !== undefined && { promptTokens }), ...(outputTokens !== undefined && { outputTokens }) };
          }
          if (usage) yield usage;
          yield { type: "done" };
          return;
        }
        case "response.incomplete":
          yield failed({ kind: "server", message: `ChatGPT stopped before finishing the answer${typeof event.response?.incomplete_details?.reason === "string" ? ` (${event.response.incomplete_details.reason})` : ""}.` });
          return;
        case "response.failed":
          yield failed(describeError(event.response?.error?.code, event.response?.error?.message));
          return;
        case "error":
          yield failed(describeError(event.code, event.message));
          return;
        default:
          break;
      }
    }
    // Only `response.completed` means the answer is whole.
    yield failed({ kind: "unreachable", message: "The connection to ChatGPT closed before the answer was finished." });
  } catch (error) {
    if ((error as { name?: string } | null)?.name === "AbortError") yield failed({ kind: "aborted", message: "Stopped." });
    else if (error instanceof SseError) yield failed({ kind: "bad-response", message: "ChatGPT sent something the helper does not understand." });
    else yield failed({ kind: "unreachable", message: "The connection to ChatGPT was lost." });
  }
}

type CatalogEntry = { slug?: unknown; id?: unknown; display_name?: unknown; visibility?: unknown; context_window?: unknown; max_context_window?: unknown; context_length?: unknown };

export type ChatGptModelList = { ok: true; models: ModelSummary[] } | ({ ok: false } & Failure);

/** The models this account may call: the catalog's own `list` entries, shown by display name. */
export async function listChatGptModels(accessToken: string, signal?: AbortSignal, fetchImpl: Fetch = fetch): Promise<ChatGptModelList> {
  let response: Response;
  try {
    response = await fetchImpl(`${CHATGPT_RESOURCE}/models`, { headers: { authorization: `Bearer ${accessToken}` }, signal });
  } catch {
    return { ok: false, kind: "unreachable", message: "Couldn't reach ChatGPT. Check the network connection." };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, kind: "auth", message: "ChatGPT did not accept the saved sign-in. Sign in again in Settings." };
  }
  if (!response.ok) return { ok: false, kind: "server", message: `ChatGPT answered with an error (${response.status}).` };

  let body: { models?: unknown; data?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, kind: "bad-response", message: "ChatGPT's list of models was not what was expected." };
  }
  const entries = Array.isArray(body.models) ? body.models : Array.isArray(body.data) ? body.data : undefined;
  if (!entries) return { ok: false, kind: "bad-response", message: "ChatGPT's list of models was not what was expected." };

  const models: ModelSummary[] = [];
  for (const entry of entries as CatalogEntry[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const slug = typeof entry.slug === "string" ? entry.slug : typeof entry.id === "string" ? entry.id : undefined;
    if (slug === undefined || (entry.visibility !== undefined && entry.visibility !== "list")) continue;
    const windowSize = [entry.context_window, entry.max_context_window, entry.context_length].find((v): v is number => typeof v === "number" && v > 0);
    models.push({
      name: slug,
      label: typeof entry.display_name === "string" && entry.display_name !== "" ? entry.display_name : slug,
      parameterSize: "",
      contextLength: windowSize,
      capabilities: ["completion"],
    });
  }
  return { ok: true, models };
}
