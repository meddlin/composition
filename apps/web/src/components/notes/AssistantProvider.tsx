"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildMessages, estimateTokens } from "@/lib/composition/assistant/context";
import {
  activeConversation,
  chatsReducer,
  historyOf,
  NO_CHATS,
  type ChatsAction,
  type ChatsState,
  type Turn,
} from "@/lib/composition/assistant/conversations";
import { streamChat } from "@/lib/composition/assistantClient";

export type SendInput = {
  noteId: number;
  /** The note as it is now, including text not yet saved. */
  noteContent: string;
  selection?: string;
  userText: string;
  model: string;
  numCtx: number;
};

type Assistant = {
  chats: ChatsState;
  /** Asks a question about a note. Ignored while that note's chat is still answering. */
  send(input: SendInput): void;
  /** Stops the answer that is streaming for the note, keeping what has arrived. */
  stop(noteId: number): void;
  newChat(noteId: number): void;
  select(noteId: number, conversationId: string): void;
  /** For a note that is gone: stops its answer and drops its chats. */
  forgetNote(noteId: number): void;
  isStreaming(noteId: number): boolean;
};

const AssistantContext = createContext<Assistant | null>(null);

export function useAssistant(): Assistant {
  const value = useContext(AssistantContext);
  if (!value) throw new Error("useAssistant needs an AssistantProvider above it.");
  return value;
}

const newId = () => crypto.randomUUID();

/**
 * Holds the AI helper's conversations for every open note, above the panes, so that closing, moving or re-opening
 * a pane does not lose a chat or cut off an answer that is still streaming. Nothing is saved: a reload starts empty.
 */
export function AssistantProvider({ children }: { children: ReactNode }) {
  const [chats, setChats] = useState<ChatsState>(NO_CHATS);
  // The latest state, readable straight after a dispatch (a question's history must include the last answer).
  const latest = useRef<ChatsState>(NO_CHATS);
  const running = useRef(new Map<number, AbortController>());

  const dispatch = useCallback((action: ChatsAction) => {
    latest.current = chatsReducer(latest.current, action);
    setChats(latest.current);
  }, []);

  const send = useCallback(
    (input: SendInput) => {
      const { noteId } = input;
      if (running.current.has(noteId)) return;

      const conversation = activeConversation(latest.current, noteId);
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
      running.current.set(noteId, controller);
      void (async () => {
        try {
          for await (const event of streamChat({ model: input.model, messages: built.messages, numCtx: input.numCtx }, controller.signal)) {
            dispatch({ type: "event", noteId, conversationId, turnId: turn.id, event });
          }
        } finally {
          if (running.current.get(noteId) === controller) running.current.delete(noteId);
        }
      })();
    },
    [dispatch],
  );

  const stop = useCallback((noteId: number) => running.current.get(noteId)?.abort(), []);

  const newChat = useCallback((noteId: number) => dispatch({ type: "new-chat", noteId, conversationId: newId() }), [dispatch]);

  const select = useCallback(
    (noteId: number, conversationId: string) => dispatch({ type: "select", noteId, conversationId }),
    [dispatch],
  );

  const forgetNote = useCallback(
    (noteId: number) => {
      running.current.get(noteId)?.abort();
      running.current.delete(noteId);
      dispatch({ type: "note-removed", noteId });
    },
    [dispatch],
  );

  const isStreaming = useCallback(
    (noteId: number) => {
      const turns = activeConversation(chats, noteId)?.turns ?? [];
      return turns.some((t) => t.status === "streaming");
    },
    [chats],
  );

  // Leaving the app's screen (or a test ending) must not leave a request running.
  useEffect(() => {
    const controllers = running.current;
    return () => controllers.forEach((c) => c.abort());
  }, []);

  const value = useMemo(
    () => ({ chats, send, stop, newChat, select, forgetNote, isStreaming }),
    [chats, send, stop, newChat, select, forgetNote, isStreaming],
  );
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
