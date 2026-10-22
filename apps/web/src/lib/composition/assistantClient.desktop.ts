import { endsTurn } from "./assistant/events";
import { createEventQueue } from "./assistant/eventQueue";
import type { ChatErrorKind, ChatEvent, ChatRequest } from "./assistant/types";
import type {} from "./desktopBridge";

/**
 * Desktop build's replacement for `assistantClient.ts` (see next.config.ts): the same `streamChat`, carried over
 * Electron IPC by the preload script's `window.composition`. The main process makes the request to Ollama (the
 * page's CSP allows no network access) and pushes each event back, tagged with this call's request id.
 */
const error = (kind: ChatErrorKind, message: string): ChatEvent => ({ type: "error", kind, message });

/** How long to wait, after the call returns, for an event that ends the turn before giving up on one. */
const END_GRACE_MS = 1000;

/** `endpoint` exists only to match the web client's signature. */
export async function* streamChat(request: ChatRequest, signal?: AbortSignal, endpoint?: string): AsyncGenerator<ChatEvent> {
  void endpoint;
  const api = typeof window === "undefined" ? undefined : window.composition;
  if (!api) {
    yield error("unreachable", "The AI helper's connection is unavailable. This build only runs inside the desktop app.");
    return;
  }
  if (signal?.aborted) {
    yield error("aborted", "Stopped.");
    return;
  }

  const requestId = crypto.randomUUID();
  const queue = createEventQueue<ChatEvent>();
  // Listen before asking: the main process can push events before the call's own answer gets back.
  const stopListening = api.onAssistantEvent((message) => {
    if (message.requestId !== requestId) return;
    queue.push(message.event);
    if (endsTurn(message.event)) queue.close();
  });
  const onAbort = () => void api.assistantAbort(requestId).catch(() => {});
  signal?.addEventListener("abort", onAbort);

  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  api.assistantChat(requestId, request).then(
    () => {
      // Every turn ends with an event; if none came, say so rather than waiting for ever.
      graceTimer = setTimeout(() => {
        queue.push(error("unreachable", "The turn ended without an answer."));
        queue.close();
      }, END_GRACE_MS);
    },
    (thrown: unknown) => {
      queue.push(error("refused", thrown instanceof Error ? thrown.message : String(thrown)));
      queue.close();
    },
  );

  try {
    yield* queue;
  } finally {
    clearTimeout(graceTimer);
    signal?.removeEventListener("abort", onAbort);
    stopListening();
  }
}
