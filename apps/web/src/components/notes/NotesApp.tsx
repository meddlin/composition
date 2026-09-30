"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import {
  createGroup as createGroupAction,
  createNote,
  deleteGroup as deleteGroupAction,
  deleteNote,
  moveNoteToGroup as moveNoteToGroupAction,
  renameGroup as renameGroupAction,
  saveNoteContent,
} from "@/lib/composition/actions";
import { MarkdownEditor } from "./MarkdownEditor";
import { NoteSidebar } from "./NoteSidebar";
import { SearchBar } from "./SearchBar";
import type { Group, Note } from "./types";

const AUTOSAVE_DELAY_MS = 500;

type Props = {
  initialNotes: Note[];
  initialGroups: Group[];
};

export function NotesApp({ initialNotes, initialGroups }: Props) {
  return <Workspace initialNotes={initialNotes} initialGroups={initialGroups} />;
}

function Workspace({ initialNotes, initialGroups }: Props) {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [groups, setGroups] = useState<Group[]>(initialGroups);
  const [activeId, setActiveId] = useState<number | null>(initialNotes[0]?.id ?? null);
  const [groupError, setGroupError] = useState<string | null>(null);

  const pendingSave = useRef<{ noteId: number; content: string } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function flushPendingSave() {
    if (saveTimer.current !== null) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const pending = pendingSave.current;
    if (!pending) return;
    pendingSave.current = null;
    startTransition(async () => {
      const saved = await saveNoteContent(pending.noteId, pending.content);
      setNotes((prev) => prev.map((n) => (n.id === saved.id ? saved : n)));
    });
  }

  // Flush any pending debounced save on unmount so navigating away never
  // silently drops the last few keystrokes (mirrors the CLI's flush-on-escape).
  useEffect(() => () => flushPendingSave(), []);

  const active = notes.find((n) => n.id === activeId) ?? null;

  function selectNote(id: number) {
    flushPendingSave();
    setActiveId(id);
  }

  function create() {
    flushPendingSave();
    startTransition(async () => {
      const note = await createNote("Untitled");
      setNotes((prev) => [note, ...prev]);
      setActiveId(note.id);
    });
  }

  function remove(id: number) {
    if (id === activeId) flushPendingSave();
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (id === activeId) setActiveId(null);
    startTransition(async () => {
      await deleteNote(id);
    });
  }

  function update(content: string) {
    if (!active) return;
    const noteId = active.id;
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, content } : n)));

    pendingSave.current = { noteId, content };
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushPendingSave, AUTOSAVE_DELAY_MS);
  }

  function createGroup(name: string, parentId: number | null) {
    startTransition(async () => {
      const group = await createGroupAction(name, parentId);
      setGroups((prev) => [...prev, group]);
    });
  }

  function renameGroup(id: number, name: string) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
    startTransition(async () => {
      const group = await renameGroupAction(id, name);
      setGroups((prev) => prev.map((g) => (g.id === group.id ? group : g)));
    });
  }

  function deleteGroup(id: number) {
    setGroupError(null);
    startTransition(async () => {
      const result = await deleteGroupAction(id);
      if (result.error) {
        setGroupError(result.error);
        return;
      }
      setGroups((prev) => prev.filter((g) => g.id !== id));
    });
  }

  function moveNoteToGroup(noteId: number, groupId: number | null) {
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, groupId } : n)));
    startTransition(async () => {
      const note = await moveNoteToGroupAction(noteId, groupId);
      setNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)));
    });
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="shrink-0 border-b border-foreground/10 p-2">
        <SearchBar onSelect={selectNote} />
      </header>
      <div className="flex min-h-0 flex-1">
        <NoteSidebar
          notes={notes}
          groups={groups}
          activeId={activeId}
          groupError={groupError}
          onSelect={selectNote}
          onCreate={create}
          onDelete={remove}
          onCreateGroup={createGroup}
          onRenameGroup={renameGroup}
          onDeleteGroup={deleteGroup}
          onMoveNoteToGroup={moveNoteToGroup}
        />
        {active ? (
          <MarkdownEditor value={active.content} onChange={update} />
        ) : (
          <EmptyState onCreate={create} />
        )}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-foreground/60">
      <p className="text-sm">No notes yet.</p>
      <button
        type="button"
        onClick={onCreate}
        className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-80"
      >
        + New note
      </button>
    </div>
  );
}
