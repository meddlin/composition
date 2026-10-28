import type { Note } from "@/components/notes/types";
import type { PanelsApi } from "@/lib/composition/panelsApi";

/**
 * The ids of the notes that the saved panels are about (a note panel's, an AI panel's it is pinned to), in any window,
 * from a document that may be damaged or from another version.
 */
function shownNoteIds(saved: unknown): number[] {
  const windows = (saved as { windows?: unknown } | null | undefined)?.windows;
  if (typeof windows !== "object" || windows === null) return [];
  const ids = new Set<number>();
  for (const window of Object.values(windows)) {
    const panels = (window as { panels?: unknown } | null)?.panels;
    if (typeof panels !== "object" || panels === null) continue;
    for (const panel of Object.values(panels)) {
      const { kind, state } = (panel ?? {}) as { kind?: unknown; state?: { noteId?: unknown; follow?: unknown } | null };
      const about = kind === "note" || (kind === "ai" && state?.follow === false);
      if (about && Number.isSafeInteger(state?.noteId)) ids.add(state!.noteId as number);
    }
  }
  return [...ids];
}

/**
 * What the workspace needs to bring the panels back: the saved arrangement, and the notes it shows that have since
 * been deleted (so those panels come back showing a deleted note rather than empty). Neither failing stops the app
 * from opening: without them the window starts with one empty panel, or with an empty panel in the place of one.
 */
export async function loadPanelsToRestore(
  notes: readonly Note[],
  api: Pick<PanelsApi, "loadPanels" | "loadTrashedNotes">,
): Promise<{ saved: unknown; trashed: Note[] }> {
  let saved: unknown;
  try {
    saved = await api.loadPanels();
  } catch {
    return { saved: undefined, trashed: [] };
  }

  const present = new Set(notes.map((n) => n.id));
  const missing = shownNoteIds(saved).filter((id) => !present.has(id));
  if (missing.length === 0) return { saved, trashed: [] };
  try {
    return { saved, trashed: await api.loadTrashedNotes(missing) };
  } catch {
    return { saved, trashed: [] };
  }
}
