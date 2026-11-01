import { getNote } from "./notesRepo";
import { indexNote, searchIsDisabled } from "./searchIndex";

/**
 * Tells the search about report notes that were made without it (the weekly cycle works synchronously, so it cannot wait on
 * the search server). Best effort, like every indexing in the app: a report is missed by search until the next reindex if
 * the server is down, and nothing else is affected.
 */
export async function indexReportNotes(noteIds: readonly number[]): Promise<void> {
  // At launch the cycle runs before search is up. The app indexes every note once it is (`SearchSidecar.reindex`), these
  // reports included, so trying now would only log an error for each.
  if (searchIsDisabled()) return;
  for (const id of noteIds) {
    try {
      const note = getNote(id);
      if (note) await indexNote(note);
    } catch (error) {
      console.error("[search] indexing a report failed:", error);
    }
  }
}
