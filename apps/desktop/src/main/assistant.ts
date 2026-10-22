import type { ChatEvent, ChatRequest } from "../../../web/src/lib/composition/assistant/types";
import { ASSISTANT_EVENT_CHANNEL } from "../shared/channels";

/** The slice of Electron's `WebContents` this module uses, so tests don't need Electron. */
export type AssistantSender = {
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  once(event: "destroyed", listener: () => void): void;
};

export type AssistantHost = {
  /** Runs one turn for `sender` and resolves when it has ended; its events are pushed to `sender` only. */
  chat(sender: AssistantSender, requestId: string, request: ChatRequest): Promise<void>;
  /** Stops the turn `sender` started under that id. Harmless if there is none. */
  abort(sender: AssistantSender, requestId: string): Promise<void>;
};

/**
 * Runs the AI helper's chat turns for the windows that ask. Each turn is tracked under the window that started it
 * and the id that window chose, so one window can neither stop nor see another's. A turn stops when its window
 * asks, or when the window goes away. `stream` is the service's `streamAssistantChat`, which reads the saved
 * server address itself: no address ever comes from a page.
 */
export function createAssistantHost(options: {
  stream: (request: ChatRequest, signal: AbortSignal) => AsyncIterable<ChatEvent>;
}): AssistantHost {
  const running = new WeakMap<AssistantSender, Map<string, AbortController>>();

  return {
    async chat(sender, requestId, request) {
      let mine = running.get(sender);
      if (!mine) running.set(sender, (mine = new Map()));
      if (mine.has(requestId)) throw new Error(`A turn with the id "${requestId}" is already running.`);

      const controller = new AbortController();
      mine.set(requestId, controller);
      sender.once("destroyed", () => controller.abort());

      const push = (event: ChatEvent) => {
        if (!sender.isDestroyed()) sender.send(ASSISTANT_EVENT_CHANNEL, { requestId, event });
      };
      try {
        for await (const event of options.stream(request, controller.signal)) {
          if (sender.isDestroyed()) {
            controller.abort();
            break;
          }
          push(event);
        }
      } catch (error) {
        push({ type: "error", kind: "server", message: error instanceof Error ? error.message : String(error) });
      } finally {
        mine.delete(requestId);
      }
    },

    async abort(sender, requestId) {
      running.get(sender)?.get(requestId)?.abort();
    },
  };
}
