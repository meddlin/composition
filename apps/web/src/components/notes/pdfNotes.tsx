"use client";

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { WorkspaceStore } from "./workspaceStore";

const NO_PDF_NOTES: ReadonlySet<number> = new Set();

/** The ids of the notes that own a PDF, for the rows of the sidebar's tree to mark. Empty where there are no PDFs. */
const PdfNoteIdsContext = createContext<ReadonlySet<number>>(NO_PDF_NOTES);

/** Gives the tree below it the set of notes that own a PDF, kept up to date as PDFs are imported. */
export function PdfNoteIdsProvider({ store, children }: { store: WorkspaceStore; children: ReactNode }) {
  const { documents } = useSyncExternalStore(store.documents.subscribe, store.documents.getSnapshot, store.documents.getSnapshot);
  const ids = useMemo(() => (documents.length === 0 ? NO_PDF_NOTES : new Set(documents.map((d) => d.noteId))), [documents]);
  return <PdfNoteIdsContext.Provider value={ids}>{children}</PdfNoteIdsContext.Provider>;
}

export function usePdfNoteIds(): ReadonlySet<number> {
  return useContext(PdfNoteIdsContext);
}
