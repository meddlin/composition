/**
 * Where the user has been, for stepping back to the note or page they were just
 * looking at (the mouse's Back button) and forward again.
 *
 * A location is whatever fills the main area: a note, a group's page, or Home. How
 * the panes are arranged is not part of it. Like the panes themselves, the history
 * is not saved: a reload starts a new one.
 */
export type NavLocation =
  | { kind: "note"; id: number }
  | { kind: "group"; id: number }
  | { kind: "home" };

export type NavHistory = {
  /** Oldest first. */
  entries: readonly NavLocation[];
  /** The entry being looked at; -1 only while nothing has been recorded. */
  cursor: number;
};

export const EMPTY_NAV_HISTORY: NavHistory = { entries: [], cursor: -1 };

/** The oldest entries are forgotten past this. */
export const MAX_NAV_ENTRIES = 100;

export function sameLocation(a: NavLocation, b: NavLocation): boolean {
  return a.kind === b.kind && (a.kind === "home" || (b.kind !== "home" && a.id === b.id));
}

/**
 * Notes where the user now is. Looking at what the history already points at changes
 * nothing, which is what lets a step back or forward apply its target without
 * recording it as a new visit. Anywhere else becomes the newest entry, dropping
 * whatever was ahead of the cursor, as a browser does.
 */
export function record(history: NavHistory, location: NavLocation): NavHistory {
  const current = history.entries[history.cursor];
  if (current && sameLocation(current, location)) return history;

  const entries = [...history.entries.slice(0, history.cursor + 1), location].slice(-MAX_NAV_ENTRIES);
  return { entries, cursor: entries.length - 1 };
}

export type NavStep = { history: NavHistory; location: NavLocation };

/**
 * The nearest entry `direction` steps away that is still worth showing, with the
 * history moved onto it; null when there is none. Entries for notes or groups that
 * are gone are passed over but kept, so a forward step after a back step still lands
 * where it should.
 */
function step(
  history: NavHistory,
  direction: 1 | -1,
  isValid: (location: NavLocation) => boolean,
): NavStep | null {
  for (let at = history.cursor + direction; at >= 0 && at < history.entries.length; at += direction) {
    const location = history.entries[at];
    if (isValid(location)) return { history: { ...history, cursor: at }, location };
  }
  return null;
}

export function back(history: NavHistory, isValid: (location: NavLocation) => boolean): NavStep | null {
  return step(history, -1, isValid);
}

export function forward(history: NavHistory, isValid: (location: NavLocation) => boolean): NavStep | null {
  return step(history, 1, isValid);
}
