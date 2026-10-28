"use client";

import { useState, useSyncExternalStore } from "react";
import { DuplicateNoteDialog } from "../panels/DuplicateNoteDialog";
import { noteIdOf } from "../panels/kinds";
import type { DropZone, PanelId } from "../panels/layoutTree";
import { setWarnDuplicateNotePanels, useWarnDuplicateNotePanels } from "../panels/panelPrefs";
import { MAIN_WINDOW, isNoteShown, type WindowId } from "../panels/panelsState";
import { PanelGrid } from "../panels/PanelGrid";
import type { NoteAreaProps, NoteSurface } from "./noteSurfaceTypes";
import { noteTitle } from "./types";
import type { WorkspaceStore } from "./workspaceStore";

export type { NoteAreaProps, NoteSurface };

/**
 * The desktop app's notes surface: panels in a grid. Showing a note in a second panel on purpose (Open to the side,
 * or a drop on a panel) asks first, unless the user turned that warning off.
 */
export function useNoteSurface(store: WorkspaceStore, windowId: WindowId = MAIN_WINDOW): NoteSurface {
  const { panels, notes, deleted } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const warn = useWarnDuplicateNotePanels();
  const [asking, setAsking] = useState<{ noteId: number; proceed: () => void } | null>(null);

  // A window that has just gone has nothing to report.
  const window = panels.windows[windowId];
  const focusedNoteId = window?.focusOrder.map((id) => noteIdOf(panels.byId[id])).find((id) => id !== null) ?? null;

  /** Does what was asked for, after asking first if it would show a note that is already open. */
  function unlessDuplicate(noteId: number, duplicates: boolean, proceed: () => void) {
    if (duplicates && warn) setAsking({ noteId, proceed });
    else proceed();
  }

  const askedNote = asking ? [...notes, ...deleted].find((n) => n.id === asking.noteId) : undefined;

  return {
    focusedNoteId,
    openNote: (noteId) => store.openNote(noteId, windowId),
    openNoteBeside: (noteId) =>
      unlessDuplicate(noteId, isNoteShown(store.getSnapshot().panels, noteId), () => store.openNoteBeside(noteId, windowId)),
    dropNote: (noteId: number, panelId: PanelId, zone: DropZone) =>
      // Dropped on the middle of the panel that shows it already changes nothing; anywhere else makes a second one.
      unlessDuplicate(noteId, isNoteShown(store.getSnapshot().panels, noteId, zone === "center" ? panelId : undefined), () =>
        store.dropNote(noteId, panelId, zone),
      ),
    dialog:
      asking && askedNote ? (
        <DuplicateNoteDialog
          title={noteTitle(askedNote)}
          onCancel={() => setAsking(null)}
          onOpenAnyway={(dontWarnAgain) => {
            if (dontWarnAgain) setWarnDuplicateNotePanels(false);
            asking.proceed();
            setAsking(null);
          }}
        />
      ) : null,
  };
}

/** The part of the workspace that shows the open notes: the window's grid of panels. */
export function NoteArea({ store, surface, layout, onCreateNote, onNewNoteFromText, sidebar }: NoteAreaProps) {
  return (
    <PanelGrid
      store={store}
      host={{
        ratio: layout.editorRatio,
        onRatioChange: layout.setEditorRatio,
        onRatioCommit: layout.commit,
        onCreateNote: () => onCreateNote(),
        onNewNoteFromText,
        onOpenNoteBeside: surface.openNoteBeside,
        onDropNote: surface.dropNote,
        sidebar,
      }}
    />
  );
}
