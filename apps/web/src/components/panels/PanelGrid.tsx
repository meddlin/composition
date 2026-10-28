"use client";

import { FolderTreeIcon, LayoutDashboardIcon, ListTodoIcon, LinkIcon, MessageSquareIcon, StickyNoteIcon } from "lucide-react";
import { Fragment, useRef, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { NotePane } from "../notes/NotePane";
import { ResizeHandle } from "../notes/ResizeHandle";
import type { WorkspaceSnapshot, WorkspaceStore } from "../notes/workspaceStore";
import { AiPanel } from "./AiPanel";
import { EmptyPanel } from "./EmptyPanel";
import type { PanelHost } from "./host";
import { KINDS, type AssistantPanelState, type NotePanelState, type NotesBrowserState, type TodoPanelState } from "./kinds";
import { NotesBrowserPanel } from "./NotesBrowserPanel";
import { dragSizes, minExtent, panelIds, type Direction, type LayoutNode, type PanelId, type SplitPath } from "./layoutTree";
import { TodoPanel } from "./TodoPanel";
import { PanelFrame } from "./PanelFrame";
import { PluginOffPanel } from "./PluginOffPanel";
import { usePlugins } from "../plugins/usePlugins";
import { PanelMenu } from "./PanelMenu";
import { MAIN_WINDOW, focusedPanelId, type KindId, type PanelsState, type WindowId } from "./panelsState";

export type { PanelHost } from "./host";

type Props = {
  store: WorkspaceStore;
  host: PanelHost;
  windowId?: WindowId;
};

/** The least height, in px, a panel can be dragged down to: its header and a few lines. */
const MIN_PANEL_HEIGHT = 120;

const KIND_LABEL: Record<KindId, string> = { empty: "Empty panel", note: "Note", "notes-browser": "Notes browser", ai: "AI helper", todo: "To-do" };
const KIND_ICON: Record<KindId, typeof StickyNoteIcon> = {
  empty: LayoutDashboardIcon,
  note: StickyNoteIcon,
  "notes-browser": FolderTreeIcon,
  ai: MessageSquareIcon,
  todo: ListTodoIcon,
};

type Shared = {
  store: WorkspaceStore;
  host: PanelHost;
  snapshot: WorkspaceSnapshot;
  panels: PanelsState;
  windowId: WindowId;
  /** Every window, the main one first. */
  windows: string[];
  focusedId: PanelId;
  /** Whether the window's only panel has anything to close (the main window's does not while it is empty). */
  canCloseLast: boolean;
  /** Whether the window has one panel. */
  alone: boolean;
};

/** One window's panels, in the arrangement the store holds: nested rows and columns with a divider between. */
export function PanelGrid({ store, host, windowId = MAIN_WINDOW }: Props) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const { panels } = snapshot;
  const window = panels.windows[windowId];
  // A pop-out whose last panel went has nothing left to show; its real window is closed in a moment.
  if (!window) return null;
  const focusedId = focusedPanelId(window);
  const [only, ...more] = panelIds(window.layout);
  // The main window's only panel has nothing to close once it is empty; a pop-out's closes the pop-out.
  const canCloseLast = windowId !== MAIN_WINDOW || more.length > 0 || panels.byId[only].kind !== "empty";
  const shared: Shared = {
    store,
    host,
    snapshot,
    panels,
    windowId,
    windows: Object.keys(panels.windows),
    focusedId,
    canCloseLast,
    alone: more.length === 0,
  };

  return (
    // Panels never shrink below a usable size; past that the window scrolls.
    <div className="flex min-h-0 min-w-0 flex-1 overflow-auto">
      <NodeView node={window.layout} path={[]} shared={shared} />
    </div>
  );
}

function NodeView({ node, path, shared }: { node: LayoutNode; path: SplitPath; shared: Shared }) {
  return node.type === "panel" ? <PanelView panelId={node.id} shared={shared} /> : <SplitView node={node} path={path} shared={shared} />;
}

function PanelView({ panelId, shared }: { panelId: PanelId; shared: Shared }) {
  const { store, panels, focusedId, canCloseLast } = shared;
  const record = panels.byId[panelId];
  const { enabled } = usePlugins(store.plugins);
  if (record.kind === "note") {
    const state = record.state as NotePanelState;
    if (state.noteId !== null) return <NoteView panelId={panelId} state={state} shared={shared} />;
  }

  const Icon = KIND_ICON[record.kind];
  const plugin = KINDS[record.kind].plugin;
  const off = plugin !== undefined && !enabled[plugin];
  return (
    <PanelFrame
      store={store}
      panelId={panelId}
      label={KIND_LABEL[record.kind]}
      focused={panelId === focusedId}
      canClose={canCloseLast}
      windowId={shared.windowId}
      windows={shared.windows}
      alone={shared.alone}
      onDropNote={(noteId, zone) => shared.host.onDropNote(noteId, panelId, zone)}
      icon={<Icon className="size-4 shrink-0" />}
      title={KIND_LABEL[record.kind].replace(" panel", "")}
      extras={record.kind === "ai" && <FollowToggle store={store} panelId={panelId} following={(record.state as AssistantPanelState).follow} />}
    >
      {off && plugin && <PluginOffPanel store={store} plugin={plugin} />}
      {!off && record.kind === "empty" && <EmptyPanel store={store} panelId={panelId} />}
      {!off && record.kind === "note" && <AwaitingNote onCreateNote={shared.host.onCreateNote} />}
      {!off && record.kind === "ai" && <AiPanel store={store} panelId={panelId} snapshot={shared.snapshot} host={shared.host} />}
      {!off && record.kind === "todo" && <TodoPanel store={store} panelId={panelId} state={record.state as TodoPanelState} />}
      {!off && record.kind === "notes-browser" && (
        <NotesBrowserPanel
          store={store}
          panelId={panelId}
          state={record.state as NotesBrowserState}
          snapshot={shared.snapshot}
          host={shared.host}
        />
      )}
    </PanelFrame>
  );
}

/** Switches an AI panel between following the note the user is working in and staying with the note it is about. */
function FollowToggle({ store, panelId, following }: { store: WorkspaceStore; panelId: PanelId; following: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Follow the note in use"
      aria-pressed={following}
      title={following ? "Following the note in use. Click to stay with this note." : "Staying with this note. Click to follow the note in use."}
      onClick={() => store.setAssistantFollow(panelId, !following)}
      className={following ? "text-foreground" : "text-muted-foreground hover:text-foreground"}
    >
      <LinkIcon />
    </Button>
  );
}

/** A note panel that has no note yet: it takes the next one picked in the sidebar or dropped on it. */
function AwaitingNote({ onCreateNote }: { onCreateNote: () => void }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyDescription>Pick a note in the sidebar, or drag one here.</EmptyDescription>
      </EmptyHeader>
      <Button size="sm" onClick={onCreateNote}>
        + New note
      </Button>
    </Empty>
  );
}

function NoteView({ panelId, state, shared }: { panelId: PanelId; state: NotePanelState; shared: Shared }) {
  const { store, host, snapshot, focusedId } = shared;
  const live = snapshot.notes.find((n) => n.id === state.noteId);
  // A note that was deleted while it is shown is kept, as it last was, by the workspace.
  const note = live ?? snapshot.deleted.find((n) => n.id === state.noteId);
  if (!note) return null;

  return (
    <NotePane
      note={note}
      focused={panelId === focusedId}
      view={state.view}
      // Fills the room its place in the grid gives it, which a pane in the web app's row is told by `PaneArea`.
      style={{ flex: "1 1 0%" }}
      ratio={host.ratio}
      onRatioChange={host.onRatioChange}
      onRatioCommit={host.onRatioCommit}
      onViewChange={(view) => store.setPanelState(panelId, { ...state, view })}
      onFocus={() => store.focusPanel(panelId)}
      onClose={() => store.closePanel(panelId)}
      onChange={(content) => store.editNote(note.id, content)}
      onDropNote={() => {}}
      notes={snapshot.notes}
      onOpenNote={(noteId, beside) => store.openLinkedNote(noteId, panelId, beside)}
      onNewNoteFromText={(text) => host.onNewNoteFromText(note.id, text)}
      panel={{
        panelId,
        deleted: live === undefined,
        actions: <PanelMenu store={store} panelId={panelId} canClose windowId={shared.windowId} windows={shared.windows} alone={shared.alone} />,
        onDropNote: (noteId, zone) => host.onDropNote(noteId, panelId, zone),
        onDropPanel: (movedId, zone) => store.movePanel(movedId, panelId, zone),
        onOpenAssistant: () => {
          const assistantId = store.openAssistantFor(panelId);
          // The question box takes the cursor, so the user can type at once.
          if (assistantId) {
            requestAnimationFrame(() =>
              document.querySelector<HTMLElement>(`[data-panel-id="${assistantId}"] [aria-label="Ask about this note"]`)?.focus(),
            );
          }
        },
      }}
    />
  );
}

function SplitView({ node, path, shared }: { node: Extract<LayoutNode, { type: "split" }>; path: SplitPath; shared: Shared }) {
  const container = useRef<HTMLDivElement>(null);
  const dragStart = useRef({ sizes: [] as number[], extent: 0, mins: [] as number[] });
  const row = node.direction === "row";
  const axis: Direction = node.direction;
  const leafMin = (id: PanelId, along: Direction) =>
    along === "row" ? KINDS[shared.panels.byId[id].kind].minWidth : MIN_PANEL_HEIGHT;
  const mins = node.children.map((child) => minExtent(child.node, axis, leafMin));

  return (
    <div ref={container} className={cn("flex min-h-0 min-w-0 flex-1", row ? "flex-row" : "flex-col")}>
      {node.children.map((child, index) => {
        const before = node.children[index - 1];
        return (
          <Fragment key={child.node.type === "panel" ? child.node.id : `split-${panelIds(child.node)[0]}`}>
            {before && (
              <ResizeHandle
                label={`Resize panels ${index} and ${index + 1}`}
                orientation={row ? "vertical" : "horizontal"}
                // The first panel's share of the two panels this divider sits between.
                valueNow={Math.round((100 * before.size) / (before.size + child.size))}
                valueMin={0}
                valueMax={100}
                onResizeStart={() => {
                  const rect = container.current?.getBoundingClientRect();
                  dragStart.current = {
                    sizes: node.children.map((c) => c.size),
                    extent: (row ? rect?.width : rect?.height) ?? 0,
                    mins,
                  };
                }}
                onResize={(delta) => {
                  const { sizes, extent, mins: minsPx } = dragStart.current;
                  shared.store.resizePanels(path, dragSizes(sizes, index - 1, delta, extent, minsPx));
                }}
                onResizeEnd={() => shared.store.commitPanels()}
              />
            )}
            <div
              style={{ flex: `${child.size} 1 0%`, [row ? "minWidth" : "minHeight"]: mins[index] }}
              className="flex min-h-0 min-w-0"
            >
              <NodeView node={child.node} path={[...path, index]} shared={shared} />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
