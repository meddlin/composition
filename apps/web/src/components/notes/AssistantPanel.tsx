"use client";

import { MessageSquareIcon, PlusIcon, SendIcon, SquareIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import type { AssistantModels } from "@/lib/composition/api";
import { buildMessages, estimateTokens, fitsContext } from "@/lib/composition/assistant/context";
import { activeConversation, historyOf, type Turn } from "@/lib/composition/assistant/conversations";
import { listAssistantModels } from "@/lib/composition/client";
import { cn } from "@/lib/utils";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { useAssistant } from "./AssistantProvider";
import { copyText } from "./clipboard";

const MODEL_KEY = "composition.assistant.model";

// Plain constants, shown by React: kept out of template strings, which Opengrep reads as HTML.
const PULL_HINT = "Install one with: ollama pull <model>";

type Props = {
  noteId: number;
  /** The note as it is now. The panel only reads it: nothing here can change a note. */
  noteContent: string;
  /** The text selected in the note's pane, read when focus moves into the panel. */
  getSelection: () => string;
  /** Makes a separate new note from an answer. */
  onNewNoteFromText: (text: string) => void;
  /** Closes the dock; a panel of the desktop app's grid is closed by its own header, and passes none. */
  onClose?: () => void;
  /** Escape in the composer: give focus back to the note. */
  onReturnFocus: () => void;
  /** Set when this is a panel of its own, which says which note it is about where a dock says "AI helper". */
  panel?: { noteTitle: string; /** The note was deleted: its chat can still be read, but nothing can be asked. */ deleted: boolean };
};

function readStoredModel(): string | null {
  try {
    return localStorage.getItem(MODEL_KEY);
  } catch {
    return null;
  }
}

function storeModel(name: string) {
  try {
    localStorage.setItem(MODEL_KEY, name);
  } catch {
    // Remembering the choice is a convenience only.
  }
}

const chatLabel = (turns: Turn[]) => {
  const first = turns[0]?.userText.trim().replace(/\s+/g, " ");
  if (!first) return "New chat";
  return first.length > 40 ? `${first.slice(0, 39)}…` : first;
};

function TurnView({ turn, onNewNote }: { turn: Turn; onNewNote: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const finished = turn.status !== "streaming";
  return (
    <div className="flex flex-col gap-2">
      <div className="ml-6 self-end rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap break-words">
        {turn.userText}
        {turn.selectionChars > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">
            with a selection ({turn.selectionChars.toLocaleString("en-US")} characters{turn.selectionCut ? ", cut" : ""})
          </div>
        )}
      </div>
      <div className="mr-2 text-sm">
        {turn.thinking && !turn.answer && <p className="text-muted-foreground italic">Thinking…</p>}
        {turn.answer && <AssistantMarkdown text={turn.answer} />}
        {turn.status === "stopped" && <p className="text-xs text-muted-foreground">Stopped.</p>}
        {turn.status === "error" && turn.error && (
          <p role="alert" className="break-words text-destructive">
            {turn.error.message}
          </p>
        )}
        {turn.promptCut && (
          <p className="mt-1 text-xs text-warning">
            The model only read part of this conversation: the server dropped the oldest text to fit its window. Raise
            the context size in Settings, or start a new chat.
          </p>
        )}
        {finished && turn.answer && (
          <div className="mt-1 flex gap-1">
            <Button
              variant="ghost"
              size="xs"
              onClick={async () => {
                setCopied(await copyText(turn.answer));
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button variant="ghost" size="xs" onClick={() => onNewNote(turn.answer)}>
              New note from this
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The AI helper beside a note: a chat with a model on the user's own Ollama server. It is handed the note's text to
 * read and has no way to change the note (there is no `onChange`); the only things that leave it are a copy of an
 * answer and a request for a separate new note.
 */
export function AssistantPanel({ noteId, noteContent, getSelection, onNewNoteFromText, onClose, onReturnFocus, panel }: Props) {
  const assistant = useAssistant();
  const deleted = panel?.deleted ?? false;
  const [found, setFound] = useState<AssistantModels | null>(null);
  const [picked, setPicked] = useState<string | null>(readStoredModel);
  const [draft, setDraft] = useState("");
  const [selection, setSelection] = useState("");
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    void listAssistantModels().then((result) => current && setFound(result));
    return () => {
      current = false;
    };
  }, []);
  const load = useCallback(() => {
    setFound(null);
    void listAssistantModels().then(setFound);
  }, []);

  const model = found?.models.find((m) => m.name === picked) ?? found?.models[0];
  const numCtx = found && model ? Math.min(found.contextTokens, model.contextLength ?? found.contextTokens) : (found?.contextTokens ?? 8192);

  const conversation = activeConversation(assistant.chats, noteId);
  const turns = useMemo(() => conversation?.turns ?? [], [conversation]);
  const streaming = assistant.isStreaming(noteId);

  const deferredDraft = useDeferredValue(draft);
  const estimate = useMemo(() => {
    const built = buildMessages({
      noteContent,
      history: conversation ? historyOf(conversation) : [],
      selection,
      userText: deferredDraft,
    });
    return estimateTokens(built.messages);
  }, [noteContent, conversation, selection, deferredDraft]);
  const fit = fitsContext(estimate, numCtx);

  const canSend = Boolean(model) && !deleted && !streaming && draft.trim() !== "" && fit !== "over";

  function send() {
    if (!model || !canSend) return;
    assistant.send({ noteId, noteContent, selection, userText: draft.trim(), model: model.name, numCtx });
    setDraft("");
    setSelection("");
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onReturnFocus();
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  // Keep the newest text in view while an answer streams in, unless the reader has scrolled up.
  useEffect(() => {
    const box = log.current;
    if (box && box.scrollHeight - box.scrollTop - box.clientHeight < 80) box.scrollTop = box.scrollHeight;
  }, [turns]);

  const grabSelection = () => {
    const text = getSelection();
    if (text.trim() !== "") setSelection(text);
  };

  const host = found ? new URL(found.serverUrl).host : "";
  const noModels = found && !found.error && found.models.length === 0;

  return (
    <aside
      aria-label="AI helper"
      className="flex h-full min-h-0 min-w-0 flex-col"
      onFocusCapture={grabSelection}
      onPointerDownCapture={grabSelection}
    >
      <header className="flex shrink-0 flex-col gap-1 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          {panel ? (
            <span className="min-w-0 flex-1 truncate text-sm" title={deleted ? "Deleted — in the Trash Can" : undefined}>
              <span className="text-muted-foreground">About </span>
              <span className={cn("font-medium", deleted && "line-through")}>{panel.noteTitle}</span>
            </span>
          ) : (
            <>
              <MessageSquareIcon className="size-4 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">AI helper</span>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="New chat"
            title="New chat"
            disabled={turns.length === 0 || streaming || deleted}
            onClick={() => assistant.newChat(noteId)}
          >
            <PlusIcon />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon-xs" aria-label="Close AI helper" title="Close" onClick={onClose}>
              <XIcon />
            </Button>
          )}
        </div>
        {found && !found.error && found.models.length > 0 && (
          <select
            aria-label="Model"
            value={model?.name ?? ""}
            onChange={(event) => {
              setPicked(event.target.value);
              storeModel(event.target.value);
            }}
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          >
            {found.models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.parameterSize ? `${m.name} (${m.parameterSize})` : m.name}
              </option>
            ))}
          </select>
        )}
        {assistant.chats[noteId] && assistant.chats[noteId].conversations.length > 1 && (
          <select
            aria-label="Chat"
            value={conversation?.id ?? ""}
            onChange={(event) => assistant.select(noteId, event.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1 text-xs"
          >
            {assistant.chats[noteId].conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {chatLabel(c.turns)}
              </option>
            ))}
          </select>
        )}
        {found && !found.error && (
          <p className={cn("text-xs", found.local ? "text-muted-foreground" : "text-warning")}>
            {found.local ? "Runs on this computer: nothing leaves it." : `Sends your notes to ${host}.`}
          </p>
        )}
      </header>

      <div ref={log} role="log" aria-live="polite" aria-busy={streaming} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {found === null && <p className="text-sm text-muted-foreground">Looking for models…</p>}
        {found?.error && (
          <div className="flex flex-col gap-2 text-sm">
            <p role="alert" className="break-words text-destructive">
              {found.error.message}
            </p>
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={load}>
                Check again
              </Button>
              <Link href="/settings" className="text-xs underline underline-offset-2">
                Settings
              </Link>
            </div>
          </div>
        )}
        {noModels && (
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>This server has no models that can chat. {PULL_HINT}</p>
            {found.hiddenCloud > 0 && (
              <p>
                {found.hiddenCloud === 1 ? "1 model runs" : `${found.hiddenCloud} models run`} on ollama.com and{" "}
                {found.hiddenCloud === 1 ? "is" : "are"} hidden: the helper only uses models on your own server.
              </p>
            )}
            <Button variant="outline" size="sm" className="w-fit" onClick={load}>
              Check again
            </Button>
          </div>
        )}
        {deleted && turns.length === 0 && (
          <p className="text-sm text-muted-foreground">This note was deleted, so there is nothing to ask about.</p>
        )}
        {!deleted && found && !found.error && found.models.length > 0 && turns.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask for guidance on this note. Select some text first to ask about just that part. Answers appear here;
            nothing is written into your note.
          </p>
        )}
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} onNewNote={onNewNoteFromText} />
        ))}
      </div>

      <div className="flex shrink-0 flex-col gap-1 border-t p-3">
        {selection !== "" && (
          <div className="flex items-center gap-1 self-start rounded-md bg-muted px-2 py-1 text-xs">
            <span>Selection ({selection.length.toLocaleString("en-US")} characters)</span>
            <button type="button" aria-label="Remove the selection" className="text-muted-foreground hover:text-foreground" onClick={() => setSelection("")}>
              <XIcon className="size-3" />
            </button>
          </div>
        )}
        <textarea
          aria-label="Ask about this note"
          value={draft}
          // Typing can start while the models are still being looked for; sending waits for one.
          disabled={deleted || (found !== null && !model)}
          rows={3}
          placeholder={deleted ? "This note was deleted." : "Ask about this note…"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onComposerKeyDown}
          className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
        />
        <div className="flex items-center gap-2">
          <p className={cn("min-w-0 flex-1 text-xs", fit === "ok" ? "text-muted-foreground" : "text-warning")}>
            {model && !deleted && `Sends this note (about ${estimate.toLocaleString("en-US")} tokens)`}
            {fit === "tight" && <span className="block">This nearly fills the model&apos;s window.</span>}
            {fit === "over" && (
              <span className="block">
                This is too large for the model&apos;s window. Raise the context size in Settings, or select a part of the note.
              </span>
            )}
          </p>
          {streaming ? (
            <Button size="sm" variant="outline" onClick={() => assistant.stop(noteId)}>
              <SquareIcon /> Stop
            </Button>
          ) : (
            <Button size="sm" disabled={!canSend} onClick={send} aria-label="Send">
              <SendIcon />
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
