import { createChatsStore } from "@/lib/composition/assistant/chatsStore";
import { streamChat } from "@/lib/composition/assistantClient";
import * as client from "@/lib/composition/client";
import { createWorkspaceStore, type WorkspaceData, type WorkspaceStore } from "./workspaceStore";

/** What the desktop app saved of its panels last time (see `panelsRestore.ts`); the web app has none. */
export type PanelsToRestore = { saved: unknown; trashed: WorkspaceData["notes"] };

/**
 * A workspace store wired to the real backend (Server Actions on the web, IPC on the desktop, whichever `client`
 * resolves to) and to the real AI client. `client` is passed as a namespace and only read when an action runs.
 * (The desktop build swaps in `workspaceInstance.desktop.ts`, which also gives it panels.)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the second argument is the desktop build's; this keeps the two signatures alike
export function createWorkspace(initial: WorkspaceData, _panels?: PanelsToRestore): WorkspaceStore {
  return createWorkspaceStore(initial, client, createChatsStore({ streamChat: (request, signal) => streamChat(request, signal) }));
}
