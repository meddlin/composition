"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HomeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Favorites } from "@/lib/composition/favorites";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, type Layout } from "@/lib/composition/layout";
import type { HomeSettings } from "@/lib/composition/home";
import { DEFAULT_WRITING_SETTINGS, type WritingSettings } from "@/lib/composition/writing";
import { AssistantProvider } from "./AssistantProvider";
import { WritingProvider } from "./WritingProvider";
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
import type { RevealRequest } from "./GroupTree";
import { NoteSidebar } from "./NoteSidebar";
import { NoteArea, useNoteSurface } from "./noteSurface";
import { ResizeHandle } from "./ResizeHandle";
import { SearchBar } from "./SearchBar";
import type { Group, Note, Notebook } from "./types";
import { useLayout } from "./useLayout";
import { useWorkspaceActions } from "./useWorkspaceActions";
import { createWorkspace } from "./workspaceInstance";
import type { WorkspaceStore } from "./workspaceStore";

// Which notebook was open last, so it is the one shown next time. A convenience only.
const NOTEBOOK_STORAGE_KEY = "composition.notebook";

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
  /**
   * A workspace kept from an earlier visit (the desktop app keeps one while the user is in Settings). It already
   * holds the data, so `initialNotes`, `initialGroups`, `initialNotebooks`, `initialFavorites` and `initialHome` are
   * ignored; without it, they make a new one that lasts as long as this screen does.
   */
  store?: WorkspaceStore;
};

export function NotesApp({ initialWriting = DEFAULT_WRITING_SETTINGS, store: kept, ...props }: Props) {
  const [made] = useState(() =>
    kept
      ? null
      : createWorkspace({
          notes: props.initialNotes,
          groups: props.initialGroups,
          notebooks: props.initialNotebooks,
          favorites: props.initialFavorites,
          home: props.initialHome,
        }),
  );
  const store = (kept ?? made)!;

  // A workspace made here goes with the screen, and takes any AI answer that is still streaming with it.
  useEffect(() => {
    if (!made) return;
    return () => made.assistant.abortAll();
  }, [made]);

  return (
    <AssistantProvider store={store.assistant}>
      <WritingProvider value={initialWriting}>
        <Workspace store={store} initialLayout={props.initialLayout} />
      </WritingProvider>
    </AssistantProvider>
  );
}

function Workspace({ store, initialLayout }: { store: WorkspaceStore; initialLayout: Layout }) {
  const {
    notes,
    groups,
    notebooks,
    favorites,
    home,
  } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const remembered = useSyncExternalStore(subscribeToNothing, rememberedNotebookId, () => null);
  // The notebook chosen this session; until then, the one the browser remembers.
  const [chosenNotebookId, setChosenNotebookId] = useState<number | null>(null);
  // The sidebar shows one notebook at a time; everything else (open panes, search) spans all of them.
  const wanted = chosenNotebookId ?? remembered;
  const notebookId = notebooks.find((n) => n.id === wanted)?.id ?? notebooks[0].id;
  const notebookNotes = notes.filter((n) => n.notebookId === notebookId);
  const notebookGroups = groups.filter((g) => g.notebookId === notebookId);

  // When set, the Home overview replaces the panes. It starts set for anyone who chose to open on it.
  const [homeOpen, setHomeOpen] = useState(home.startup === "home");

  function openNotebook(id: number) {
    setHomeOpen(false);
    setChosenNotebookId(id);
    // A group page belongs to the notebook that was open.
    setViewedGroupId(null);
    rememberNotebookId(id);
  }
  // When set, the group's listing page replaces the panes.
  const notebookPanel = useNotebookPanelPrefs();
  const notebookPanelStart = useRef(notebookPanel.width);
  const [viewedGroupId, setViewedGroupId] = useState<number | null>(null);
  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const layout = useLayout(initialLayout);
  // How the open notes are shown differs by app: a row of panes on the web, a grid of panels on the desktop.
  const surface = useNoteSurface(store);
  const focusedId = surface.focusedNoteId;
  const {
    actions,
    groupError,
    requestDelete,
    dialog: confirmDialog,
  } = useWorkspaceActions(store, {
    onSelectGroup: selectGroup,
    onCreated: () => {
      setViewedGroupId(null);
      setHomeOpen(false);
    },
  });

  // Leaving the screen must not drop the last few keystrokes: the pending saves go out now (mirrors the CLI's
  // flush-on-escape). The workspace itself may outlive this screen.
  useEffect(() => () => void store.flushSaves(), [store]);

  // A note in front of the user counts as opened, for the home page's "recently opened" order.
  useEffect(() => {
    if (focusedId !== null && !homeOpen && !viewedGroupId) recordOpened(focusedId);
  }, [focusedId, homeOpen, viewedGroupId]);

  const toggleFavorite = store.toggleFavorite;
  const toggleNotebookPinned = store.toggleNotebookPin;

  // A group deleted (or moved to another notebook) while its page is open falls back to the panes.
  const viewedGroup = notebookGroups.find((g) => g.id === viewedGroupId) ?? null;

  /** Shows the note's notebook, so a note picked from search is visible in the sidebar. */
  function followNote(id: number) {
    const notebook = notes.find((n) => n.id === id)?.notebookId;
    if (notebook !== undefined && notebook !== notebookId) openNotebook(notebook);
  }

  /** Opens a note picked from search and brings its sidebar row into view. */
  function selectNoteFromSearch(id: number) {
    selectNote(id);
    setReveal((prev) => ({ noteId: id, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  function selectNote(id: number) {
    setHomeOpen(false);
    store.flushSaves();
    followNote(id);
    surface.openNote(id);
    setViewedGroupId(null);
  }

  /** Opens the note in a new pane next to the focused one, rather than in it. */
  function openBeside(id: number) {
    setHomeOpen(false);
    store.flushSaves();
    followNote(id);
    surface.openNoteBeside(id);
    setViewedGroupId(null);
  }

  function selectGroup(id: number) {
    setHomeOpen(false);
    store.flushSaves();
    setViewedGroupId(id);
  }

  /** Opens a group's page, in whichever notebook the group belongs to. */
  function openGroup(id: number) {
    const target = groups.find((g) => g.id === id);
    if (!target) return;
    setHomeOpen(false);
    store.flushSaves();
    if (target.notebookId !== notebookId) {
      setChosenNotebookId(target.notebookId);
      rememberNotebookId(target.notebookId);
    }
    setViewedGroupId(id);
  }

  /**
   * Makes a separate new note from an answer of the AI helper, in the same group and notebook as the note it was asked about,
   * and opens it beside that note. Nothing is written into the note the answer was about.
   */
  function newNoteFromText(fromId: number, text: string) {
    void store.newNoteFromText(fromId, text, notebookId);
  }

  function createNotebook(name: string) {
    void store.createNotebook(name).then((notebook) => openNotebook(notebook.id));
  }

  function renameNotebook(id: number, name: string) {
    store.renameNotebook(id, name);
  }

  /** Puts the notebook just before another in the list (last when `beforeId` is null). */
  function placeNotebook(id: number, beforeId: number | null) {
    void store.placeNotebook(id, beforeId);
  }

  const emptyNotebookIds = new Set(notebooks.map((n) => n.id));
  for (const item of [...notes, ...groups]) emptyNotebookIds.delete(item.notebookId);

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
          <SearchBar onSelect={selectNoteFromSearch} />
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
          onDelete={(id) => requestDelete({ kind: "notebook", id })}
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
          reveal={reveal}
          onRevealed={() => setReveal(null)}
          width={layout.sidebarWidth}
          groupError={groupError}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          onSelect={selectNote}
          onOpenBeside={openBeside}
          onSelectGroup={selectGroup}
          onCreate={(groupId) => actions.onCreate(groupId, notebookId)}
          onDelete={actions.onDelete}
          onCreateGroup={(name, parentId) => actions.onCreateGroup(name, parentId, notebookId)}
          onRenameGroup={actions.onRenameGroup}
          onDeleteGroup={actions.onDeleteGroup}
          onMoveGroup={actions.onMoveGroup}
          onMoveNoteToGroup={actions.onMoveNoteToGroup}
          onPlaceNote={actions.onPlaceNote}
          onPlaceGroup={actions.onPlaceGroup}
          onMoveGroupToNotebook={actions.onMoveGroupToNotebook}
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
            onRenameGroup={actions.onRenameGroup}
          />
        ) : (
          <NoteArea
            store={store}
            surface={surface}
            layout={layout}
            onCreateNote={(groupId) => actions.onCreate(groupId ?? null, notebookId)}
            onNewNoteFromText={newNoteFromText}
            sidebar={actions}
          />
        )}
      </div>
      {surface.dialog}
      {confirmDialog}
    </div>
  );
}
