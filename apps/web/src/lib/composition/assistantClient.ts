import { endsTurn, parseChatEvent } from "./assistant/events";
import { NdjsonError, readNdjson } from "./assistant/ndjson";
import type { ChatErrorKind, ChatEvent, ChatRequest } from "./assistant/types";
import { ASSISTANT_HEADER } from "./uploadGuard";

/**
 * What the AI helper's panel imports to chat. In the web build this is a `fetch` to the app's own streaming route;
 * the desktop build resolves `assistantClient.desktop.ts` instead (next.config.ts), which goes through the main
 * process. Failures arrive as an `error` event, never as a throw, so the panel has one path to handle.
 */
export const ASSISTANT_ROUTE = "/api/assistant/chat";

const error = (kind: ChatErrorKind, message: string): ChatEvent => ({ type: "error", kind, message });

const KIND_FOR_STATUS: Record<number, ChatErrorKind> = { 400: "invalid-request", 403: "refused", 413: "invalid-request" };

/** `endpoint` is for tests. */
export async function* streamChat(
  request: ChatRequest,
  signal?: AbortSignal,
  endpoint: string = ASSISTANT_ROUTE,
): AsyncGenerator<ChatEvent> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", [ASSISTANT_HEADER]: "1" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (thrown) {
    yield (thrown as { name?: string } | null)?.name === "AbortError"
      ? error("aborted", "Stopped.")
      : error("unreachable", "Can't reach the Composition server. Is the app still running?");
    return;
  }

  if (!response.ok || response.body === null) {
    let reason = `The Composition server answered with an error (${response.status}).`;
    try {
      const said = ((await response.json()) as { error?: unknown }).error;
      if (typeof said === "string") reason = said;
    } catch {
      // Not JSON: a proxy's error page, say.
    }
    yield error(KIND_FOR_STATUS[response.status] ?? "server", reason);
    return;
  }

  try {
    for await (const value of readNdjson(response.body)) {
      const event = parseChatEvent(value);
      if (event === undefined) {
        yield error("bad-response", "The Composition server sent something the panel does not understand.");
        return;
      }
      yield event;
      if (endsTurn(event)) return;
    }
    yield error("unreachable", "The connection to the Composition server closed before the answer was finished.");
  } catch (thrown) {
    if ((thrown as { name?: string } | null)?.name === "AbortError") yield error("aborted", "Stopped.");
    else if (thrown instanceof NdjsonError) yield error("bad-response", "The Composition server sent something the panel does not understand.");
    else yield error("unreachable", "The connection to the Composition server was lost.");
  }
}
