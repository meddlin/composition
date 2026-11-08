"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { Note } from "../notes/types";
import type { PdfLinks } from "../notes/NoteLink";
import type { PanelId } from "../panels/layoutTree";
import type { WorkspaceStore } from "../notes/workspaceStore";

/**
 * What the `pdf:` links in the note of one panel need: whether the PDF is here, and a way to show the page or mark a link
 * names. A link is good when the PDF has been imported on this device and its note is not in the Trash Can (a trashed PDF
 * counts as gone until it is restored, as a trashed note does for `note:` links). Undefined where there are no PDFs (the web
 * app), so that every `pdf:` link there is shown as dead.
 */
export function usePdfLinks(store: WorkspaceStore, panelId: PanelId, notes: readonly Note[]): PdfLinks | undefined {
  const { documents } = store;
  const snapshot = useSyncExternalStore(documents.subscribe, documents.getSnapshot, documents.getSnapshot);
  useEffect(() => {
    if (documents.available) void documents.load();
  }, [documents]);
  const pdfs = snapshot.documents;
  return useMemo(
    () =>
      documents.available
        ? {
            exists: (uuid) => {
              const document = pdfs.find((d) => d.uuid === uuid);
              return document !== undefined && notes.some((n) => n.id === document.noteId);
            },
            open: (ref) => store.openLinkedPdf(ref, panelId),
          }
        : undefined,
    [documents, pdfs, notes, store, panelId],
  );
}
