import { promptWasCut } from "./context";
import type { ChatErrorKind, ChatEvent, ChatMessage } from "./types";

/**
 * The AI helper's conversations, one set per note, kept in memory above the panes so that closing or moving a
 * pane does not lose a chat or stop a stream. Pure state and a reducer, so it is easy to test; the provider
 * (components/notes/AssistantProvider.tsx) owns the streams and feeds their events in.
 */
export type TurnStatus = "streaming" | "done" | "stopped" | "error";

/** One question and its answer. */
export type Turn = {
  id: string;
  model: string;
  /** What the user typed. */
  userText: string;
  /** The message as sent, which includes any selection; kept for the history of later turns. */
  userMessage: ChatMessage;
  selectionChars: number;
  selectionCut: boolean;
  /** The prompt's estimated size when it was sent, to compare with what the server says it read. */
  estimatedTokens: number;
  answer: string;
  /** The model is reasoning and has not started its answer. */
  thinking: boolean;
  status: TurnStatus;
  error?: { kind: ChatErrorKind; message: string };
  usage?: { promptTokens?: number; outputTokens?: number };
  /** The server read far less than was sent: it dropped the oldest text. */
  promptCut: boolean;
};

export type Conversation = { id: string; turns: Turn[] };
export type NoteChats = { conversations: Conversation[]; activeId: string };
export type ChatsState = Readonly<Record<number, NoteChats>>;

export const NO_CHATS: ChatsState = {};

export type ChatsAction =
  | { type: "turn-started"; noteId: number; conversationId: string; turn: Turn }
  | { type: "event"; noteId: number; conversationId: string; turnId: string; event: ChatEvent }
  | { type: "new-chat"; noteId: number; conversationId: string }
  | { type: "select"; noteId: number; conversationId: string }
  | { type: "note-removed"; noteId: number };

export function activeConversation(state: ChatsState, noteId: number): Conversation | undefined {
  const chats = state[noteId];
  return chats?.conversations.find((c) => c.id === chats.activeId);
}

/** The messages to send ahead of a new question: those of every turn that finished. */
export function historyOf(conversation: Conversation): ChatMessage[] {
  return conversation.turns.flatMap((t) =>
    t.status === "done" ? [t.userMessage, { role: "assistant" as const, content: t.answer }] : [],
  );
}

function updateTurn(state: ChatsState, noteId: number, conversationId: string, turnId: string, change: (t: Turn) => Turn): ChatsState {
  const chats = state[noteId];
  const conversation = chats?.conversations.find((c) => c.id === conversationId);
  const turn = conversation?.turns.find((t) => t.id === turnId);
  if (!chats || !conversation || !turn || turn.status !== "streaming") return state;
  return {
    ...state,
    [noteId]: {
      ...chats,
      conversations: chats.conversations.map((c) =>
        c.id === conversationId ? { ...c, turns: c.turns.map((t) => (t.id === turnId ? change(t) : t)) } : c,
      ),
    },
  };
}

function applyEvent(turn: Turn, event: ChatEvent): Turn {
  switch (event.type) {
    case "thinking":
      return { ...turn, thinking: true };
    case "delta":
      return { ...turn, thinking: false, answer: turn.answer + event.text };
    case "usage":
      return {
        ...turn,
        usage: { promptTokens: event.promptTokens, outputTokens: event.outputTokens },
        promptCut: promptWasCut(turn.estimatedTokens, event.promptTokens),
      };
    case "done":
      return { ...turn, thinking: false, status: "done" };
    case "error":
      return event.kind === "aborted"
        ? { ...turn, thinking: false, status: "stopped" }
        : { ...turn, thinking: false, status: "error", error: { kind: event.kind, message: event.message } };
  }
}

export function chatsReducer(state: ChatsState, action: ChatsAction): ChatsState {
  switch (action.type) {
    case "turn-started": {
      const chats = state[action.noteId];
      if (!chats) {
        return {
          ...state,
          [action.noteId]: { conversations: [{ id: action.conversationId, turns: [action.turn] }], activeId: action.conversationId },
        };
      }
      return {
        ...state,
        [action.noteId]: {
          ...chats,
          conversations: chats.conversations.map((c) =>
            c.id === action.conversationId ? { ...c, turns: [...c.turns, action.turn] } : c,
          ),
        },
      };
    }
    case "event":
      return updateTurn(state, action.noteId, action.conversationId, action.turnId, (t) => applyEvent(t, action.event));
    case "new-chat": {
      const chats = state[action.noteId];
      const active = activeConversation(state, action.noteId);
      // A chat nobody has written in yet is the new chat already.
      if (!chats || !active || active.turns.length === 0) return state;
      return {
        ...state,
        [action.noteId]: {
          conversations: [...chats.conversations, { id: action.conversationId, turns: [] }],
          activeId: action.conversationId,
        },
      };
    }
    case "select": {
      const chats = state[action.noteId];
      if (!chats || chats.activeId === action.conversationId || !chats.conversations.some((c) => c.id === action.conversationId)) return state;
      return { ...state, [action.noteId]: { ...chats, activeId: action.conversationId } };
    }
    case "note-removed": {
      if (!(action.noteId in state)) return state;
      const { [action.noteId]: _removed, ...rest } = state;
      void _removed;
      return rest;
    }
  }
}
