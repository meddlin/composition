import { describe, expect, it, vi } from "vitest";
import type { ChatEvent, ChatRequest } from "../../../web/src/lib/composition/assistant/types";
import { ASSISTANT_EVENT_CHANNEL } from "../shared/channels";
import { createAssistantHost, type AssistantSender } from "./assistant";

const request: ChatRequest = { model: "qwen3:0.6b", messages: [{ role: "user", content: "hi" }], numCtx: 8192 };

function fakeSender() {
  const sent: { channel: string; payload: unknown }[] = [];
  const onDestroyed: (() => void)[] = [];
  let destroyed = false;
  const sender: AssistantSender = {
    send: (channel, payload) => void sent.push({ channel, payload }),
    isDestroyed: () => destroyed,
    once: (_event, listener) => void onDestroyed.push(listener),
  };
  return { sender, sent, destroy: () => ((destroyed = true), onDestroyed.forEach((l) => l())) };
}

async function* events(...list: ChatEvent[]): AsyncGenerator<ChatEvent> {
  yield* list;
}

/** A stream that yields `first`, then waits for its signal to abort and ends with an aborted event. */
function stoppable(first: ChatEvent) {
  const seen: AbortSignal[] = [];
  const stream = async function* (_request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
    seen.push(signal!);
    yield first;
    await new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve()));
    yield { type: "error", kind: "aborted", message: "Stopped." };
  };
  return { stream, seen };
}

describe("createAssistantHost", () => {
  it("sends each event to the window that asked, tagged with its request id", async () => {
    const asker = fakeSender();
    const other = fakeSender();
    const host = createAssistantHost({ stream: () => events({ type: "delta", text: "Hi" }, { type: "done" }) });

    await host.chat(asker.sender, "r1", request);

    expect(asker.sent).toEqual([
      { channel: ASSISTANT_EVENT_CHANNEL, payload: { requestId: "r1", event: { type: "delta", text: "Hi" } } },
      { channel: ASSISTANT_EVENT_CHANNEL, payload: { requestId: "r1", event: { type: "done" } } },
    ]);
    expect(other.sent).toEqual([]);
  });

  it("passes the request on to the stream", async () => {
    const stream = vi.fn(() => events({ type: "done" }));
    await createAssistantHost({ stream }).chat(fakeSender().sender, "r1", request);
    expect(stream).toHaveBeenCalledWith(request, expect.any(AbortSignal));
  });

  it("stops a running turn when the window that asked aborts it", async () => {
    const asker = fakeSender();
    const { stream, seen } = stoppable({ type: "delta", text: "a" });
    const host = createAssistantHost({ stream });

    const running = host.chat(asker.sender, "r1", request);
    await vi.waitFor(() => expect(asker.sent).toHaveLength(1));
    await host.abort(asker.sender, "r1");
    await running;

    expect(seen[0].aborted).toBe(true);
    expect(asker.sent[1].payload).toMatchObject({ event: { type: "error", kind: "aborted" } });
  });

  it("will not let one window stop another window's turn", async () => {
    const asker = fakeSender();
    const stranger = fakeSender();
    const { stream, seen } = stoppable({ type: "delta", text: "a" });
    const host = createAssistantHost({ stream });

    const running = host.chat(asker.sender, "r1", request);
    await vi.waitFor(() => expect(asker.sent).toHaveLength(1));
    await host.abort(stranger.sender, "r1");
    expect(seen[0].aborted).toBe(false);

    await host.abort(asker.sender, "r1");
    await running;
  });

  it("stops, and sends nothing more, once the window has gone", async () => {
    const asker = fakeSender();
    const { stream, seen } = stoppable({ type: "delta", text: "a" });
    const host = createAssistantHost({ stream });

    const running = host.chat(asker.sender, "r1", request);
    await vi.waitFor(() => expect(asker.sent).toHaveLength(1));
    asker.destroy();
    await running;

    expect(seen[0].aborted).toBe(true);
    expect(asker.sent).toHaveLength(1);
  });

  it("ends a turn whose stream threw with an error event", async () => {
    const asker = fakeSender();
    const host = createAssistantHost({
      stream: async function* () {
        yield { type: "delta", text: "a" } as const;
        throw new Error("disk on fire");
      },
    });

    await host.chat(asker.sender, "r1", request);

    expect(asker.sent[1].payload).toMatchObject({ requestId: "r1", event: { type: "error", kind: "server" } });
  });

  it("refuses a second turn under a request id that is still running, and forgets ids that have ended", async () => {
    const asker = fakeSender();
    const { stream } = stoppable({ type: "delta", text: "a" });
    const host = createAssistantHost({ stream });

    const running = host.chat(asker.sender, "r1", request);
    await vi.waitFor(() => expect(asker.sent).toHaveLength(1));
    await expect(host.chat(asker.sender, "r1", request)).rejects.toThrow(/already/i);
    await host.abort(asker.sender, "r1");
    await running;

    await expect(host.abort(asker.sender, "r1")).resolves.toBeUndefined(); // nothing running: harmless
    const again = createAssistantHost({ stream: () => events({ type: "done" }) });
    await again.chat(asker.sender, "r1", request);
    await again.chat(asker.sender, "r1", request); // the id is free again once the turn has ended
  });
});
