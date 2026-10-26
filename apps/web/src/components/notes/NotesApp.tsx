"use client";

import { startTransition, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { HomeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import {
  createGroup as createGroupAction,
  createNote,
  createNotebook as createNotebookAction,
  deleteGroup as deleteGroupAction,
  deleteNote,
  deleteNotebook as deleteNotebookAction,
  moveGroup as moveGroupAction,
  moveGroupToNotebook as moveGroupToNotebookAction,
  moveNoteToGroup as moveNoteToGroupAction,
  placeGroup as placeGroupAction,
  placeNotebook as placeNotebookAction,
  placeNote as placeNoteAction,
  renameGroup as renameGroupAction,
  renameNotebook as renameNotebookAction,
  saveFavorites,
  saveHomeSettings,
  saveNoteContent,
} from "@/lib/composition/client";
import {
  NO_FAVORITES,
  removeFavorite,
  toggleFavorite as toggleFavoriteIn,
  type Favorites,
  type FavoriteType,
} from "@/lib/composition/favorites";
import { canMoveGroup, canPlaceGroup } from "@/lib/composition/groupMove";
import { applyOrder, placeBefore } from "@/lib/composition/ordering";
import { TRASH_RETENTION_DAYS } from "@/lib/composition/trash";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, type Layout } from "@/lib/composition/layout";
import { DEFAULT_HOME_SETTINGS, toggleNotebookPin, type HomeSettings } from "@/lib/composition/home";
import { DEFAULT_WRITING_SETTINGS, type WritingSettings } from "@/lib/composition/writing";
import { AssistantProvider, useAssistant } from "./AssistantProvider";
import { WritingProvider } from "./WritingProvider";
import { createNoteFromAnswer } from "./createNoteFromAnswer";
import { DropOverlay } from "./DropOverlay";
import { GroupPage } from "./GroupPage";
import { HomePage } from "./HomePage";
import { recordOpened } from "./openedNotes";
import { NotebookPanel } from "./NotebookPanel";
import {
  MAX_NOTEBOOK_PANEL_WIDTH,
  MIN_NOTEBOOK_PANEL_WIDTH,
  clampNotebookPanelWidth,
  setNotebookPanelPrefs,
  useNotebookPanelPrefs,
} from "./notebookPanelPrefs";
import { NoteSidebar } from "./NoteSidebar";
import { PaneArea } from "./PaneArea";
import {
  closePane,
  dropNote,
  focusPane,
  initialPanes,
  openNote,
  openNoteBeside,
  setPaneView,
  withSizes,
  type DropZone,
} from "./panes";
import { ResizeHandle } from "./ResizeHandle";
import { SearchBar } from "./SearchBar";
import { applySavedNote, noteTitle, type Group, type Note, type Notebook } from "./types";
import { useLayout } from "./useLayout";
import { useNoteDrop } from "./useNoteDrop";

const AUTOSAVE_DELAY_MS = 500;

// Which notebook was open last, so it is the one shown next time. A convenience only.
const NOTEBOOK_STORAGE_KEY = "composition.notebook";

// For a workspace given no notebooks (nothing in the database yet to ask for one).
const NO_NOTEBOOKS: Notebook[] = [{ id: 1, name: "Notebook", createdAt: "", updatedAt: "" }];

// Read through useSyncExternalStore: the server render can't know what the browser
// remembers, and this lets the first client render agree with it before switching over.
function subscribeToNothing(): () => void {
  return () => {};
}

function rememberedNotebookId(): number | null {
  try {
    const stored = Number(window.localStorage.getItem(NOTEBOOK_STORAGE_KEY));
    return Number.isSafeInteger(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

function rememberNotebookId(id: number): void {
  try {
    window.localStorage.setItem(NOTEBOOK_STORAGE_KEY, String(id));
  } catch {
    // Not remembered; the first notebook opens next time.
  }
}

type Props = {
  initialNotes: Note[];
  initialGroups: Group[];
  initialNotebooks?: Notebook[];
  initialLayout: Layout;
  initialFavorites?: Favorites;
  /** The editor's ruler and reflow; the defaults (both off) when not given. */
  initialWriting?: WritingSettings;
  /** How the home page is laid out; the side rail when not given. */
  initialHome?: HomeSettings;
};

export function NotesApp({ initialWriting = DEFAULT_WRITING_SETTINGS, ...props }: Props) {
  return (
    <AssistantProvider>
      <WritingProvider value={initialWriting}>
        <Workspace {...props} />
      </WritingProvider>
    </AssistantProvider>
  );
}

function Workspace({
  initialNotes,
  initialGroups,
  initialNotebooks = NO_NOTEBOOKS,
  initialLayout,
  initialFavorites = NO_FAVORITES,
  initialHome = DEFAULT_HOME_SETTINGS,
}: Props) {
  const assistant = useAssistant();
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [groups, setGroups] = useState<Group[]>(initialGroups);
  const [notebooks, setNotebooks] = useState<Notebook[]>(initialNotebooks);
  const remembered = useSyncExternalStore(subscribeToNothing, rememberedNotebookId, () => null);
  // The notebook chosen this session; until then, the one the browser remembers.
  const [chosenNotebookId, setChosenNotebookId] = useState<number | null>(null);
  // The sidebar shows one notebook at a time; everything else (open panes, search) spans all of them.
  const wanted = chosenNotebookId ?? remembered;
  const notebookId = notebooks.find((n) => n.id === wanted)?.id ?? notebooks[0].id;
  const notebookNotes = notes.filter((n) => n.notebookId === notebookId);
  const notebookGroups = groups.filter((g) => g.notebookId === notebookId);

  // When set, the Home overview replaces the panes. It starts set for anyone who chose to open on it.
  const [homeOpen, setHomeOpen] = useState(initialHome.startup === "home");

  function openNotebook(id: number) {
    setHomeOpen(false);
    setChosenNotebookId(id);
    // A group page belongs to the notebook that was open.
    setViewedGroupId(null);
    rememberNotebookId(id);
  }
  // The open notes, side by side; the focused one is where sidebar picks and new notes open.
  const [paneState, setPaneState] = useState(() => initialPanes(initialNotes[0]?.id ?? null));
  const [groupError, setGroupError] = useState<string | null>(null);
  // Nothing is deleted until the user confirms in the dialog this drives.
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "note" | "group" | "notebook"; id: number } | null
  >(null);
  // When set, the group's listing page replaces the panes.
  const notebookPanel = useNotebookPanelPrefs();
  const notebookPanelStart = useRef(notebookPanel.width);
  const [viewedGroupId, setViewedGroupId] = useState<number | null>(null);
  const layout = useLayout(initialLayout);
  const [home, setHome] = useState<HomeSettings>(initialHome);
  // Mirrors `home` so two quick pins never build on a stale list.
  const latestHome = useRef(home);
  const [favorites, setFavorites] = useState<Favorites>(initialFavorites);
  // Mirrors `favorites` so two quick toggles never build on a stale list.
  const latestFavorites = useRef(favorites);

  // Each open note debounces its own save: edits in two panes must not cancel each other's.
  const pendingSaves = useRef(
    new Map<number, { content: string; timer: ReturnType<typeof setTimeout> }>(),
  );

  /** Saves the note's pending edit now, or every note's when none is given. */
  function flushPendingSave(noteId?: number) {
    const ids = noteId === undefined ? [...pendingSaves.current.keys()] : [noteId];
    for (const id of ids) {
      const pending = pendingSaves.current.get(id);
      if (!pending) continue;
      clearTimeout(pending.timer);
      pendingSaves.current.delete(id);
      startTransition(async () => {
        const saved = await saveNoteContent(id, pending.content);
        setNotes((prev) => applySavedNote(prev, saved));
      });
    }
  }

  // Flush any pending debounced save on unmount so navigating away never
  // silently drops the last few keystrokes (mirrors the CLI's flush-on-escape).
  useEffect(() => () => flushPendingSave(), []);

  const { panes, focusedId } = paneState;

  // A note in front of the user counts as opened, for the home page's "recently opened" order.
  useEffect(() => {
    if (focusedId !== null && !homeOpen && !viewedGroupId) recordOpened(focusedId);
  }, [focusedId, homeOpen, viewedGroupId]);

  function updateFavorites(next: Favorites) {
    latestFavorites.current = next;
    setFavorites(next);
    startTransition(async () => {
      await saveFavorites(next);
    });
  }

  function updateHome(next: HomeSettings) {
    latestHome.current = next;
    setHome(next);
    startTransition(async () => {
      await saveHomeSettings(next);
    });
  }

  function toggleNotebookPinned(id: number) {
    updateHome(toggleNotebookPin(latestHome.current, id));
  }

  function toggleFavorite(type: FavoriteType, id: number) {
    updateFavorites(toggleFavoriteIn(latestFavorites.current, type, id));
  }

  // Deleting something pinned unpins it, so the stored list doesn't collect dead entries.
  function forgetFavorite(type: FavoriteType, id: number) {
    const next = removeFavorite(latestFavorites.current, type, id);
    if (next.length !== latestFavorites.current.length) updateFavorites(next);
  }

  // A group deleted (or moved to another notebook) while its page is open falls back to the panes.
  const viewedGroup = notebookGroups.find((g) => g.id === viewedGroupId) ?? null;

  /** Shows the note's notebook, so a note picked from search is visible in the sidebar. */
  function followNote(id: number) {
    const notebook = notes.find((n) => n.id === id)?.notebookId;
    if (notebook !== undefined && notebook !== notebookId) openNotebook(notebook);
  }

  function selectNote(id: number) {
    setHomeOpen(false);
    flushPendingSave();
    followNote(id);
    setPaneState((prev) => openNote(prev, id));
    setViewedGroupId(null);
  }

  /** Opens the note in a new pane next to the focused one, rather than in it. */
  function openBeside(id: number) {
    setHomeOpen(false);
    flushPendingSave();
    followNote(id);
    setPaneState((prev) => openNoteBeside(prev, id));
    setViewedGroupId(null);
  }

  function selectGroup(id: number) {
    setHomeOpen(false);
    flushPendingSave();
    setViewedGroupId(id);
  }

  /** Opens a group's page, in whichever notebook the group belongs to. */
  function openGroup(id: number) {
    const target = groups.find((g) => g.id === id);
    if (!target) return;
    setHomeOpen(false);
    flushPendingSave();
    if (target.notebookId !== notebookId) {
      setChosenNotebookId(target.notebookId);
      rememberNotebookId(target.notebookId);
    }
    setViewedGroupId(id);
  }

  function create(groupId: number | null = null) {
    flushPendingSave();
    startTransition(async () => {
      const note = await createNote("Untitled", groupId, notebookId);
      setNotes((prev) => [note, ...prev]);
      setPaneState((prev) => openNote(prev, note.id));
      setViewedGroupId(null);
      setHomeOpen(false);
    });
  }

  /**
   * Makes a separate new note from an answer of the AI helper, in the same group and notebook as the note it was asked about,
   * and opens it beside that note. Nothing is written into the note the answer was about.
   */
  function newNoteFromText(fromId: number, text: string) {
    flushPendingSave();
    const from = notes.find((n) => n.id === fromId);
    startTransition(async () => {
      const note = await createNoteFromAnswer(text, from?.groupId ?? null, from?.notebookId ?? notebookId, { createNote, saveNoteContent });
      setNotes((prev) => [note, ...prev]);
      setPaneState((prev) => dropNote(prev, note.id, fromId, "right"));
    });
  }

  /** Moves the note to the Trash Can. Call only once the user has confirmed. */
  function remove(id: number) {
    // Nothing left to save for a note that is going away.
    const pending = pendingSaves.current.get(id);
    if (pending) clearTimeout(pending.timer);
    pendingSaves.current.delete(id);

    setNotes((prev) => prev.filter((n) => n.id !== id));
    setPaneState((prev) => closePane(prev, id));
    forgetFavorite("note", id);
    assistant.forgetNote(id);
    startTransition(async () => {
      await deleteNote(id);
    });
  }

  function update(noteId: number, content: string) {
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, content } : n)));

    const pending = pendingSaves.current.get(noteId);
    if (pending) clearTimeout(pending.timer);
    pendingSaves.current.set(noteId, {
      content,
      timer: setTimeout(() => flushPendingSave(noteId), AUTOSAVE_DELAY_MS),
    });
  }

  /** Follows a link in `fromId`'s preview: the note replaces that pane's, or opens to its right. */
  function openLinkedNote(noteId: number, fromId: number, beside: boolean) {
    if (!notes.some((n) => n.id === noteId)) return;
    flushPendingSave();
    setPaneState((prev) =>
      beside ? dropNote(prev, noteId, fromId, "right") : openNote(focusPane(prev, fromId), noteId),
    );
  }

  function dropNoteOnPane(noteId: number, targetId: number, zone: DropZone) {
    setPaneState((prev) => dropNote(prev, noteId, targetId, zone));
  }

  function createGroup(name: string, parentId: number | null) {
    startTransition(async () => {
      const group = await createGroupAction(name, parentId, notebookId);
      setGroups((prev) => [...prev, group]);
    });
  }

  function createNotebook(name: string) {
    startTransition(async () => {
      const notebook = await createNotebookAction(name);
      setNotebooks((prev) => [...prev, notebook]);
      openNotebook(notebook.id);
    });
  }

  function renameNotebook(id: number, name: string) {
    setNotebooks((prev) => prev.map((n) => (n.id === id ? { ...n, name } : n)));
    startTransition(async () => {
      const notebook = await renameNotebookAction(id, name);
      setNotebooks((prev) => prev.map((n) => (n.id === notebook.id ? notebook : n)));
    });
  }

  /** Puts the notebook just before another in the list (last when `beforeId` is null). */
  function placeNotebook(id: number, beforeId: number | null) {
    const ids = notebooks.map((n) => n.id);
    const ordered = placeBefore(ids, id, beforeId);
    if (ordered.every((orderedId, index) => orderedId === ids[index])) return;
    const previous = notebooks;
    setNotebooks(applyOrder(notebooks, ordered));
    startTransition(async () => {
      try {
        setNotebooks(await placeNotebookAction(id, beforeId));
      } catch {
        setNotebooks(previous);
      }
    });
  }

  /** Deletes the (empty) notebook for good. Call only once the user has confirmed. */
  function deleteNotebook(id: number) {
    setGroupError(null);
    startTransition(async () => {
      const result = await deleteNotebookAction(id);
      if (result.error) {
        setGroupError(result.error);
        return;
      }
      setNotebooks((prev) => prev.filter((n) => n.id !== id));
      // A deleted notebook is unpinned, so the saved list doesn't collect dead entries.
      if (latestHome.current.pinnedNotebooks.includes(id)) updateHome(toggleNotebookPin(latestHome.current, id));
    });
  }

  /** Moves the group, its sub-groups and their notes to the top level of another notebook. */
  function moveGroupToNotebook(id: number, targetNotebookId: number) {
    setGroupError(null);
    const previous = { groups, notes };
    const moved = new Set([id]);
    for (let changed = true; changed; ) {
      changed = false;
      for (const g of groups) {
        if (g.parentId !== null && moved.has(g.parentId) && !moved.has(g.id)) {
          moved.add(g.id);
          changed = true;
        }
      }
    }
    setGroups((prev) =>
      prev.map((g) =>
        moved.has(g.id)
          ? { ...g, notebookId: targetNotebookId, parentId: g.id === id ? null : g.parentId }
          : g,
      ),
    );
    setNotes((prev) =>
      prev.map((n) =>
        n.groupId !== null && moved.has(n.groupId) ? { ...n, notebookId: targetNotebookId } : n,
      ),
    );
    startTransition(async () => {
      const result = await moveGroupToNotebookAction(id, targetNotebookId);
      if (result.group) {
        const saved = result.group;
        setGroups((prev) => prev.map((g) => (g.id === saved.id ? saved : g)));
        return;
      }
      setGroups(previous.groups);
      setNotes(previous.notes);
      if (result.error) setGroupError(result.error);
    });
  }

  function renameGroup(id: number, name: string) {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
    startTransition(async () => {
      const group = await renameGroupAction(id, name);
      setGroups((prev) => prev.map((g) => (g.id === group.id ? group : g)));
    });
  }

  /** Moves the group to the Trash Can. Call only once the user has confirmed. */
  function deleteGroup(id: number) {
    setGroupError(null);
    startTransition(async () => {
      const result = await deleteGroupAction(id);
      if (result.error) {
        setGroupError(result.error);
        return;
      }
      setGroups((prev) => prev.filter((g) => g.id !== id));
      forgetFavorite("group", id);
    });
  }

  function moveGroup(id: number, parentId: number | null) {
    if (!canMoveGroup(groups, id, parentId)) return;
    setGroupError(null);
    const previousParentId = groups.find((g) => g.id === id)?.parentId ?? null;
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, parentId } : g)));
    startTransition(async () => {
      const result = await moveGroupAction(id, parentId);
      if (result.group) {
        const saved = result.group;
        setGroups((prev) => prev.map((g) => (g.id === saved.id ? saved : g)));
        return;
      }
      setGroups((prev) =>
        prev.map((g) => (g.id === id ? { ...g, parentId: previousParentId } : g)),
      );
      if (result.error) setGroupError(result.error);
    });
  }

  function moveNoteToGroup(noteId: number, groupId: number | null) {
    setNotes((prev) => prev.map((n) => (n.id === noteId ? { ...n, groupId } : n)));
    startTransition(async () => {
      const note = await moveNoteToGroupAction(noteId, groupId);
      setNotes((prev) => prev.map((n) => (n.id === note.id ? note : n)));
    });
  }

  /** Files the note in the group just before a sibling note (last when `beforeNoteId` is null). */
  function placeNote(noteId: number, groupId: number | null, beforeNoteId: number | null) {
    const siblings = notebookNotes.filter((n) => n.groupId === groupId).map((n) => n.id);
    const ordered = placeBefore(siblings, noteId, beforeNoteId);
    const unchanged =
      notes.find((n) => n.id === noteId)?.groupId === groupId &&
      ordered.every((id, index) => id === siblings[index]);
    if (unchanged) return;
    setNotes((prev) =>
      applyOrder(
        prev.map((n) => (n.id === noteId ? { ...n, groupId } : n)),
        ordered,
      ),
    );
    startTransition(async () => {
      const note = await placeNoteAction(noteId, groupId, beforeNoteId);
      setNotes((prev) => applySavedNote(prev, note));
    });
  }

  /** Files the group under the parent just before a sibling group (last when `beforeGroupId` is null). */
  function placeGroup(id: number, parentId: number | null, beforeGroupId: number | null) {
    if (!canPlaceGroup(groups, id, parentId)) return;
    const siblings = notebookGroups.filter((g) => g.parentId === parentId).map((g) => g.id);
    const ordered = placeBefore(siblings, id, beforeGroupId);
    const previous = groups;
    const unchanged =
      groups.find((g) => g.id === id)?.parentId === parentId &&
      ordered.every((siblingId, index) => siblingId === siblings[index]);
    if (unchanged) return;
    setGroupError(null);
    setGroups(applyOrder(groups.map((g) => (g.id === id ? { ...g, parentId } : g)), ordered));
    startTransition(async () => {
      const result = await placeGroupAction(id, parentId, beforeGroupId);
      if (result.group) {
        const saved = result.group;
        setGroups((prev) => prev.map((g) => (g.id === saved.id ? saved : g)));
        return;
      }
      setGroups(previous);
      if (result.error) setGroupError(result.error);
    });
  }

  const emptyNotebookIds = new Set(notebooks.map((n) => n.id));
  for (const item of [...notes, ...groups]) emptyNotebookIds.delete(item.notebookId);

  const pendingNote = pendingDelete?.kind === "note" ? notes.find((n) => n.id === pendingDelete.id) : undefined;
  const pendingGroup = pendingDelete?.kind === "group" ? groups.find((g) => g.id === pendingDelete.id) : undefined;
  const pendingNotebook =
    pendingDelete?.kind === "notebook" ? notebooks.find((n) => n.id === pendingDelete.id) : undefined;
  const pendingName = pendingNote ? noteTitle(pendingNote) : (pendingGroup?.name ?? pendingNotebook?.name);

  function confirmDelete() {
    if (pendingNote) remove(pendingNote.id);
    else if (pendingGroup) deleteGroup(pendingGroup.id);
    else if (pendingNotebook) deleteNotebook(pendingNotebook.id);
    setPendingDelete(null);
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b p-2">
        <Button
          variant={homeOpen ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setHomeOpen(true)}
          aria-label="Home page"
          aria-pressed={homeOpen}
          title="Home page"
        >
          <HomeIcon /> Home
        </Button>
        <div className="min-w-0 flex-1">
          <SearchBar onSelect={selectNote} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <NotebookPanel
          collapsed={notebookPanel.collapsed}
          width={notebookPanel.width}
          onToggleCollapsed={() => setNotebookPanelPrefs({ collapsed: !notebookPanel.collapsed })}
          notebooks={notebooks}
          activeId={notebookId}
          emptyIds={emptyNotebookIds}
          onSelect={openNotebook}
          onPlace={placeNotebook}
          onCreate={createNotebook}
          onRename={renameNotebook}
          onDelete={(id) => setPendingDelete({ kind: "notebook", id })}
        />
        {!notebookPanel.collapsed ? (
          <ResizeHandle
            label="Resize notebooks"
            valueNow={notebookPanel.width}
            valueMin={MIN_NOTEBOOK_PANEL_WIDTH}
            valueMax={MAX_NOTEBOOK_PANEL_WIDTH}
            onResizeStart={() => {
              notebookPanelStart.current = notebookPanel.width;
            }}
            onResize={(dxPx) =>
              setNotebookPanelPrefs({ width: clampNotebookPanelWidth(notebookPanelStart.current + dxPx) })
            }
            onResizeEnd={() => {}}
          />
        ) : (
          <div aria-hidden className="w-px shrink-0 bg-border" />
        )}
        <NoteSidebar
          notes={notebookNotes}
          groups={notebookGroups}
          notebooks={notebooks}
          notebookId={notebookId}
          collapsedNotebookName={
            notebookPanel.collapsed ? notebooks.find((n) => n.id === notebookId)?.name : undefined
          }
          onExpandNotebooks={() => setNotebookPanelPrefs({ collapsed: false })}
          activeId={viewedGroup ? null : focusedId}
          viewedGroupId={viewedGroup?.id ?? null}
          width={layout.sidebarWidth}
          groupError={groupError}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onSelect={selectNote}
          onOpenBeside={openBeside}
          onSelectGroup={selectGroup}
          onCreate={create}
          onDelete={(id) => setPendingDelete({ kind: "note", id })}
          onCreateGroup={createGroup}
          onRenameGroup={renameGroup}
          onDeleteGroup={(id) => setPendingDelete({ kind: "group", id })}
          onMoveGroup={moveGroup}
          onMoveNoteToGroup={moveNoteToGroup}
          onPlaceNote={placeNote}
          onPlaceGroup={placeGroup}
          onMoveGroupToNotebook={moveGroupToNotebook}
        />
        <ResizeHandle
          label="Resize sidebar"
          valueNow={layout.sidebarWidth}
          valueMin={MIN_SIDEBAR_WIDTH}
          valueMax={MAX_SIDEBAR_WIDTH}
          {...layout.sidebarResize}
        />
        {homeOpen ? (
          <HomePage
            notebooks={notebooks}
            notes={notes}
            groups={groups}
            favorites={favorites}
            settings={home}
            onToggleFavorite={toggleFavorite}
            onToggleNotebookPin={toggleNotebookPinned}
            onSelectNotebook={openNotebook}
            onSelectGroup={openGroup}
            onSelectNote={selectNote}
          />
        ) : viewedGroup ? (
          <GroupPage
            groupId={viewedGroup.id}
            groups={groups}
            notes={notes}
            onSelectNote={selectNote}
            onSelectGroup={selectGroup}
            onRenameGroup={renameGroup}
          />
        ) : panes.length > 0 ? (
          <PaneArea
            panes={panes}
            notes={notes}
            focusedId={focusedId}
            ratio={layout.editorRatio}
            onRatioChange={layout.setEditorRatio}
            onRatioCommit={layout.commit}
            onFocus={(id) => setPaneState((prev) => focusPane(prev, id))}
            onViewChange={(id, view) => setPaneState((prev) => setPaneView(prev, id, view))}
            onClose={(id) => setPaneState((prev) => closePane(prev, id))}
            onChange={update}
            onDropNote={dropNoteOnPane}
            onOpenNote={openLinkedNote}
            onNewNoteFromText={newNoteFromText}
            onResizePanes={(sizes) => setPaneState((prev) => withSizes(prev, sizes))}
          />
        ) : (
          <EmptyState hasNotes={notes.length > 0} onCreate={create} onOpenNote={selectNote} />
        )}
      </div>
      <ConfirmDialog
        // Closes by itself if the item disappears (deleted elsewhere) while it is asking.
        open={pendingName !== undefined}
        title={`Delete ${pendingGroup ? "group " : pendingNotebook ? "notebook " : ""}“${pendingName ?? ""}”?`}
        description={
          pendingNotebook
            ? "The notebook is empty. It is deleted for good; it doesn't go to the Trash Can."
            : `It moves to the Trash Can in Settings, where you can restore it. Items in the Trash Can are permanently deleted after ${TRASH_RETENTION_DAYS} days.`
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
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
