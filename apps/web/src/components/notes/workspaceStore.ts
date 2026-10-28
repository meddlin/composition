import type { CompositionApi } from "@/lib/composition/api";
import { createChatsStore, type ChatsStore } from "@/lib/composition/assistant/chatsStore";
import { NO_FAVORITES, removeFavorite, toggleFavorite as toggleFavoriteIn, type FavoriteType, type Favorites } from "@/lib/composition/favorites";
import { canMoveGroup, canPlaceGroup } from "@/lib/composition/groupMove";
import { DEFAULT_HOME_SETTINGS, toggleNotebookPin as toggleNotebookPinIn, type HomeSettings } from "@/lib/composition/home";
import { applyOrder, placeBefore } from "@/lib/composition/ordering";
import { createTodosStore, unavailableTodos, type TodosStore } from "@/lib/composition/todosStore";
import type { WritingSettings } from "@/lib/composition/writing";
import type { DropZone, Edge, PanelId, SplitPath } from "../panels/layoutTree";
import { aboutNoteId } from "../panels/kinds";
import { fromDocument, highestPanelNumber, highestWindowNumber, toDocument, type PanelsDocument } from "../panels/panelsDocument";
import {
  closePanel as closePanelIn,
  closeWindow as closeWindowIn,
  focusNeighbour as focusNeighbourIn,
  focusPanel as focusPanelIn,
  initialPanels,
  MAIN_WINDOW,
  movePanel as movePanelIn,
  movePanelToNewWindow as movePanelToNewWindowIn,
  movePanelToWindow as movePanelToWindowIn,
  openLinkedNote as openLinkedNoteIn,
  resizePanels as resizePanelsIn,
  dropNote as dropNoteIn,
  openAssistantFor as openAssistantForIn,
  openNote as openNoteIn,
  openNoteBeside as openNoteBesideIn,
  openNoteBesideNote as openNoteBesideNoteIn,
  setAssistantFollow as setAssistantFollowIn,
  setPanelKind as setPanelKindIn,
  setPanelState as setPanelStateIn,
  splitPanel as splitPanelIn,
  type KindId,
  type PanelRecord,
  type PanelsState,
  type WindowId,
} from "../panels/panelsState";
import { createNoteFromAnswer } from "./createNoteFromAnswer";
import { closePane, dropNote, initialPanes, openNote, type PaneState } from "./panes";
import { applySavedNote, type Group, type Note, type Notebook } from "./types";

/** How long after the last keystroke a note is saved. */
export const AUTOSAVE_DELAY_MS = 500;

/** The part of the bridge the store calls; the client module (Server Actions or IPC) satisfies it. */
export type WorkspaceDeps = Pick<
  CompositionApi,
  | "saveNoteContent"
  | "createNote"
  | "deleteNote"
  | "moveNoteToGroup"
  | "placeNote"
  | "createGroup"
  | "renameGroup"
  | "moveGroup"
  | "placeGroup"
  | "deleteGroup"
  | "moveGroupToNotebook"
  | "createNotebook"
  | "renameNotebook"
  | "placeNotebook"
  | "deleteNotebook"
  | "saveFavorites"
  | "saveHomeSettings"
>;

// For a workspace given no notebooks (nothing in the database yet to ask for one).
const NO_NOTEBOOKS: Notebook[] = [{ id: 1, name: "Notebook", createdAt: "", updatedAt: "" }];

/** What the database holds; a workspace is created from it and a revisit is reconciled with it. */
export type WorkspaceData = {
  notes: Note[];
  groups: Group[];
  notebooks?: Notebook[];
  favorites?: Favorites;
  home?: HomeSettings;
  /** The editor's ruler and reflow. Not the store's business: it is carried along for the windows that show editors. */
  writing?: WritingSettings;
};

export type WorkspaceInitial = WorkspaceData;

/** What a change that the backend can refuse reports: the reason, or nothing when it went through. */
export type ChangeResult = { error?: string };

export type WorkspaceSnapshot = {
  notes: Note[];
  groups: Group[];
  notebooks: Notebook[];
  favorites: Favorites;
  /** How the home page is laid out, and which notebooks are pinned to it. */
  home: HomeSettings;
  /** The open notes, side by side; the focused one is where picks and new notes open. */
  panes: PaneState;
  /** The desktop app's arrangement of panels, which takes the place of `panes` there. */
  panels: PanelsState;
  /**
   * Notes that were deleted (or are gone from the database) while a panel is showing them, as they last were. The
   * panel stays, struck through, until it is closed or shows another note. Empty in the web app.
   */
  deleted: Note[];
};

/** What makes a workspace's open notes a grid of panels (the desktop app) rather than the single row of panes. */
export type WorkspaceOptions = {
  /** The to-do items the to-do panels show, one list for every window. Without it, loading them reports that they are unavailable. */
  todos?: TodosStore;
  panels?: {
    /** What was saved of the panels last time (read from the settings file); one this version can't read is ignored. */
    saved?: unknown;
    /** Notes in the Trash Can, to keep a restored panel showing one of them as a deleted note rather than empty. */
    trashed?: Note[];
    /** Told what to save whenever the arrangement or what a panel shows changes (not on every step of a divider drag). */
    save?: (document: PanelsDocument) => void;
  };
};

export type WorkspaceStore = {
  /** The AI helper's chats, which live with the workspace so they outlast any one screen or window. */
  readonly assistant: ChatsStore;
  /** The to-do items, which live with the workspace so every to-do panel, in any window, shows one list. */
  readonly todos: TodosStore;
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorkspaceSnapshot;
  /** Shows the text at once and saves it after a pause; each note has its own pause. */
  editNote(noteId: number, content: string): void;
  /** Sends the note's pending save now, or every note's when none is given. Resolves once what it sent has been saved (or has failed). */
  flushSaves(noteId?: number): Promise<void>;
  /**
   * Takes the database's version of everything: for a workspace that was kept while the user was elsewhere
   * (Settings can restore notes or a backup). Text still waiting to be saved is kept, and panes whose note is gone close.
   */
  reconcile(fresh: WorkspaceData): void;
  /** Applies one of the pure functions in `panes.ts` to the open panes. */
  updatePanes(update: (panes: PaneState) => PaneState): void;
  /** Puts a new empty panel beside the panel on the given side and focuses it; null if there is no such panel. */
  splitPanel(panelId: PanelId, edge: Edge): PanelId | null;
  /** Makes the panel the one the user is working in. */
  focusPanel(panelId: PanelId): void;
  /** Focuses the next (1) or previous (-1) panel of the window, in layout order, wrapping round. */
  focusNeighbour(delta: 1 | -1, windowId?: WindowId): void;
  /** Closes the panel. A window keeps one, so closing its last leaves a new empty panel. */
  closePanel(panelId: PanelId): void;
  /**
   * A pop-out window was closed: what was typed in it is sent first, then it and its panels are forgotten (and so is
   * the saved layout of it). The main window is never closed this way.
   */
  closeWindow(windowId: WindowId): void;
  /** Turns a panel into another kind, which starts with its own state. */
  setPanelKind(panelId: PanelId, kind: KindId): void;
  /** Replaces the state a panel saves; what it means is up to the panel's kind. */
  setPanelState(panelId: PanelId, state: unknown): void;
  /** Shows a note the way picking it in the sidebar does (see `openNote` in `panelsState.ts`). */
  openNote(noteId: number, windowId?: WindowId): void;
  /** The sidebar's "Open to the side": a new note panel beside the focused one, even if the note is open already. */
  openNoteBeside(noteId: number, windowId?: WindowId): void;
  /** A note dropped on a panel: onto its middle to fill it or replace its note, or on a side for a new panel there. */
  dropNote(noteId: number, panelId: PanelId, zone: DropZone): void;
  /** A link followed in the preview of the note in `fromPanelId`: its note opens in that panel, or beside it. */
  openLinkedNote(noteId: number, fromPanelId: PanelId, beside: boolean): void;
  /**
   * Opens the AI helper for the note in a note panel, and says which AI panel it is; null for a panel that shows no
   * note (see `openAssistantFor` in `panelsState.ts`).
   */
  openAssistantFor(panelId: PanelId): PanelId | null;
  /** Turns an AI panel's following of the note in use on or off; off pins it to the note it is about now. */
  setAssistantFollow(panelId: PanelId, follow: boolean): void;
  /** Moves a panel to where it was dropped on another panel of the window. */
  movePanel(panelId: PanelId, targetId: PanelId, zone: DropZone): void;
  /** Applies the sizes of a divider drag to the split at `path` (empty for the outermost). */
  resizePanels(path: SplitPath, sizes: number[], windowId?: WindowId): void;
  /** Sends the arrangement to be saved: at the end of a divider drag, whose steps `resizePanels` does not send. */
  commitPanels(): void;
  /**
   * Moves a panel into a new pop-out window of its own, and says which. Null if there is no such panel, or it is the
   * only panel of a pop-out already. The window is only data here: the main window's controller opens the real one.
   */
  movePanelToNewWindow(panelId: PanelId): WindowId | null;
  /** Moves a panel into another window, to the right of the panel used last there. */
  movePanelToWindow(panelId: PanelId, windowId: WindowId): void;
  /** Makes an empty note in the group and notebook, puts it at the top of the list and opens it. */
  createNote(groupId: number | null, notebookId: number, windowId?: WindowId): Promise<Note>;
  /** Moves the note to the Trash Can and closes its pane. Call only once the user has confirmed. */
  removeNote(noteId: number): void;
  moveNoteToGroup(noteId: number, groupId: number | null): void;
  /** Files the note in the group just before a sibling note (last when `beforeNoteId` is null). */
  placeNote(noteId: number, groupId: number | null, beforeNoteId: number | null): void;

  /** Makes a separate note from an AI answer, in the group and notebook of the note it was asked about, opened to that note's right. */
  newNoteFromText(fromNoteId: number, text: string, fallbackNotebookId: number): Promise<Note>;

  toggleFavorite(type: FavoriteType, id: number): void;
  toggleNotebookPin(notebookId: number): void;

  createGroup(name: string, parentId: number | null, notebookId: number): Promise<Group>;
  renameGroup(groupId: number, name: string): void;
  /** Re-parents a group; resolves once the backend has answered, with its reason if it refused (the change is then undone). */
  moveGroup(groupId: number, parentId: number | null): Promise<ChangeResult>;
  /** Files the group under the parent just before a sibling group (last when `beforeGroupId` is null). */
  placeGroup(groupId: number, parentId: number | null, beforeGroupId: number | null): Promise<ChangeResult>;
  /** Moves the group to the Trash Can. Call only once the user has confirmed. */
  deleteGroup(groupId: number): Promise<ChangeResult>;
  /** Moves the group, its sub-groups and their notes to the top level of another notebook. */
  moveGroupToNotebook(groupId: number, notebookId: number): Promise<ChangeResult>;

  createNotebook(name: string): Promise<Notebook>;
  renameNotebook(notebookId: number, name: string): void;
  /** Puts the notebook just before another in the list (last when `beforeId` is null). */
  placeNotebook(notebookId: number, beforeId: number | null): Promise<void>;
  /** Deletes the (empty) notebook for good. Call only once the user has confirmed. */
  deleteNotebook(notebookId: number): Promise<ChangeResult>;
};

/**
 * The workspace's data and its mutations, with no React in it. Windows read it through `subscribe` and
 * `getSnapshot` (React's `useSyncExternalStore`) and change it through the actions, which also reach the
 * backend through `deps`. A change shows at once; the backend's answer is applied when it arrives.
 */
export function createWorkspaceStore(
  initial: WorkspaceInitial,
  deps: WorkspaceDeps,
  assistant: ChatsStore = createChatsStore({
    streamChat: () => {
      throw new Error("The AI helper is not set up for this workspace.");
    },
  }),
  options: WorkspaceOptions = {},
): WorkspaceStore {
  const grid = options.panels !== undefined;
  let panelCount = 0;
  const newPanelId = () => `p${++panelCount}`;
  let windowCount = 0;
  const newWindowId = () => `w${++windowCount}`;
  const emptyPanel = (): PanelRecord => ({ id: newPanelId(), kind: "empty", state: null });
  const knownNotes = new Set([...initial.notes, ...(options.panels?.trashed ?? [])].map((n) => n.id));
  const knownNotebooks = new Set((initial.notebooks ?? NO_NOTEBOOKS).map((n) => n.id));
  const restored = options.panels
    ? fromDocument(options.panels.saved, { hasNote: (id) => knownNotes.has(id), hasNotebook: (id) => knownNotebooks.has(id) })
    : null;
  if (restored) {
    panelCount = highestPanelNumber(restored);
    windowCount = highestWindowNumber(restored);
  }
  const shownAtStart = new Set(Object.values(restored?.byId ?? {}).map(aboutNoteId));

  let state: WorkspaceSnapshot = {
    notes: initial.notes,
    groups: initial.groups,
    notebooks: initial.notebooks ?? NO_NOTEBOOKS,
    favorites: initial.favorites ?? NO_FAVORITES,
    home: initial.home ?? DEFAULT_HOME_SETTINGS,
    panes: initialPanes(grid ? null : (initial.notes[0]?.id ?? null)),
    panels: restored ?? initialPanels(newPanelId),
    deleted: (options.panels?.trashed ?? []).filter((n) => shownAtStart.has(n.id) && !initial.notes.some((m) => m.id === n.id)),
  };
  const listeners = new Set<() => void>();
  /** Deleted notes whose chats are kept to be read, for as long as an AI panel is pinned to them. */
  const keptChats = new Set<number>();
  const pendingSaves = new Map<number, { content: string; timer: ReturnType<typeof setTimeout> }>();

  /** Whether a change to the panels is one worth saving: not a change of focus, which `focusOrder` alone holds. */
  function arrangementChanged(before: PanelsState, after: PanelsState): boolean {
    if (before.byId !== after.byId) return true;
    return Object.keys(after.windows).some((id) => before.windows[id]?.layout !== after.windows[id].layout) ||
      Object.keys(before.windows).length !== Object.keys(after.windows).length;
  }

  const isAssistantPinnedTo = (noteId: number) =>
    Object.values(state.panels.byId).some((panel) => panel.kind === "ai" && aboutNoteId(panel) === noteId);

  function set(next: Partial<WorkspaceSnapshot>, saveArrangement = true) {
    const before = state.panels;
    state = { ...state, ...next };
    if (grid && saveArrangement && next.panels && arrangementChanged(before, state.panels)) {
      options.panels?.save?.(toDocument(state.panels));
    }
    if (grid && ("panels" in next || "deleted" in next)) {
      // A note nothing shows any more has nothing to be kept for.
      const shown = new Set(Object.values(state.panels.byId).map(aboutNoteId));
      const deleted = state.deleted.filter((n) => shown.has(n.id));
      if (deleted.length !== state.deleted.length) state = { ...state, deleted };

      for (const id of keptChats) {
        if (state.notes.some((n) => n.id === id)) keptChats.delete(id); // it came back: its chats are its own again
        else if (!isAssistantPinnedTo(id)) {
          keptChats.delete(id);
          assistant.forgetNote(id);
        }
      }
    }
    listeners.forEach((listener) => listener());
  }

  function editNote(noteId: number, content: string) {
    // A deleted note stays on screen to be read, not written to.
    if (!state.notes.some((n) => n.id === noteId)) return;
    set({ notes: state.notes.map((n) => (n.id === noteId ? { ...n, content } : n)) });
    const pending = pendingSaves.get(noteId);
    if (pending) clearTimeout(pending.timer);
    pendingSaves.set(noteId, { content, timer: setTimeout(() => flushSaves(noteId), AUTOSAVE_DELAY_MS) });
  }

  function flushSaves(noteId?: number): Promise<void> {
    const ids = noteId === undefined ? [...pendingSaves.keys()] : [noteId];
    const sent: Promise<void>[] = [];
    for (const id of ids) {
      const pending = pendingSaves.get(id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      pendingSaves.delete(id);
      sent.push(
        deps
          .saveNoteContent(id, pending.content)
          .then((saved) => set({ notes: applySavedNote(state.notes, saved) }))
          // The text is still on screen and is sent again when it is next edited; the page does not need to fail over it.
          .catch((error) => console.error("[notes] not saved:", error)),
      );
    }
    return Promise.all(sent).then(() => undefined);
  }

  function updateFavorites(next: Favorites) {
    set({ favorites: next });
    void deps.saveFavorites(next);
  }

  // Deleting something pinned unpins it, so the stored list doesn't collect dead entries.
  function forgetFavorite(type: FavoriteType, id: number) {
    const next = removeFavorite(state.favorites, type, id);
    if (next.length !== state.favorites.length) updateFavorites(next);
  }

  function updateHome(next: HomeSettings) {
    set({ home: next });
    void deps.saveHomeSettings(next);
  }

  async function createNote(groupId: number | null, notebookId: number, windowId: WindowId = MAIN_WINDOW) {
    flushSaves();
    const created = await deps.createNote("Untitled", groupId, notebookId);
    set({
      notes: [created, ...state.notes],
      ...(grid
        ? { panels: openNoteIn(state.panels, windowId, created.id, newPanelId) }
        : { panes: openNote(state.panes, created.id) }),
    });
    return created;
  }

  function removeNote(noteId: number) {
    // Nothing left to save for a note that is going away.
    const pending = pendingSaves.get(noteId);
    if (pending) clearTimeout(pending.timer);
    pendingSaves.delete(noteId);

    const gone = state.notes.find((n) => n.id === noteId);
    set({
      notes: state.notes.filter((n) => n.id !== noteId),
      panes: closePane(state.panes, noteId),
      ...(grid && gone ? { deleted: [...state.deleted, gone] } : {}),
    });
    forgetFavorite("note", noteId);
    // An AI panel pinned to the note keeps its chats on screen, to be read, until it is closed.
    if (grid && isAssistantPinnedTo(noteId)) keptChats.add(noteId);
    else assistant.forgetNote(noteId);
    void deps.deleteNote(noteId);
  }

  async function newNoteFromText(fromNoteId: number, text: string, fallbackNotebookId: number) {
    flushSaves();
    const from = state.notes.find((n) => n.id === fromNoteId);
    const created = await createNoteFromAnswer(text, from?.groupId ?? null, from?.notebookId ?? fallbackNotebookId, {
      createNote: deps.createNote,
      saveNoteContent: deps.saveNoteContent,
    });
    set({
      notes: [created, ...state.notes],
      ...(grid
        ? { panels: openNoteBesideNoteIn(state.panels, fromNoteId, created.id, newPanelId) }
        : { panes: dropNote(state.panes, created.id, fromNoteId, "right") }),
    });
    return created;
  }

  function reconcile(fresh: WorkspaceData) {
    // Typed text that has not been saved yet is newer than anything in the database.
    const notes = fresh.notes.map((n) => {
      const pending = pendingSaves.get(n.id);
      return pending ? { ...n, content: pending.content } : n;
    });
    const kept = new Set(notes.map((n) => n.id));
    for (const [id, pending] of pendingSaves) {
      if (kept.has(id)) continue;
      clearTimeout(pending.timer);
      pendingSaves.delete(id);
    }
    let panes = state.panes;
    for (const pane of state.panes.panes) if (!kept.has(pane.noteId)) panes = closePane(panes, pane.noteId);

    // A panel's note that the database no longer has stays, as it last was; one that is back is no longer deleted.
    const deleted = state.deleted.filter((n) => !kept.has(n.id));
    if (grid) {
      const was = new Map(state.notes.map((n) => [n.id, n]));
      for (const panel of Object.values(state.panels.byId)) {
        const id = aboutNoteId(panel);
        const note = id === null ? undefined : was.get(id);
        if (note && !kept.has(note.id) && !deleted.some((n) => n.id === note.id)) deleted.push(note);
      }
    }
    set({
      deleted,
      notes,
      groups: fresh.groups,
      notebooks: fresh.notebooks ?? state.notebooks,
      favorites: fresh.favorites ?? state.favorites,
      home: fresh.home ?? state.home,
      panes,
    });
  }

  function toggleFavorite(type: FavoriteType, id: number) {
    updateFavorites(toggleFavoriteIn(state.favorites, type, id));
  }

  function toggleNotebookPin(notebookId: number) {
    updateHome(toggleNotebookPinIn(state.home, notebookId));
  }

  function moveNoteToGroup(noteId: number, groupId: number | null) {
    set({ notes: state.notes.map((n) => (n.id === noteId ? { ...n, groupId } : n)) });
    void deps.moveNoteToGroup(noteId, groupId).then((saved) => set({ notes: state.notes.map((n) => (n.id === saved.id ? saved : n)) }));
  }

  function placeNote(noteId: number, groupId: number | null, beforeNoteId: number | null) {
    const target = state.notes.find((n) => n.id === noteId);
    if (!target) return;
    const siblings = state.notes.filter((n) => n.notebookId === target.notebookId && n.groupId === groupId).map((n) => n.id);
    const ordered = placeBefore(siblings, noteId, beforeNoteId);
    const unchanged = target.groupId === groupId && ordered.every((id, index) => id === siblings[index]);
    if (unchanged) return;
    set({ notes: applyOrder(state.notes.map((n) => (n.id === noteId ? { ...n, groupId } : n)), ordered) });
    void deps.placeNote(noteId, groupId, beforeNoteId).then((saved) => set({ notes: applySavedNote(state.notes, saved) }));
  }

  async function createGroup(name: string, parentId: number | null, notebookId: number) {
    const created = await deps.createGroup(name, parentId, notebookId);
    set({ groups: [...state.groups, created] });
    return created;
  }

  function renameGroup(groupId: number, name: string) {
    set({ groups: state.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) });
    void deps.renameGroup(groupId, name).then((saved) => set({ groups: state.groups.map((g) => (g.id === saved.id ? saved : g)) }));
  }

  /** Applies a group the backend returned, or reports why it refused after `undo` has put things back. */
  function settleGroup(result: { group?: Group; error?: string }, undo: () => void): ChangeResult {
    if (result.group) {
      const saved = result.group;
      set({ groups: state.groups.map((g) => (g.id === saved.id ? saved : g)) });
      return {};
    }
    undo();
    return result.error ? { error: result.error } : {};
  }

  async function moveGroup(groupId: number, parentId: number | null) {
    if (!canMoveGroup(state.groups, groupId, parentId)) return {};
    const previousParentId = state.groups.find((g) => g.id === groupId)?.parentId ?? null;
    set({ groups: state.groups.map((g) => (g.id === groupId ? { ...g, parentId } : g)) });
    const result = await deps.moveGroup(groupId, parentId);
    return settleGroup(result, () =>
      set({ groups: state.groups.map((g) => (g.id === groupId ? { ...g, parentId: previousParentId } : g)) }),
    );
  }

  async function placeGroup(groupId: number, parentId: number | null, beforeGroupId: number | null) {
    if (!canPlaceGroup(state.groups, groupId, parentId)) return {};
    const target = state.groups.find((g) => g.id === groupId)!;
    const siblings = state.groups.filter((g) => g.notebookId === target.notebookId && g.parentId === parentId).map((g) => g.id);
    const ordered = placeBefore(siblings, groupId, beforeGroupId);
    const unchanged = target.parentId === parentId && ordered.every((id, index) => id === siblings[index]);
    if (unchanged) return {};
    const previous = state.groups;
    set({ groups: applyOrder(state.groups.map((g) => (g.id === groupId ? { ...g, parentId } : g)), ordered) });
    const result = await deps.placeGroup(groupId, parentId, beforeGroupId);
    return settleGroup(result, () => set({ groups: previous }));
  }

  async function deleteGroup(groupId: number) {
    const result = await deps.deleteGroup(groupId);
    if (result.error) return { error: result.error };
    set({ groups: state.groups.filter((g) => g.id !== groupId) });
    forgetFavorite("group", groupId);
    return {};
  }

  async function moveGroupToNotebook(groupId: number, notebookId: number) {
    const previous = { groups: state.groups, notes: state.notes };
    const moved = new Set([groupId]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const g of state.groups) {
        if (g.parentId !== null && moved.has(g.parentId) && !moved.has(g.id)) {
          moved.add(g.id);
          changed = true;
        }
      }
    }
    set({
      groups: state.groups.map((g) =>
        moved.has(g.id) ? { ...g, notebookId, parentId: g.id === groupId ? null : g.parentId } : g,
      ),
      notes: state.notes.map((n) => (n.groupId !== null && moved.has(n.groupId) ? { ...n, notebookId } : n)),
    });
    const result = await deps.moveGroupToNotebook(groupId, notebookId);
    return settleGroup(result, () => set(previous));
  }

  async function createNotebook(name: string) {
    const created = await deps.createNotebook(name);
    set({ notebooks: [...state.notebooks, created] });
    return created;
  }

  function renameNotebook(notebookId: number, name: string) {
    set({ notebooks: state.notebooks.map((n) => (n.id === notebookId ? { ...n, name } : n)) });
    void deps.renameNotebook(notebookId, name).then((saved) => set({ notebooks: state.notebooks.map((n) => (n.id === saved.id ? saved : n)) }));
  }

  async function placeNotebook(notebookId: number, beforeId: number | null) {
    const ids = state.notebooks.map((n) => n.id);
    const ordered = placeBefore(ids, notebookId, beforeId);
    if (ordered.every((id, index) => id === ids[index])) return;
    const previous = state.notebooks;
    set({ notebooks: applyOrder(state.notebooks, ordered) });
    try {
      set({ notebooks: await deps.placeNotebook(notebookId, beforeId) });
    } catch {
      set({ notebooks: previous });
    }
  }

  async function deleteNotebook(notebookId: number) {
    const result = await deps.deleteNotebook(notebookId);
    if (result.error) return { error: result.error };
    set({ notebooks: state.notebooks.filter((n) => n.id !== notebookId) });
    // A deleted notebook is unpinned, so the saved list doesn't collect dead entries.
    if (state.home.pinnedNotebooks.includes(notebookId)) updateHome(toggleNotebookPinIn(state.home, notebookId));
    return {};
  }

  function splitPanel(panelId: PanelId, edge: Edge) {
    const id = newPanelId();
    const panels = splitPanelIn(state.panels, panelId, edge, { id, kind: "empty", state: null });
    if (panels === state.panels) return null;
    set({ panels });
    return id;
  }

  /** Applies one of the functions in `panelsState.ts`; nothing is announced when it changed nothing. */
  function updatePanels(update: (panels: PanelsState) => PanelsState, saveArrangement = true) {
    const panels = update(state.panels);
    if (panels !== state.panels) set({ panels }, saveArrangement);
  }

  return {
    assistant,
    todos: options.todos ?? createTodosStore(unavailableTodos),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => state,
    editNote,
    flushSaves,
    reconcile,
    newNoteFromText,
    toggleFavorite,
    toggleNotebookPin,
    updatePanes: (update) => set({ panes: update(state.panes) }),
    splitPanel,
    focusPanel: (panelId) => updatePanels((panels) => focusPanelIn(panels, panelId)),
    focusNeighbour: (delta, windowId = MAIN_WINDOW) => updatePanels((panels) => focusNeighbourIn(panels, windowId, delta)),
    closePanel: (panelId) => updatePanels((panels) => closePanelIn(panels, panelId, { id: newPanelId(), kind: "empty", state: null })),
    setPanelKind: (panelId, kind) => updatePanels((panels) => setPanelKindIn(panels, panelId, kind)),
    setPanelState: (panelId, panelState) => updatePanels((panels) => setPanelStateIn(panels, panelId, panelState)),
    openNote: (noteId, windowId = MAIN_WINDOW) => updatePanels((panels) => openNoteIn(panels, windowId, noteId, newPanelId)),
    openNoteBeside: (noteId, windowId = MAIN_WINDOW) =>
      updatePanels((panels) => openNoteBesideIn(panels, windowId, noteId, newPanelId)),
    movePanelToNewWindow: (panelId) => {
      const id = newWindowId();
      const before = state.panels;
      updatePanels((panels) => movePanelToNewWindowIn(panels, panelId, id, emptyPanel()));
      return state.panels === before ? null : id;
    },
    closeWindow: (windowId) => {
      flushSaves();
      updatePanels((panels) => closeWindowIn(panels, windowId));
    },
    movePanelToWindow: (panelId, windowId) => updatePanels((panels) => movePanelToWindowIn(panels, panelId, windowId, emptyPanel())),
    openLinkedNote: (noteId, fromPanelId, beside) => {
      if (!state.notes.some((n) => n.id === noteId)) return;
      flushSaves();
      updatePanels((panels) => openLinkedNoteIn(panels, fromPanelId, noteId, beside, newPanelId));
    },
    openAssistantFor: (panelId) => {
      const opened = openAssistantForIn(state.panels, panelId, newPanelId);
      if (!opened) return null;
      if (opened.panels !== state.panels) set({ panels: opened.panels });
      return opened.assistantId;
    },
    setAssistantFollow: (panelId, follow) => updatePanels((panels) => setAssistantFollowIn(panels, panelId, follow)),
    movePanel: (panelId, targetId, zone) => updatePanels((panels) => movePanelIn(panels, panelId, targetId, zone)),
    // The sizes are sent once the drag ends (`commitPanels`), not at every step of it.
    resizePanels: (path, sizes, windowId = MAIN_WINDOW) =>
      updatePanels((panels) => resizePanelsIn(panels, windowId, path, sizes), false),
    commitPanels: () => options.panels?.save?.(toDocument(state.panels)),
    dropNote: (noteId, panelId, zone) => updatePanels((panels) => dropNoteIn(panels, noteId, panelId, zone, newPanelId)),
    createNote,
    removeNote,
    moveNoteToGroup,
    placeNote,
    createGroup,
    renameGroup,
    moveGroup,
    placeGroup,
    deleteGroup,
    moveGroupToNotebook,
    createNotebook,
    renameNotebook,
    placeNotebook,
    deleteNotebook,
  };
}
