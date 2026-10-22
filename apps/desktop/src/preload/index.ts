import { contextBridge, ipcRenderer } from "electron";
import { API_METHODS } from "../../../web/src/lib/composition/api";
import { ATTACHMENT_METHODS } from "../../../web/src/lib/composition/attachmentsApi";
import { BACKUP_METHODS } from "../../../web/src/lib/composition/backupApi";
import { ASSISTANT_METHODS, type AssistantEventMessage } from "../../../web/src/lib/composition/assistantApi";
import { UPDATE_METHODS, type UpdateState } from "../../../web/src/lib/composition/updatesApi";
import { ASSISTANT_EVENT_CHANNEL, channelFor, INITIAL_CHANNEL, UPDATE_STATE_CHANNEL } from "../shared/channels";

/**
 * Exposes `window.composition`: every CompositionApi, AttachmentsApi, DesktopBackupApi, UpdatesApi and AI helper
 * method, each forwarded to the main process, plus `onUpdateState` for the update state the main
 * process pushes, and a synchronous snapshot of the settings the first
 * paint needs. Nothing else from Electron or Node reaches the page.
 */
const api = Object.fromEntries(
  [...API_METHODS, ...ATTACHMENT_METHODS, ...BACKUP_METHODS, ...UPDATE_METHODS, ...ASSISTANT_METHODS].map((method) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke(channelFor(method), ...args),
  ]),
);

/** Calls `listener` with each pushed update state; returns the function that stops listening. */
function onUpdateState(listener: (state: UpdateState) => void): () => void {
  const handler = (_event: unknown, state: UpdateState) => listener(state);
  ipcRenderer.on(UPDATE_STATE_CHANNEL, handler);
  return () => void ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, handler);
}

/** Calls `listener` with each pushed event of an AI helper turn; returns the function that stops listening. */
function onAssistantEvent(listener: (message: AssistantEventMessage) => void): () => void {
  const handler = (_event: unknown, message: AssistantEventMessage) => listener(message);
  ipcRenderer.on(ASSISTANT_EVENT_CHANNEL, handler);
  return () => void ipcRenderer.removeListener(ASSISTANT_EVENT_CHANNEL, handler);
}

contextBridge.exposeInMainWorld("composition", {
  ...api,
  onUpdateState,
  onAssistantEvent,
  initial: ipcRenderer.sendSync(INITIAL_CHANNEL),
  platform: process.platform,
});
