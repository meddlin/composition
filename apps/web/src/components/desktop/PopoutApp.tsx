"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AssistantProvider } from "@/components/notes/AssistantProvider";
import { useNoteSurface } from "@/components/notes/noteSurface.desktop";
import { useWorkspaceActions } from "@/components/notes/useWorkspaceActions";
import { WritingProvider } from "@/components/notes/WritingProvider";
import type { PanelHost } from "@/components/panels/host";
import { PanelGrid } from "@/components/panels/PanelGrid";
import { focusedPanelId, type WindowId } from "@/components/panels/panelsState";
import { panelTitle } from "@/components/panels/panelTitle";
import { clampEditorRatio, DEFAULT_EDITOR_RATIO } from "@/lib/composition/layout";
import { sharedWorkspaceFromOpener, type SharedWorkspace } from "./popoutLink";

type Link = { shared: SharedWorkspace; windowId: WindowId };

/** Nothing to show: the page was not opened by the main window, or for a window that is not in its workspace. */
const NO_LINK = "none" as const;

let lastLink: Link | typeof NO_LINK | null = null;

/** What this page was opened for. The same object each time while it is the same, as `useSyncExternalStore` needs. */
function readLink(): Link | typeof NO_LINK {
  const shared = sharedWorkspaceFromOpener();
  const windowId = new URLSearchParams(window.location.search).get("w");
  if (!shared || !windowId || !shared.store.getSnapshot().panels.windows[windowId]) return NO_LINK;
  if (lastLink !== null && lastLink !== NO_LINK && lastLink.shared === shared && lastLink.windowId === windowId) return lastLink;
  return (lastLink = { shared, windowId });
}

const subscribeToNothing = () => () => {};

/**
 * A pop-out's page: one window's panels, from the workspace the main window holds. It is a page of its own, with its
 * own copies of the libraries, so menus, focus, the clipboard and the rest work as in any window; what it shares with
 * the main window is the workspace, through `window.opener`. A page with nothing to show closes itself.
 */
export function PopoutApp() {
  // Read on the client only: this page is also rendered once at build time, where there is no window.
  const link = useSyncExternalStore(subscribeToNothing, readLink, () => null);

  useEffect(() => {
    if (link === NO_LINK) window.close();
  }, [link]);

  if (link === null || link === NO_LINK) return <div aria-busy={link === null} className="h-screen" />;
  return <Popout shared={link.shared} windowId={link.windowId} />;
}

function Popout({ shared, windowId }: { shared: SharedWorkspace; windowId: WindowId }) {
  const { store, writing } = shared;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const surface = useNoteSurface(store, windowId);
  const { actions, dialog } = useWorkspaceActions(store, { windowId });
  const [ratio, setRatio] = useState(() => clampEditorRatio(window.composition?.initial.layout.editorRatio ?? DEFAULT_EDITOR_RATIO));

  const window_ = snapshot.panels.windows[windowId];

  // Closing this window (by its own button) is told to the workspace by the app, not by this page: the page runs its
  // unload events when the app tears it down too, as when it quits, and the window must then stay in the saved layout.

  // A window that has left the workspace (its last panel was closed or moved back) has nothing left to show.
  useEffect(() => {
    if (!window_) window.close();
  }, [window_]);

  // The window is named for the panel in front.
  const title = window_ ? panelTitle(snapshot.panels.byId[focusedPanelId(window_)], snapshot.notes, snapshot.deleted) : "";
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  if (!window_) return null;

  const notebookId = snapshot.notebooks[0]?.id ?? 1;
  const host: PanelHost = {
    ratio,
    onRatioChange: (next) => setRatio(clampEditorRatio(next)),
    // Not saved: the layout is saved as a pair with the sidebar's width, which this page does not have, and a pop-out's
    // own split is not worth overwriting the main window's with.
    onRatioCommit: () => {},
    onCreateNote: () => actions.onCreate(null, notebookId),
    onNewNoteFromText: (fromNoteId, text) => void store.newNoteFromText(fromNoteId, text, notebookId),
    onOpenNoteBeside: surface.openNoteBeside,
    onDropNote: surface.dropNote,
    sidebar: actions,
  };

  return (
    <AssistantProvider store={store.assistant}>
      <WritingProvider value={writing}>
        <div className="flex h-screen">
          <PanelGrid store={store} host={host} windowId={windowId} />
        </div>
        {surface.dialog}
        {dialog}
      </WritingProvider>
    </AssistantProvider>
  );
}
