"use client";

import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { AssistantPanel } from "../notes/AssistantPanel";
import { readPaneSelection } from "../notes/paneSelection";
import { noteTitle } from "../notes/types";
import type { WorkspaceSnapshot, WorkspaceStore } from "../notes/workspaceStore";
import type { PanelHost } from "./host";
import { noteIdOf } from "./kinds";
import type { PanelId } from "./layoutTree";
import { assistantSubject, windowOf } from "./panelsState";

/** The panel of the note in this panel's window that was used last, if any shows `noteId`. */
function notePanelElement(store: WorkspaceStore, panelId: PanelId, noteId: number): HTMLElement | null {
  const { panels } = store.getSnapshot();
  const windowId = windowOf(panels, panelId);
  const shown = windowId === undefined ? undefined : panels.windows[windowId].focusOrder.find((id) => noteIdOf(panels.byId[id]) === noteId);
  return shown === undefined ? null : document.querySelector<HTMLElement>(`[data-panel-id="${shown}"]`);
}

/**
 * The AI helper as a panel: the helper's chat about one note, which is the note it is pinned to or, when it follows,
 * the one the user is working in. Its chats are the workspace's, so they stay with the note when the panel is moved to
 * another window or closed.
 */
export function AiPanel({
  store,
  panelId,
  snapshot,
  host,
}: {
  store: WorkspaceStore;
  panelId: PanelId;
  snapshot: WorkspaceSnapshot;
  host: PanelHost;
}) {
  const noteId = assistantSubject(snapshot.panels, panelId);
  const live = snapshot.notes.find((n) => n.id === noteId);
  // A note deleted while the helper is about it is kept, as it last was, by the workspace.
  const note = live ?? snapshot.deleted.find((n) => n.id === noteId);

  if (!note) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyDescription>Open a note to ask about it.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <AssistantPanel
      // Whatever was typed or selected was about the other note.
      key={note.id}
      noteId={note.id}
      noteContent={note.content}
      panel={{ noteTitle: noteTitle(note), deleted: live === undefined }}
      getSelection={() => {
        const element = notePanelElement(store, panelId, note.id);
        return element ? readPaneSelection(element) : "";
      }}
      onNewNoteFromText={(text) => host.onNewNoteFromText(note.id, text)}
      onReturnFocus={() => notePanelElement(store, panelId, note.id)?.querySelector("textarea")?.focus()}
    />
  );
}
