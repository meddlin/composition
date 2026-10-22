import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantEventListener, AssistantEventMessage } from "./assistantApi";
import type { ChatEvent, ChatRequest } from "./assistant/types";
import { streamChat } from "./assistantClient.desktop";

afterEach(() => vi.unstubAllGlobals());

const request: ChatRequest = { model: "qwen3:0.6b", messages: [{ role: "user", content: "hi" }], numCtx: 8192 };

/** A stand-in for the preload bridge. `script` decides what the "main process" pushes for a turn. */
function fakeBridge(script: (id: string, push: (event: ChatEvent, as?: string) => void) => void | Promise<void>) {
  const listeners = new Set<AssistantEventListener>();
  const aborted: string[] = [];
  const bridge = {
    onAssistantEvent: (listener: AssistantEventListener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    assistantChat: vi.fn(async (id: string) => {
      const push = (event: ChatEvent, as = id) => listeners.forEach((l) => l({ requestId: as, event } satisfies AssistantEventMessage));
      await script(id, push);
    }),
    assistantAbort: vi.fn(async (id: string) => void aborted.push(id)),
  };
  vi.stubGlobal("window", { composition: bridge });
  return { bridge, listeners, aborted };
}

async function collect(signal?: AbortSignal): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of streamChat(request, signal)) events.push(event);
  return events;
}

describe("streamChat (desktop)", () => {
  it("yields the events pushed for its own request, even ones pushed before the call returns", async () => {
    const { bridge } = fakeBridge((_id, push) => {
      push({ type: "delta", text: "Hi" }); // pushed synchronously: lost if the listener were added after the call
      push({ type: "done" });
    });

    expect(await collect()).toEqual([{ type: "delta", text: "Hi" }, { type: "done" }]);
    expect(bridge.assistantChat).toHaveBeenCalledWith(expect.stringMatching(/^[A-Za-z0-9_-]{1,64}$/), request);
  });

  it("ignores events for other requests", async () => {
    fakeBridge((_id, push) => {
      push({ type: "delta", text: "not mine" }, "someone-else");
      push({ type: "delta", text: "mine" });
      push({ type: "done" });
    });
    expect(await collect()).toEqual([{ type: "delta", text: "mine" }, { type: "done" }]);
  });

  it("stops listening when the turn ends", async () => {
    const { listeners } = fakeBridge((_id, push) => void push({ type: "done" }));
    await collect();
    expect(listeners.size).toBe(0);
  });

  it("stops listening when the reader gives up early", async () => {
    const { listeners } = fakeBridge((_id, push) => {
      push({ type: "delta", text: "a" });
      push({ type: "delta", text: "b" });
    });
    const reader = streamChat(request);
    await reader.next();
    await reader.return(undefined);
    expect(listeners.size).toBe(0);
  });

  it("tells the main process to stop when aborted, and ends with what it reports", async () => {
    const controller = new AbortController();
    const { aborted } = fakeBridge(async (id, push) => {
      push({ type: "delta", text: "a" });
      await new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve()));
      push({ type: "error", kind: "aborted", message: "Stopped." });
    });

    const events: ChatEvent[] = [];
    for await (const event of streamChat(request, controller.signal)) {
      events.push(event);
      if (events.length === 1) controller.abort();
    }

    expect(events[1]).toMatchObject({ type: "error", kind: "aborted" });
    expect(aborted).toHaveLength(1);
  });

  it("does not start a turn for a signal that is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { bridge } = fakeBridge(() => {});
    expect(await collect(controller.signal)).toEqual([{ type: "error", kind: "aborted", message: "Stopped." }]);
    expect(bridge.assistantChat).not.toHaveBeenCalled();
  });

  it("turns a refused or failed call into an error event, not a throw", async () => {
    fakeBridge(() => Promise.reject(new Error("Error invoking remote method: untrusted sender")));
    const events = await collect();
    expect(events).toEqual([{ type: "error", kind: "refused", message: expect.stringContaining("untrusted sender") }]);
  });

  it("says so when the turn returned without ever ending", async () => {
    vi.useFakeTimers();
    try {
      fakeBridge(() => {});
      const pending = collect();
      await vi.advanceTimersByTimeAsync(2000);
      expect(await pending).toEqual([{ type: "error", kind: "unreachable", message: expect.stringMatching(/ended without|closed before/i) }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("explains itself outside the desktop app", async () => {
    vi.stubGlobal("window", undefined);
    const events = await collect();
    expect(events).toEqual([{ type: "error", kind: "unreachable", message: expect.stringMatching(/desktop/i) }]);
  });
});
