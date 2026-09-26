"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { MarkdownEditor } from "./MarkdownEditor";
import { NoteSidebar } from "./NoteSidebar";
import type { Note } from "./types";

const STORAGE_KEY = "composition:notes";

const WELCOME = `# Welcome

Write **Markdown** on the left and see it rendered on the right.

- Create notes with the button in the sidebar
- Notes are saved in this browser
`;

function newNote(content = ""): Note {
  return { id: crypto.randomUUID(), content, updatedAt: Date.now() };
}

function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: Note[] = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // fall through to the seeded note
  }
  return [newNote(WELCOME)];
}

const subscribe = () => () => {};

// Notes live in localStorage, so render only on the client (false on the server
// and during hydration) to keep the initial markup identical.
export function NotesApp() {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return mounted ? <Workspace /> : null;
}

function Workspace() {
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [activeId, setActiveId] = useState<string>(() => notes[0].id);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }, [notes]);

  const active = notes.find((n) => n.id === activeId);

  function create() {
    const note = newNote();
    setNotes((prev) => [note, ...prev]);
    setActiveId(note.id);
  }

  function remove(id: string) {
    const remaining = notes.filter((n) => n.id !== id);
    const next = remaining.length > 0 ? remaining : [newNote()];
    setNotes(next);
    if (id === activeId) setActiveId(next[0].id);
  }

  function update(content: string) {
    setNotes((prev) =>
      prev.map((n) =>
        n.id === activeId ? { ...n, content, updatedAt: Date.now() } : n,
      ),
    );
  }

  return (
    <div className="flex h-screen">
      <NoteSidebar
        notes={notes}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={create}
        onDelete={remove}
      />
      {active && <MarkdownEditor value={active.content} onChange={update} />}
    </div>
  );
}
