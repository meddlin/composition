"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { PdfContents } from "@/lib/composition/documentsApi";
import type { DuplicateImport } from "@/lib/composition/documentsStore";
import { describeCitingNotes, describeContents } from "@/lib/composition/pdfContents";
import { canMoveGroup } from "@/lib/composition/groupMove";
import { TRASH_RETENTION_DAYS } from "@/lib/composition/trash";
import type { SidebarActions } from "../panels/host";
import { MAIN_WINDOW, type WindowId } from "../panels/panelsState";
import { noteTitle } from "./types";
import type { ChangeResult, WorkspaceStore } from "./workspaceStore";

export type PendingDelete = { kind: "note" | "group" | "notebook"; id: number };

type Options = {
  /** The window new notes open in. */
  windowId?: WindowId;
  /** A group was picked; the window decides what that shows (the main window has a page for it, a pop-out has not). */
  onSelectGroup?: (groupId: number) => void;
  /** A note was made and opened. */
  onCreated?: () => void;
};

/**
 * What a window does to the workspace's notes, groups and notebooks when its user asks: the sidebar's actions, the
 * message when the backend refuses one, and the question asked before anything is deleted. A window (the main one,
 * or a pop-out showing a notes browser) renders `dialog` once.
 */
export function useWorkspaceActions(store: WorkspaceStore, options: Options = {}) {
  const { windowId = MAIN_WINDOW, onSelectGroup, onCreated } = options;
  const { notes, groups, notebooks } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [groupError, setGroupError] = useState<string | null>(null);
  // Nothing is deleted until the user confirms in the dialog this drives.
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  // A PDF the user picked that the library already has: asked about before anything is imported again.
  const [duplicate, setDuplicate] = useState<DuplicateImport | null>(null);
  // What deleting a PDF's note would take with it, read when the delete dialog opens for one.
  const [contents, setContents] = useState<{ noteId: number; value: PdfContents | null } | null>(null);

  /** Shows the reason when the backend refused a change the store had already made. */
  function report(result: Promise<ChangeResult>) {
    void result.then(({ error }) => {
      if (error) setGroupError(error);
    });
  }

  /** Picks a PDF in the native dialog and imports it into a new note; says why when it is refused, asks when it is a duplicate. */
  async function importPdf(groupId: number | null, notebookId: number) {
    setGroupError(null);
    const result = await store.importPdf({ groupId, notebookId }, windowId);
    if (result.error) setGroupError(result.error);
    else if (result.duplicate) setDuplicate({ ...result.duplicate, target: { groupId, notebookId } });
    else if (result.note) onCreated?.();
  }

  async function importCopy(pending: DuplicateImport) {
    setDuplicate(null);
    const result = await store.importPdfCopy(pending, windowId);
    if (result.error) setGroupError(result.error);
    else if (result.note) onCreated?.();
  }

  const actions: SidebarActions = {
    groupError,
    onToggleFavorite: store.toggleFavorite,
    onSelectGroup: (id) => onSelectGroup?.(id),
    onCreate: (groupId, notebookId) => void store.createNote(groupId, notebookId, windowId).then(() => onCreated?.()),
    onImportPdf: store.documents.available ? (groupId, notebookId) => void importPdf(groupId, notebookId) : undefined,
    onDelete: (id) => setPendingDelete({ kind: "note", id }),
    onCreateGroup: (name, parentId, notebookId) => void store.createGroup(name, parentId, notebookId),
    onRenameGroup: (id, name) => store.renameGroup(id, name),
    onDeleteGroup: (id) => setPendingDelete({ kind: "group", id }),
    onMoveGroup: (id, parentId) => {
      if (!canMoveGroup(groups, id, parentId)) return;
      setGroupError(null);
      report(store.moveGroup(id, parentId));
    },
    onPlaceNote: (noteId, groupId, beforeNoteId) => store.placeNote(noteId, groupId, beforeNoteId),
    onPlaceGroup: (id, parentId, beforeGroupId) => {
      // A drop that changes nothing leaves the groups as they were, and leaves an error on screen.
      const before = store.getSnapshot().groups;
      const result = store.placeGroup(id, parentId, beforeGroupId);
      if (store.getSnapshot().groups !== before) setGroupError(null);
      report(result);
    },
    onMoveNoteToGroup: (noteId, groupId) => store.moveNoteToGroup(noteId, groupId),
    onMoveGroupToNotebook: (id, notebookId) => {
      setGroupError(null);
      report(store.moveGroupToNotebook(id, notebookId));
    },
  };

  const pendingNote = pendingDelete?.kind === "note" ? notes.find((n) => n.id === pendingDelete.id) : undefined;
  const pendingGroup = pendingDelete?.kind === "group" ? groups.find((g) => g.id === pendingDelete.id) : undefined;
  const pendingNotebook = pendingDelete?.kind === "notebook" ? notebooks.find((n) => n.id === pendingDelete.id) : undefined;
  const pendingName = pendingNote ? noteTitle(pendingNote) : (pendingGroup?.name ?? pendingNotebook?.name);
  const pendingNoteId = pendingNote?.id;
  const ownsPdf = pendingNoteId !== undefined && store.documents.forNote(pendingNoteId) !== undefined;
  useEffect(() => {
    if (pendingNoteId === undefined || !ownsPdf) return;
    let current = true;
    store.documents
      .describe(pendingNoteId)
      .then((value) => current && setContents({ noteId: pendingNoteId, value }))
      .catch(() => current && setContents({ noteId: pendingNoteId, value: null }));
    return () => {
      current = false;
    };
  }, [store, pendingNoteId, ownsPdf]);
  const pdfContents = contents !== null && contents.noteId === pendingNoteId ? contents.value : null;

  function confirmDelete() {
    if (pendingNote) {
      store.removeNote(pendingNote.id);
    } else if (pendingGroup) {
      setGroupError(null);
      report(store.deleteGroup(pendingGroup.id));
    } else if (pendingNotebook) {
      setGroupError(null);
      report(store.deleteNotebook(pendingNotebook.id));
    }
    setPendingDelete(null);
  }

  const dialog: ReactNode = (
    <ConfirmDialog
      // Closes by itself if the item disappears (deleted elsewhere) while it is asking.
      open={pendingName !== undefined}
      title={`Delete ${pendingGroup ? "group " : pendingNotebook ? "notebook " : ""}“${pendingName ?? ""}”?`}
      description={
        pendingNotebook
          ? "The notebook is empty. It is deleted for good; it doesn't go to the Trash Can."
          : pdfContents
            ? `It moves to the Trash Can in Settings, where you can restore it, and is permanently deleted after ${TRASH_RETENTION_DAYS} days, with ${describeContents(pdfContents)}.${describeCitingNotes(pdfContents) ? ` ${describeCitingNotes(pdfContents)}` : ""}`
            : `It moves to the Trash Can in Settings, where you can restore it. Items in the Trash Can are permanently deleted after ${TRASH_RETENTION_DAYS} days.`
      }
      confirmLabel="Delete"
      // A PDF's note waits until the dialog knows what is inside, so what it says is what is deleted.
      confirmDisabled={ownsPdf && (contents === null || contents.noteId !== pendingNoteId)}
      onConfirm={confirmDelete}
      onCancel={() => setPendingDelete(null)}
    />
  );
  const duplicateOwner = duplicate?.existing.find((e) => store.getSnapshot().notes.some((n) => n.id === e.document.noteId));
  const duplicateDialog: ReactNode = (
    <AlertDialog open={duplicate !== null} onOpenChange={(open) => !open && setDuplicate(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>You already have this PDF</AlertDialogTitle>
          <AlertDialogDescription>
            “{duplicate?.fileName}” has exactly the same contents as {duplicate?.existing.map((e) => `“${e.noteTitle}”`).join(", ")}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="outline" onClick={() => duplicate && void importCopy(duplicate)}>
            Import a separate copy
          </Button>
          {duplicateOwner && (
            <Button
              onClick={() => {
                store.openNote(duplicateOwner.document.noteId, windowId);
                setDuplicate(null);
                onCreated?.();
              }}
            >
              Open it
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return {
    actions,
    groupError,
    requestDelete: setPendingDelete,
    dialog: (
      <>
        {dialog}
        {duplicateDialog}
      </>
    ),
  };
}
