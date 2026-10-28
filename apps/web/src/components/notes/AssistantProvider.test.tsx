// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatsStore } from "@/lib/composition/assistant/chatsStore";
import { activeConversation } from "@/lib/composition/assistant/conversations";
import type { ChatEvent, ChatRequest } from "@/lib/composition/assistant/types";
import { streamChat } from "@/lib/composition/assistantClient";
import { AssistantProvider, useAssistant } from "./AssistantProvider";

vi.mock("@/lib/composition/assistantClient", () => ({ streamChat: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const wrapper = ({ children }: { children: ReactNode }) => <AssistantProvider>{children}</AssistantProvider>;

/** A stream the test drives by hand: `emit` an event, or `end`. It ends with an aborted event when its signal aborts. */
function controlledStream() {
  const requests: ChatRequest[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const queue: ChatEvent[] = [];
  let wake: (() => void) | undefined;
  let finished = false;
  const emit = (event: ChatEvent) => { queue.push(event); wake?.(); };
  const end = () => { finished = true; wake?.(); };
  vi.mocked(streamChat).mockImplementation(async function* (request, signal) {
    requests.push(request);
    signals.push(signal);
    signal?.addEventListener("abort", () => emit({ type: "error", kind: "aborted", message: "Stopped." }));
    while (true) {
      if (queue.length) { const e = queue.shift()!; yield e; if (e.type === "done" || e.type === "error") return; }
      else if (finished) return;
      else await new Promise<void>((r) => (wake = r));
    }
  });
  return { requests, signals, emit, end };
}

const input = { noteId: 1, noteContent: "---\ntitle: Trip\n---\nDay one.\n", userText: "What next?", model: "qwen3:0.6b", numCtx: 8192 };
const turnsOf = (result: { current: ReturnType<typeof useAssistant> }, noteId = 1) => activeConversation(result.current.chats, noteId)?.turns ?? [];

describe("AssistantProvider", () => {
  it("sends the note and the question, and shows the answer as it streams in", async () => {
    const stream = controlledStream();
    const { result } = renderHook(() => useAssistant(), { wrapper });

    await act(async () => result.current.send(input));
    expect(stream.requests[0]).toMatchObject({ model: "qwen3:0.6b", numCtx: 8192 });
    expect(stream.requests[0].messages[0].role).toBe("system");
    expect(stream.requests[0].messages[0].content).toContain("Day one.");
    expect(stream.requests[0].messages.at(-1)).toEqual({ role: "user", content: "What next?" });
    expect(turnsOf(result)[0]).toMatchObject({ userText: "What next?", status: "streaming", answer: "" });

    await act(async () => stream.emit({ type: "delta", text: "Try " }));
    await act(async () => stream.emit({ type: "delta", text: "Sintra." }));
    expect(turnsOf(result)[0].answer).toBe("Try Sintra.");
    await act(async () => stream.emit({ type: "done" }));
    expect(turnsOf(result)[0].status).toBe("done");
  });

  it("sends the earlier questions and answers with the next question", async () => {
    const stream = controlledStream();
    const { result } = renderHook(() => useAssistant(), { wrapper });
    await act(async () => result.current.send(input));
    await act(async () => { stream.emit({ type: "delta", text: "Sintra." }); stream.emit({ type: "done" }); });

    await act(async () => result.current.send({ ...input, userText: "And after?" }));

    const sent = stream.requests[1].messages;
    expect(sent.slice(1).map((m) => [m.role, m.content])).toEqual([
      ["user", "What next?"], ["assistant", "Sintra."], ["user", "And after?"],
    ]);
  });

  it("puts the selection in the question and remembers how much was selected", async () => {
    const stream = controlledStream();
    const { result } = renderHook(() => useAssistant(), { wrapper });

    await act(async () => result.current.send({ ...input, selection: "Day one." }));

    expect(stream.requests[0].messages.at(-1)?.content).toContain("Day one.");
    expect(turnsOf(result)[0]).toMatchObject({ selectionChars: 8, userText: "What next?" });
  });

  it("does not start a second turn on a note while one is streaming", async () => {
    controlledStream();
    const { result } = renderHook(() => useAssistant(), { wrapper });
    await act(async () => result.current.send(input));
    await act(async () => result.current.send({ ...input, userText: "again" }));
    expect(vi.mocked(streamChat)).toHaveBeenCalledTimes(1);
    expect(result.current.isStreaming(1)).toBe(true);
  });

  it("stops the streaming turn when asked, keeping what had arrived", async () => {
    const stream = controlledStream();
    const { result } = renderHook(() => useAssistant(), { wrapper });
    await act(async () => result.current.send(input));
    await act(async () => stream.emit({ type: "delta", text: "Half" }));

    await act(async () => result.current.stop(1));

    expect(stream.signals[0]?.aborted).toBe(true);
    expect(turnsOf(result)[0]).toMatchObject({ status: "stopped", answer: "Half" });
    expect(result.current.isStreaming(1)).toBe(false);
  });

  it("keeps a chat when a new one is started, and switches back to it", async () => {
    const stream = controlledStream();
    const { result } = renderHook(() => useAssistant(), { wrapper });
    await act(async () => result.current.send(input));
    await act(async () => { stream.emit({ type: "delta", text: "a" }); stream.emit({ type: "done" }); });
    const first = result.current.chats[1].activeId;

    act(() => result.current.newChat(1));
    expect(turnsOf(result)).toHaveLength(0);
    expect(result.current.chats[1].conversations).toHaveLength(2);

    act(() => result.current.select(1, first));
    expect(turnsOf(result)[0].userText).toBe("What next?");
  });

  it("stops and forgets a note's chats when the note is removed", async () => {
    const stream = controlledStream();
    const { result } = renderHook(() => useAssistant(), { wrapper });
    await act(async () => result.current.send(input));

    await act(async () => result.current.forgetNote(1));

    expect(stream.signals[0]?.aborted).toBe(true);
    expect(result.current.chats[1]).toBeUndefined();
  });

  it("keeps notes' chats apart", async () => {
    const stream = controlledStream();
    const { result } = renderHook(() => useAssistant(), { wrapper });
    await act(async () => result.current.send(input));
    await act(async () => { stream.emit({ type: "done" }); });
    await act(async () => result.current.send({ ...input, noteId: 2, userText: "other note" }));
    expect(turnsOf(result, 1).map((t) => t.userText)).toEqual(["What next?"]);
    expect(turnsOf(result, 2).map((t) => t.userText)).toEqual(["other note"]);
  });
});

describe("AssistantProvider on a shared store", () => {
  const sharedWrapper = (store: ReturnType<typeof createChatsStore>) =>
    function Shared({ children }: { children: ReactNode }) {
      return <AssistantProvider store={store}>{children}</AssistantProvider>;
    };
  const newStore = () => createChatsStore({ streamChat: (request, signal) => streamChat(request, signal) });

  it("shows the same chats to everything that shares the store", async () => {
    controlledStream();
    const store = newStore();
    const first = renderHook(() => useAssistant(), { wrapper: sharedWrapper(store) });
    const second = renderHook(() => useAssistant(), { wrapper: sharedWrapper(store) });

    await act(async () => first.result.current.send(input));

    expect(turnsOf(second.result)).toHaveLength(1);
    expect(second.result.current.isStreaming(1)).toBe(true);
  });

  it("lets an answer finish when the screen that asked goes away, but cuts off one the provider owns", async () => {
    const shared = controlledStream();
    const store = newStore();
    const sharedHook = renderHook(() => useAssistant(), { wrapper: sharedWrapper(store) });
    await act(async () => sharedHook.result.current.send(input));
    sharedHook.unmount();
    expect(shared.signals[0]?.aborted).toBe(false);

    const owned = controlledStream();
    const ownedHook = renderHook(() => useAssistant(), { wrapper });
    await act(async () => ownedHook.result.current.send(input));
    ownedHook.unmount();
    expect(owned.signals[0]?.aborted).toBe(true);
  });
});
