"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import {
  createGroup as createGroupAction,
  createNote,
  deleteGroup as deleteGroupAction,
  deleteNote,
  moveGroup as moveGroupAction,
  moveNoteToGroup as moveNoteToGroupAction,
  renameGroup as renameGroupAction,
  saveFavorites,
  saveNoteContent,
} from "@/lib/composition/client";
import {
  NO_FAVORITES,
  removeFavorite,
  toggleFavorite as toggleFavoriteIn,
  type Favorites,
  type FavoriteType,
} from "@/lib/composition/favorites";
import { canMoveGroup } from "@/lib/composition/groupMove";
import { TRASH_RETENTION_DAYS } from "@/lib/composition/trash";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, type Layout } from "@/lib/composition/layout";
import { DropOverlay } from "./DropOverlay";
import { GroupPage } from "./GroupPage";
import { NoteSidebar } from "./NoteSidebar";
import { PaneArea } from "./PaneArea";
import {
  closePane,
  dropNote,
  focusPane,
  initialPanes,
  openNote,
  setPaneView,
  withSizes,
  type DropZone,
} from "./panes";
import { ResizeHandle } from "./ResizeHandle";
import { SearchBar } from "./SearchBar";
import { applySavedNote, noteTitle, type Group, type Note } from "./types";
import { useLayout } from "./useLayout";
import { useNoteDrop } from "./useNoteDrop";

const AUTOSAVE_DELAY_MS = 500;

type Props = {
  initialNotes: Note[];
  initialGroups: Group[];
  initialLayout: Layout;
  initialFavorites?: Favorites;
};

export function NotesApp(props: Props) {
  return <Workspace {...props} />;
}

function Workspace({
  initialNotes,
  initialGroups,
  initialLayout,
  initialFavorites = NO_FAVORITES,
}: Props) {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [groups, setGroups] = useState<Group[]>(initialGroups);
  // The open notes, side by side; the focused one is where sidebar picks and new notes open.
  const [paneState, setPaneState] = useState(() => initialPanes(initialNotes[0]?.id ?? null));
  const [groupError, setGroupError] = useState<string | null>(null);
  // Nothing is deleted until the user confirms in the dialog this drives.
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "note" | "group"; id: number } | null
  >(null);
  // When set, the group's listing page replaces the panes.
  const [viewedGroupId, setViewedGroupId] = useState<number | null>(null);
  const layout = useLayout(initialLayout);
  const [favorites, setFavorites] = useState<Favorites>(initialFavorites);
  // Mirrors `favorites` so two quick toggles never build on a stale list.
  const latestFavorites = useRef(favorites);

  // Each open note debounces its own save: edits in two panes must not cancel each other's.
  const pendingSaves = useRef(
    new Map<number, { content: string; timer: ReturnType<typeof setTimeout> }>(),
  );

  /** Saves the note's pending edit now, or every note's when none is given. */
  function flushPendingSave(noteId?: number) {
    const ids = noteId === undefined ? [...pendingSaves.current.keys()] : [noteId];
    for (const id of ids) {
      const pending = pendingSaves.current.get(id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      pendingSaves.current.delete(id);
      startTransition(async () => {
        const saved = await saveNoteContent(id, pending.content);
        setNotes((prev) => applySavedNote(prev, saved));
      });
    }
  }

  // Flush any pending debounced save on unmount so navigating away never
  // silently drops the last few keystrokes (mirrors the CLI's flush-on-escape).
  useEffect(() => () => flushPendingSave(), []);

  const { panes, focusedId } = paneState;

  function updateFavorites(next: Favorites) {
    latestFavorites.current = next;
    setFavorites(next);
    startTransition(async () => {
      await saveFavorites(next);
    });
  }

  function toggleFavorite(type: FavoriteType, id: number) {
    updateFavorites(toggleFavoriteIn(latestFavorites.current, type, id));
  }

  // Deleting something pinned unpins it, so the stored list doesn't collect dead entries.
  function forgetFavorite(type: FavoriteType, id: number) {
    const next = removeFavorite(latestFavorites.current, type, id);
    if (next.length !== latestFavorites.current.length) updateFavorites(next);
  }

  // A group deleted while its page is open falls back to the panes.
  const viewedGroup = groups.find((g) => g.id === viewedGroupId) ?? null;

  function selectNote(id: number) {
    flushPendingSave();
    setPaneState((prev) => openNote(prev, id));
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
      setPaneState((prev) => openNote(prev, note.id));
      setViewedGroupId(null);
    });
  }

  /** Moves the note to the Trash Can. Call only once the user has confirmed. */
  function remove(id: number) {
    // Nothing left to save for a note that is going away.
    const pending = pendingSaves.current.get(id);
    if (pending) clearTimeout(pending.timer);
    pendingSaves.current.delete(id);

    setNotes((prev) => prev.filter((n) => n.id !== id));
    setPaneState((prev) => closePane(prev, id));
    forgetFavorite("note", id);
    startTransition(async () => {
      await deleteNote(id);
    });
  }

  function update(noteId: number, content: string) {
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, content } : n)));

    const pending = pendingSaves.current.get(noteId);
    if (pending) clearTimeout(pending.timer);
    pendingSaves.current.set(noteId, {
      content,
      timer: setTimeout(() => flushPendingSave(noteId), AUTOSAVE_DELAY_MS),
    });
  }

  function dropNoteOnPane(noteId: number, targetId: number, zone: DropZone) {
    setPaneState((prev) => dropNote(prev, noteId, targetId, zone));
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

  /** Moves the group to the Trash Can. Call only once the user has confirmed. */
  function deleteGroup(id: number) {
    setGroupError(null);
    startTransition(async () => {
      const result = await deleteGroupAction(id);
      if (result.error) {
        setGroupError(result.error);
        return;
      }
      setGroups((prev) => prev.filter((g) => g.id !== id));
      forgetFavorite("group", id);
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

  const pendingNote = pendingDelete?.kind === "note" ? notes.find((n) => n.id === pendingDelete.id) : undefined;
  const pendingGroup = pendingDelete?.kind === "group" ? groups.find((g) => g.id === pendingDelete.id) : undefined;
  const pendingName = pendingNote ? noteTitle(pendingNote) : pendingGroup?.name;

  function confirmDelete() {
    if (pendingNote) remove(pendingNote.id);
    else if (pendingGroup) deleteGroup(pendingGroup.id);
    setPendingDelete(null);
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="shrink-0 border-b p-2">
        <SearchBar onSelect={selectNote} />
      </header>
      <div className="flex min-h-0 flex-1">
        <NoteSidebar
          notes={notes}
          groups={groups}
          activeId={viewedGroup ? null : focusedId}
          viewedGroupId={viewedGroup?.id ?? null}
          width={layout.sidebarWidth}
          groupError={groupError}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onSelect={selectNote}
          onSelectGroup={selectGroup}
          onCreate={create}
          onDelete={(id) => setPendingDelete({ kind: "note", id })}
          onCreateGroup={createGroup}
          onRenameGroup={renameGroup}
          onDeleteGroup={(id) => setPendingDelete({ kind: "group", id })}
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
        ) : panes.length > 0 ? (
          <PaneArea
            panes={panes}
            notes={notes}
            focusedId={focusedId}
            ratio={layout.editorRatio}
            onRatioChange={layout.setEditorRatio}
            onRatioCommit={layout.commit}
            onFocus={(id) => setPaneState((prev) => focusPane(prev, id))}
            onViewChange={(id, view) => setPaneState((prev) => setPaneView(prev, id, view))}
            onClose={(id) => setPaneState((prev) => closePane(prev, id))}
            onChange={update}
            onDropNote={dropNoteOnPane}
            onResizePanes={(sizes) => setPaneState((prev) => withSizes(prev, sizes))}
          />
        ) : (
          <EmptyState hasNotes={notes.length > 0} onCreate={create} onOpenNote={selectNote} />
        )}
      </div>
      <ConfirmDialog
        // Closes by itself if the item disappears (deleted elsewhere) while it is asking.
        open={pendingName !== undefined}
        title={`Delete ${pendingGroup ? "group " : ""}“${pendingName ?? ""}”?`}
        description={`It moves to the Trash Can in Settings, where you can restore it. Items in the Trash Can are permanently deleted after ${TRASH_RETENTION_DAYS} days.`}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function EmptyState({
  hasNotes,
  onCreate,
  onOpenNote,
}: {
  hasNotes: boolean;
  onCreate: () => void;
  onOpenNote: (noteId: number) => void;
}) {
  // With no pane to drop beside, a dragged note just opens.
  const drop = useNoteDrop({ edges: false, onDrop: onOpenNote });

  return (
    <div className="relative flex min-w-0 flex-1" {...drop.handlers}>
      <Empty>
        <EmptyHeader>
          <EmptyDescription>
            {hasNotes ? "No note is open. Pick one, or drag it here." : "No notes yet."}
          </EmptyDescription>
        </EmptyHeader>
        {/* Not `onClick={onCreate}`: that would pass the click event on as the group id. */}
        <Button size="lg" onClick={() => onCreate()}>
          + New note
        </Button>
      </Empty>
      {drop.zone && <DropOverlay zone="center" />}
    </div>
  );
}
