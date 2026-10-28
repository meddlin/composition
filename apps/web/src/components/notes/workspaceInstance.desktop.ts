import { createChatsStore } from "@/lib/composition/assistant/chatsStore";
import { streamChat } from "@/lib/composition/assistantClient";
import * as client from "@/lib/composition/client";
import { savePanels } from "@/lib/composition/panelsClient";
import * as todosClient from "@/lib/composition/todosClient";
import { createTodosStore } from "@/lib/composition/todosStore";
import { DEFAULT_WRITING_SETTINGS } from "@/lib/composition/writing";
import { forgetPopoutsTheUserCloses, openPopoutWindow, publishWorkspace } from "../desktop/popoutLink";
import { createPopoutController } from "../panels/popoutController";
import type { PanelsToRestore } from "./workspaceInstance";
import { createWorkspaceStore, type WorkspaceData, type WorkspaceStore } from "./workspaceStore";

export type { PanelsToRestore };

/**
 * The desktop app's workspace store: the same wiring as the web's, and the open notes are a grid of panels, brought
 * back from what was saved and saved again whenever they are rearranged.
 */
export function createWorkspace(initial: WorkspaceData, panels?: PanelsToRestore): WorkspaceStore {
  const store = createWorkspaceStore(
    initial,
    client,
    createChatsStore({ streamChat: (request, signal) => streamChat(request, signal) }),
    {
      todos: createTodosStore(todosClient),
      panels: {
        saved: panels?.saved,
        trashed: panels?.trashed,
        // The arrangement is a convenience: failing to save it must not get in the way of the notes.
        save: (document) => void savePanels(document).catch((error) => console.error("[panels] not saved:", error)),
      },
    },
  );
  // The pop-outs the workspace is saved with open now, and any made later; a pop-out finds the workspace by `window.opener`,
  // so it is published first.
  publishWorkspace({ store, writing: initial.writing ?? DEFAULT_WRITING_SETTINGS });
  createPopoutController(store, openPopoutWindow);
  forgetPopoutsTheUserCloses(store);
  return store;
}
