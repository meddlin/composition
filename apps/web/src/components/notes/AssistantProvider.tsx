"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { createChatsStore, type ChatsStore, type SendInput } from "@/lib/composition/assistant/chatsStore";
import { activeConversation, type ChatsState } from "@/lib/composition/assistant/conversations";
import { streamChat } from "@/lib/composition/assistantClient";

export type { SendInput };

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

/**
 * Gives the AI helper's conversations for every open note to the panes below it, so that closing, moving or
 * re-opening a pane does not lose a chat or cut off an answer that is still streaming. Nothing is saved: a reload
 * starts empty.
 *
 * With no `store` it keeps its own and cuts off any answer still streaming when it goes away. Given one (the
 * workspace's, which outlives the screen), it only reads it: an answer keeps arriving into the store.
 */
export function AssistantProvider({ children, store }: { children: ReactNode; store?: ChatsStore }) {
  const [owned] = useState(() => (store ? null : createChatsStore({ streamChat: (request, signal) => streamChat(request, signal) })));
  const chatsStore = (store ?? owned)!;
  const chats = useSyncExternalStore(chatsStore.subscribe, chatsStore.getSnapshot, chatsStore.getSnapshot);

  // Leaving the app's screen (or a test ending) must not leave a request running that nothing will read.
  useEffect(() => {
    if (!owned) return;
    return () => owned.abortAll();
  }, [owned]);

  const isStreaming = useCallback(
    (noteId: number) => {
      const turns = activeConversation(chats, noteId)?.turns ?? [];
      return turns.some((t) => t.status === "streaming");
    },
    [chats],
  );

  const value = useMemo(
    () => ({
      chats,
      send: chatsStore.send,
      stop: chatsStore.stop,
      newChat: chatsStore.newChat,
      select: chatsStore.select,
      forgetNote: chatsStore.forgetNote,
      isStreaming,
    }),
    [chats, chatsStore, isStreaming],
  );
  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
