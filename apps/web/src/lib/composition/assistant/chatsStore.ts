import { buildMessages, estimateTokens } from "./context";
import {
  activeConversation,
  chatsReducer,
  historyOf,
  NO_CHATS,
  type ChatsAction,
  type ChatsState,
  type Turn,
} from "./conversations";
import type { ChatEvent, ChatRequest } from "./types";

export type SendInput = {
  noteId: number;
  /** The note as it is now, including text not yet saved. */
  noteContent: string;
  selection?: string;
  userText: string;
  model: string;
  numCtx: number;
};

/** The one thing a chat reaches outside for: the stream of events for a request. */
export type ChatsDeps = {
  streamChat(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
};

export type ChatsStore = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ChatsState;
  /** Asks a question about a note. Ignored while that note's chat is still answering. */
  send(input: SendInput): void;
  /** Stops the answer that is streaming for the note, keeping what has arrived. */
  stop(noteId: number): void;
  newChat(noteId: number): void;
  select(noteId: number, conversationId: string): void;
  /** For a note that is gone: stops its answer and drops its chats. */
  forgetNote(noteId: number): void;
  /** Cuts off every answer that is still streaming. */
  abortAll(): void;
};

/**
 * The AI helper's conversations for every open note, with no React in it, so a closed or moved panel does not
 * lose a chat or cut off an answer that is still streaming. Nothing is saved: a reload starts empty.
 */
export function createChatsStore(deps: ChatsDeps, newId: () => string = () => crypto.randomUUID()): ChatsStore {
  let state: ChatsState = NO_CHATS;
  const listeners = new Set<() => void>();
  const running = new Map<number, AbortController>();

  function dispatch(action: ChatsAction) {
    state = chatsReducer(state, action);
    listeners.forEach((listener) => listener());
  }

  function send(input: SendInput) {
    const { noteId } = input;
    if (running.has(noteId)) return;

    const conversation = activeConversation(state, noteId);
    const conversationId = conversation?.id ?? newId();
    const built = buildMessages({
      noteContent: input.noteContent,
      history: conversation ? historyOf(conversation) : [],
      selection: input.selection,
      userText: input.userText,
    });
    const turn: Turn = {
      id: newId(),
      model: input.model,
      userText: input.userText,
      userMessage: built.userMessage,
      selectionChars: input.selection?.trim() ? Math.min(input.selection.length, 8000) : 0,
      selectionCut: built.selectionCut,
      estimatedTokens: estimateTokens(built.messages),
      answer: "",
      thinking: false,
      status: "streaming",
      promptCut: false,
    };
    dispatch({ type: "turn-started", noteId, conversationId, turn });

    const controller = new AbortController();
    running.set(noteId, controller);
    void (async () => {
      try {
        for await (const event of deps.streamChat({ model: input.model, messages: built.messages, numCtx: input.numCtx }, controller.signal)) {
          dispatch({ type: "event", noteId, conversationId, turnId: turn.id, event });
        }
      } finally {
        if (running.get(noteId) === controller) running.delete(noteId);
      }
    })();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => state,
    send,
    stop: (noteId) => running.get(noteId)?.abort(),
    newChat: (noteId) => dispatch({ type: "new-chat", noteId, conversationId: newId() }),
    select: (noteId, conversationId) => dispatch({ type: "select", noteId, conversationId }),
    forgetNote(noteId) {
      running.get(noteId)?.abort();
      running.delete(noteId);
      dispatch({ type: "note-removed", noteId });
    },
    abortAll: () => running.forEach((controller) => controller.abort()),
  };
}
