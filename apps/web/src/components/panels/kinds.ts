import { DOCK_MIN_WIDTH } from "../notes/assistantDock";
import type { PaneView } from "../notes/panes";
import type { PluginId } from "@/lib/composition/plugins";
import type { KindId, PanelRecord } from "./panelsState";

/** What a note panel saves: the note it shows (none yet, for one just made from the empty panel) and its tab. */
export type NotePanelState = { noteId: number | null; view: PaneView };

/** What a notes browser saves: the notebook it lists (none picked yet). */
export type NotesBrowserState = { notebookId: number | null };

/**
 * What an AI panel saves: the note it is about (pinned), or that it follows whichever note the user is working in
 * (then `noteId` is not used).
 */
export type AssistantPanelState = { noteId: number | null; follow: boolean };

/** How a to-do panel shows the items: as the nested list, or as a board with a column per status. */
export type TodoView = "list" | "board";

/** What a to-do panel saves: the items whose sub-items are folded away in it, and which view it is on. The items themselves, and the panels' background, are the workspace's. */
export type TodoPanelState = { collapsed: number[]; view: TodoView };

/** The least width, in px, the list beside a Reading List page can be dragged to, and the least the page keeps. */
export const READING_LIST_MIN_WIDTH = 160;
export const READING_PAGE_MIN_WIDTH = 240;
export const DEFAULT_READING_LIST_WIDTH = 260;

/** What a Reading List panel saves: the link it has open (none yet, or one since deleted), and how wide its list is. The links themselves are the workspace's. */
export type ReadingListPanelState = { selectedId: number | null; listWidth: number };

/** What a kind may check a saved state against: the workspace as it is now. */
export type RestoreContext = {
  hasNote(noteId: number): boolean;
  hasNotebook(notebookId: number): boolean;
};

/** The width a panel can be dragged down to unless its kind needs more. The same as the web app's note pane. */
const MIN_PANEL_WIDTH = 240;

const VIEWS: readonly unknown[] = ["split", "markdown", "preview"] satisfies PaneView[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What the store needs to know about each kind: the state a new panel of it starts with, and how to read one back
 * from what was saved. The kind owns the shape of its state; the host stores it as it is and hands it back
 * untouched. `restore` returns the state, or null when it cannot (the panel then comes back empty, so the rest of the
 * layout survives).
 */
export const KINDS: Record<
  KindId,
  {
    /** The least width, in px, a panel of this kind can be dragged down to. */
    minWidth: number;
    /** The plugin this kind belongs to: while it is off the kind is not offered, and its panels say so instead of showing. */
    plugin?: PluginId;
    initialState: () => unknown;
    restore: (saved: unknown, context: RestoreContext) => unknown | null;
  }
> = {
  empty: { minWidth: MIN_PANEL_WIDTH, initialState: () => null, restore: () => null },
  note: {
    minWidth: MIN_PANEL_WIDTH,
    initialState: (): NotePanelState => ({ noteId: null, view: "split" }),
    restore(saved, context) {
      if (!isRecord(saved) || !VIEWS.includes(saved.view)) return null;
      const { noteId, view } = saved;
      if (noteId !== null && !(typeof noteId === "number" && Number.isInteger(noteId) && context.hasNote(noteId))) return null;
      return { noteId, view } as NotePanelState;
    },
  },
  "notes-browser": {
    minWidth: MIN_PANEL_WIDTH,
    initialState: (): NotesBrowserState => ({ notebookId: null }),
    restore(saved, context) {
      if (!isRecord(saved)) return null;
      const { notebookId } = saved;
      return { notebookId: typeof notebookId === "number" && context.hasNotebook(notebookId) ? notebookId : null } satisfies NotesBrowserState;
    },
  },
  ai: {
    minWidth: DOCK_MIN_WIDTH,
    initialState: (): AssistantPanelState => ({ noteId: null, follow: true }),
    restore(saved, context) {
      if (!isRecord(saved) || typeof saved.follow !== "boolean") return null;
      if (saved.follow) return { noteId: null, follow: true } satisfies AssistantPanelState;
      const { noteId } = saved;
      if (!(typeof noteId === "number" && Number.isInteger(noteId) && context.hasNote(noteId))) return null;
      return { noteId, follow: false } satisfies AssistantPanelState;
    },
  },
  todo: {
    minWidth: MIN_PANEL_WIDTH,
    plugin: "todo",
    initialState: (): TodoPanelState => ({ collapsed: [], view: "list" }),
    restore(saved) {
      if (!isRecord(saved) || !Array.isArray(saved.collapsed)) return null;
      return {
        collapsed: saved.collapsed.filter((id): id is number => Number.isSafeInteger(id)),
        // Panels saved before the board existed have no view.
        view: saved.view === "board" ? "board" : "list",
      } satisfies TodoPanelState;
    },
  },
  "reading-list": {
    minWidth: 480,
    plugin: "reading-list",
    initialState: (): ReadingListPanelState => ({ selectedId: null, listWidth: DEFAULT_READING_LIST_WIDTH }),
    restore(saved) {
      if (!isRecord(saved)) return null;
      const { selectedId, listWidth } = saved;
      // The link may have been deleted since; the panel then asks for another to be picked, so it is not checked here.
      return {
        selectedId: Number.isSafeInteger(selectedId) ? (selectedId as number) : null,
        listWidth:
          typeof listWidth === "number" && Number.isFinite(listWidth) ? Math.max(READING_LIST_MIN_WIDTH, Math.round(listWidth)) : DEFAULT_READING_LIST_WIDTH,
      } satisfies ReadingListPanelState;
    },
  },
};

/**
 * The view a note panel added beside another starts on. A lone note starts on "split", but notes open together are
 * there to be written in, and each has only a share of the room, so the editor is the default and the preview is a
 * tab away. (The same choice `panes.ts` makes for the web app's row.)
 */
export const BESIDE_VIEW: PaneView = "markdown";

/** The note a panel shows; null for a panel of another kind, or a note panel not showing one yet. */
export function noteIdOf(panel: PanelRecord): number | null {
  return panel.kind === "note" ? (panel.state as NotePanelState).noteId : null;
}

/**
 * The note a panel is about, whether it shows it (a note panel) or is pinned to it (an AI panel): the one that stays
 * on screen, struck through, if the note is deleted. Null for a panel of another kind, or one not about a note.
 */
export function aboutNoteId(panel: PanelRecord): number | null {
  if (panel.kind === "ai") {
    const { noteId, follow } = panel.state as AssistantPanelState;
    return follow ? null : noteId;
  }
  return noteIdOf(panel);
}
