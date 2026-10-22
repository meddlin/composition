import { describe, expect, it } from "vitest";
import { activeConversation, chatsReducer, historyOf, NO_CHATS, type ChatsState, type Turn } from "./conversations";

const turn = (id: string, userText = "q", over: Partial<Turn> = {}): Turn => ({
  id,
  model: "qwen3:0.6b",
  userText,
  userMessage: { role: "user", content: userText },
  selectionChars: 0,
  selectionCut: false,
  estimatedTokens: 100,
  answer: "",
  thinking: false,
  status: "streaming",
  promptCut: false,
  ...over,
});

const start = (state: ChatsState, noteId: number, conversationId: string, t: Turn) =>
  chatsReducer(state, { type: "turn-started", noteId, conversationId, turn: t });
const event = (state: ChatsState, noteId: number, conversationId: string, turnId: string, e: Parameters<typeof chatsReducer>[1] extends infer A ? A extends { type: "event"; event: infer E } ? E : never : never) =>
  chatsReducer(state, { type: "event", noteId, conversationId, turnId, event: e });

describe("chatsReducer", () => {
  it("starts a conversation on a note's first question", () => {
    const state = start(NO_CHATS, 1, "c1", turn("t1"));
    expect(state[1].conversations.map((c) => c.id)).toEqual(["c1"]);
    expect(state[1].activeId).toBe("c1");
    expect(activeConversation(state, 1)?.turns.map((t) => t.id)).toEqual(["t1"]);
  });

  it("adds the next question to the active conversation", () => {
    let state = start(NO_CHATS, 1, "c1", turn("t1"));
    state = start(state, 1, "c1", turn("t2"));
    expect(activeConversation(state, 1)?.turns.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("accumulates the answer as it streams, and marks the turn done", () => {
    let state = start(NO_CHATS, 1, "c1", turn("t1"));
    state = event(state, 1, "c1", "t1", { type: "thinking" });
    expect(activeConversation(state, 1)?.turns[0].thinking).toBe(true);
    state = event(state, 1, "c1", "t1", { type: "delta", text: "Hel" });
    state = event(state, 1, "c1", "t1", { type: "delta", text: "lo" });
    state = event(state, 1, "c1", "t1", { type: "usage", promptTokens: 90, outputTokens: 5 });
    state = event(state, 1, "c1", "t1", { type: "done" });
    expect(activeConversation(state, 1)?.turns[0]).toMatchObject({
      answer: "Hello", thinking: false, status: "done", usage: { promptTokens: 90, outputTokens: 5 }, promptCut: false,
    });
  });

  it("notices when the server read far fewer prompt tokens than were sent", () => {
    let state = start(NO_CHATS, 1, "c1", turn("t1", "q", { estimatedTokens: 3000 }));
    state = event(state, 1, "c1", "t1", { type: "usage", promptTokens: 35, outputTokens: 5 });
    expect(activeConversation(state, 1)?.turns[0].promptCut).toBe(true);
  });

  it("keeps what had streamed when a turn fails, and says why", () => {
    let state = start(NO_CHATS, 1, "c1", turn("t1"));
    state = event(state, 1, "c1", "t1", { type: "delta", text: "part" });
    state = event(state, 1, "c1", "t1", { type: "error", kind: "unreachable", message: "Can't reach Ollama." });
    expect(activeConversation(state, 1)?.turns[0]).toMatchObject({
      answer: "part", status: "error", error: { kind: "unreachable", message: "Can't reach Ollama." },
    });
  });

  it("calls a turn the user stopped stopped, not failed", () => {
    let state = start(NO_CHATS, 1, "c1", turn("t1"));
    state = event(state, 1, "c1", "t1", { type: "error", kind: "aborted", message: "Stopped." });
    expect(activeConversation(state, 1)?.turns[0]).toMatchObject({ status: "stopped" });
    expect(activeConversation(state, 1)?.turns[0].error).toBeUndefined();
  });

  it("ignores events for a turn that has ended or is unknown", () => {
    let state = start(NO_CHATS, 1, "c1", turn("t1"));
    state = event(state, 1, "c1", "t1", { type: "done" });
    const after = event(state, 1, "c1", "t1", { type: "delta", text: "late" });
    expect(after).toBe(state);
    expect(event(state, 1, "c1", "nope", { type: "delta", text: "x" })).toBe(state);
    expect(event(state, 9, "c1", "t1", { type: "delta", text: "x" })).toBe(state);
  });

  it("starts a new chat and keeps the old one, and does not pile up empty ones", () => {
    let state = start(NO_CHATS, 1, "c1", turn("t1"));
    state = chatsReducer(state, { type: "new-chat", noteId: 1, conversationId: "c2" });
    expect(state[1].conversations.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(state[1].activeId).toBe("c2");
    const again = chatsReducer(state, { type: "new-chat", noteId: 1, conversationId: "c3" });
    expect(again).toBe(state);
  });

  it("switches back to an earlier chat", () => {
    let state = start(NO_CHATS, 1, "c1", turn("t1"));
    state = chatsReducer(state, { type: "new-chat", noteId: 1, conversationId: "c2" });
    state = chatsReducer(state, { type: "select", noteId: 1, conversationId: "c1" });
    expect(activeConversation(state, 1)?.id).toBe("c1");
    expect(chatsReducer(state, { type: "select", noteId: 1, conversationId: "nope" })).toBe(state);
  });

  it("keeps each note's chats apart, and forgets a note that was removed", () => {
    let state = start(NO_CHATS, 1, "c1", turn("t1"));
    state = start(state, 2, "c9", turn("t9"));
    expect(activeConversation(state, 2)?.id).toBe("c9");
    state = chatsReducer(state, { type: "note-removed", noteId: 1 });
    expect(state[1]).toBeUndefined();
    expect(state[2]).toBeDefined();
  });
});

describe("historyOf", () => {
  it("is the questions as sent and the answers received, for the turns that finished", () => {
    let state = start(NO_CHATS, 1, "c1", turn("t1", "first", { userMessage: { role: "user", content: "SEL\nfirst" } }));
    state = event(state, 1, "c1", "t1", { type: "delta", text: "one" });
    state = event(state, 1, "c1", "t1", { type: "done" });
    state = start(state, 1, "c1", turn("t2", "second"));
    state = event(state, 1, "c1", "t2", { type: "delta", text: "partial" });
    state = event(state, 1, "c1", "t2", { type: "error", kind: "server", message: "x" });
    state = start(state, 1, "c1", turn("t3", "third")); // still streaming

    expect(historyOf(activeConversation(state, 1)!)).toEqual([
      { role: "user", content: "SEL\nfirst" },
      { role: "assistant", content: "one" },
    ]);
  });
});
