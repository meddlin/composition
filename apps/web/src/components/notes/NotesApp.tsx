"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import {
  createGroup as createGroupAction,
  createNote,
  deleteGroup as deleteGroupAction,
  deleteNote,
  moveGroup as moveGroupAction,
  moveNoteToGroup as moveNoteToGroupAction,
  renameGroup as renameGroupAction,
  saveNoteContent,
} from "@/lib/composition/actions";
import { canMoveGroup } from "@/lib/composition/groupMove";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, type Layout } from "@/lib/composition/layout";
import { GroupPage } from "./GroupPage";
import { MarkdownEditor } from "./MarkdownEditor";
import { NoteSidebar } from "./NoteSidebar";
import { ResizeHandle } from "./ResizeHandle";
import { SearchBar } from "./SearchBar";
import { applySavedNote, type Group, type Note } from "./types";
import { useLayout } from "./useLayout";

const AUTOSAVE_DELAY_MS = 500;

type Props = {
  initialNotes: Note[];
  initialGroups: Group[];
  initialLayout: Layout;
};

export function NotesApp(props: Props) {
  return <Workspace {...props} />;
}

function Workspace({ initialNotes, initialGroups, initialLayout }: Props) {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [groups, setGroups] = useState<Group[]>(initialGroups);
  const [activeId, setActiveId] = useState<number | null>(initialNotes[0]?.id ?? null);
  const [groupError, setGroupError] = useState<string | null>(null);
  // When set, the group's listing page replaces the editor.
  const [viewedGroupId, setViewedGroupId] = useState<number | null>(null);
  const layout = useLayout(initialLayout);

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
      setNotes((prev) => applySavedNote(prev, saved));
    });
  }

  // Flush any pending debounced save on unmount so navigating away never
  // silently drops the last few keystrokes (mirrors the CLI's flush-on-escape).
  useEffect(() => () => flushPendingSave(), []);

  const active = notes.find((n) => n.id === activeId) ?? null;

  // A group deleted while its page is open falls back to the editor.
  const viewedGroup = groups.find((g) => g.id === viewedGroupId) ?? null;

  function selectNote(id: number) {
    flushPendingSave();
    setActiveId(id);
    setViewedGroupId(null);
  }

  function selectGroup(id: number) {
    flushPendingSave();
    setViewedGroupId(id);
  }

  function create(groupId: number | null = null) {
    flushPendingSave();
    startTransition(async () => {
      const note = await createNote("Untitled", groupId);
      setNotes((prev) => [note, ...prev]);
      setActiveId(note.id);
      setViewedGroupId(null);
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

  function moveGroup(id: number, parentId: number | null) {
    if (!canMoveGroup(groups, id, parentId)) return;
    setGroupError(null);
    const previousParentId = groups.find((g) => g.id === id)?.parentId ?? null;
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, parentId } : g)));
    startTransition(async () => {
      const result = await moveGroupAction(id, parentId);
      if (result.group) {
        const saved = result.group;
        setGroups((prev) => prev.map((g) => (g.id === saved.id ? saved : g)));
        return;
      }
      setGroups((prev) =>
        prev.map((g) => (g.id === id ? { ...g, parentId: previousParentId } : g)),
      );
      if (result.error) setGroupError(result.error);
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
          activeId={viewedGroup ? null : activeId}
          viewedGroupId={viewedGroup?.id ?? null}
          width={layout.sidebarWidth}
          groupError={groupError}
          onSelect={selectNote}
          onSelectGroup={selectGroup}
          onCreate={create}
          onDelete={remove}
          onCreateGroup={createGroup}
          onRenameGroup={renameGroup}
          onDeleteGroup={deleteGroup}
          onMoveGroup={moveGroup}
          onMoveNoteToGroup={moveNoteToGroup}
        />
        <ResizeHandle
          label="Resize sidebar"
          valueNow={layout.sidebarWidth}
          valueMin={MIN_SIDEBAR_WIDTH}
          valueMax={MAX_SIDEBAR_WIDTH}
          {...layout.sidebarResize}
        />
        {viewedGroup ? (
          <GroupPage
            groupId={viewedGroup.id}
            groups={groups}
            notes={notes}
            onSelectNote={selectNote}
            onSelectGroup={selectGroup}
            onRenameGroup={renameGroup}
          />
        ) : active ? (
          <MarkdownEditor
            value={active.content}
            onChange={update}
            ratio={layout.editorRatio}
            onRatioChange={layout.setEditorRatio}
            onRatioCommit={layout.commit}
          />
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
