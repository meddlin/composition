"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import type { SidebarActions } from "../panels/host";
import { DropOverlay } from "./DropOverlay";
import type { NoteAreaProps, NoteSurface } from "./noteSurfaceTypes";
import { PaneArea } from "./PaneArea";
import { closePane, dropNote, focusPane, openNote, openNoteBeside, setPaneView, withSizes, type DropZone } from "./panes";
import { useNoteDrop } from "./useNoteDrop";
import type { WorkspaceStore } from "./workspaceStore";

export type { NoteAreaProps, NoteSurface, SidebarActions };

/**
 * The web app's notes surface: the open notes side by side in a single row of panes (see `panes.ts`). It has one window,
 * so `windowId` (which the desktop's surface uses for a pop-out) is not needed; it is here so both take the same arguments.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- see above
export function useNoteSurface(store: WorkspaceStore, _windowId?: string): NoteSurface {
  const { panes } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return {
    focusedNoteId: panes.focusedId,
    openNote: (noteId) => store.updatePanes((prev) => openNote(prev, noteId)),
    openNoteBeside: (noteId) => store.updatePanes((prev) => openNoteBeside(prev, noteId)),
    // The row's panes take drops themselves.
    dropNote: () => {},
    dialog: null,
  };
}

/** The part of the workspace that shows the open notes: the row of panes, or a prompt when none is open. */
export function NoteArea({ store, surface, layout, onCreateNote, onNewNoteFromText }: NoteAreaProps) {
  const { notes, panes: paneState } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { panes, focusedId } = paneState;

  /** Follows a link in `fromId`'s preview: the note replaces that pane's, or opens to its right. */
  function openLinkedNote(noteId: number, fromId: number, beside: boolean) {
    if (!notes.some((n) => n.id === noteId)) return;
    store.flushSaves();
    store.updatePanes((prev) =>
      beside ? dropNote(prev, noteId, fromId, "right") : openNote(focusPane(prev, fromId), noteId),
    );
  }

  if (panes.length === 0) {
    return <EmptyState hasNotes={notes.length > 0} onCreate={() => onCreateNote()} onOpenNote={surface.openNote} />;
  }
  return (
    <PaneArea
      panes={panes}
      notes={notes}
      focusedId={focusedId}
      ratio={layout.editorRatio}
      onRatioChange={layout.setEditorRatio}
      onRatioCommit={layout.commit}
      onFocus={(id) => store.updatePanes((prev) => focusPane(prev, id))}
      onViewChange={(id, view) => store.updatePanes((prev) => setPaneView(prev, id, view))}
      onClose={(id) => store.updatePanes((prev) => closePane(prev, id))}
      onChange={store.editNote}
      onDropNote={(noteId: number, targetId: number, zone: DropZone) =>
        store.updatePanes((prev) => dropNote(prev, noteId, targetId, zone))
      }
      onOpenNote={openLinkedNote}
      onNewNoteFromText={onNewNoteFromText}
      onResizePanes={(sizes) => store.updatePanes((prev) => withSizes(prev, sizes))}
    />
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
