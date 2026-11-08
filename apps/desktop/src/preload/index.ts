import { contextBridge, ipcRenderer, webUtils } from "electron";
import { API_METHODS } from "../../../web/src/lib/composition/api";
import { ATTACHMENT_METHODS } from "../../../web/src/lib/composition/attachmentsApi";
import { BACKUP_METHODS } from "../../../web/src/lib/composition/backupApi";
import { DOCUMENT_METHODS } from "../../../web/src/lib/composition/documentsApi";
import { FEED_METHODS } from "../../../web/src/lib/composition/feedsApi";
import { PANELS_METHODS } from "../../../web/src/lib/composition/panelsApi";
import { CONTACTS_METHODS } from "../../../web/src/lib/composition/contactsApi";
import { READING_LIST_METHODS } from "../../../web/src/lib/composition/readingListApi";
import { TODO_METHODS } from "../../../web/src/lib/composition/todosApi";
import { ASSISTANT_METHODS, type AssistantEventMessage } from "../../../web/src/lib/composition/assistantApi";
import { UPDATE_METHODS, type UpdateState } from "../../../web/src/lib/composition/updatesApi";
import type { AppearanceMessage } from "../../../web/src/lib/composition/appearanceApi";
import { WINDOW_METHODS } from "../../../web/src/lib/composition/windowApi";
import { APPEARANCE_CHANNEL, ASSISTANT_EVENT_CHANNEL, channelFor, IMPORT_PDF_CHANNEL, INITIAL_CHANNEL, POPOUT_CLOSED_CHANNEL, TODOS_CHANGED_CHANNEL, UPDATE_STATE_CHANNEL } from "../shared/channels";

/**
 * Exposes `window.composition`: every CompositionApi, AttachmentsApi, DocumentsApi, DesktopBackupApi, PanelsApi, TodosApi, ReadingListApi, ContactsApi, FeedsApi, UpdatesApi, WindowApi and AI helper
 * method, each forwarded to the main process, plus `onUpdateState` for the update state the main
 * process pushes, and a synchronous snapshot of the settings the first
 * paint needs. Nothing else from Electron or Node reaches the page.
 */
const api = Object.fromEntries(
  [...API_METHODS, ...ATTACHMENT_METHODS, ...DOCUMENT_METHODS, ...BACKUP_METHODS, ...PANELS_METHODS, ...TODO_METHODS, ...READING_LIST_METHODS, ...CONTACTS_METHODS, ...FEED_METHODS, ...UPDATE_METHODS, ...WINDOW_METHODS, ...ASSISTANT_METHODS].map((method) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke(channelFor(method), ...args),
  ]),
);

/**
 * A PDF dropped on the window. The page can hand over only the File the drop gave it: its path is read here, by Electron, from
 * what the operating system supplied, and goes straight to the main process, which checks it. The page never sees the path,
 * and a File it makes up has none (the answer is then an error, not an import).
 */
function importDroppedPdf(file: File, target: unknown): Promise<unknown> {
  let path = "";
  try {
    path = webUtils.getPathForFile(file);
  } catch {
    // Not a File at all: main answers that there is nothing to import.
  }
  return ipcRenderer.invoke(channelFor("importDroppedPdf"), path, target);
}

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

/** Calls `listener` with how the app looks, each time the scheme, a font or the sun's city is saved; returns the function that stops listening. */
function onAppearance(listener: (appearance: AppearanceMessage) => void): () => void {
  const handler = (_event: unknown, appearance: AppearanceMessage) => listener(appearance);
  ipcRenderer.on(APPEARANCE_CHANNEL, handler);
  return () => void ipcRenderer.removeListener(APPEARANCE_CHANNEL, handler);
}

/** Calls `listener` each time the weekly cycle has changed the to-do list; returns the function that stops listening. */
function onTodosChanged(listener: () => void): () => void {
  const handler = () => listener();
  ipcRenderer.on(TODOS_CHANGED_CHANNEL, handler);
  return () => void ipcRenderer.removeListener(TODOS_CHANGED_CHANNEL, handler);
}

/** Calls `listener` each time the user picks File > Import PDF… (only the main window is told); returns the function that stops listening. */
function onImportPdfRequest(listener: () => void): () => void {
  const handler = () => listener();
  ipcRenderer.on(IMPORT_PDF_CHANNEL, handler);
  return () => void ipcRenderer.removeListener(IMPORT_PDF_CHANNEL, handler);
}

/** Calls `listener` with the id of each pop-out window the user closes; returns the function that stops listening. */
function onPopoutClosed(listener: (windowId: string) => void): () => void {
  const handler = (_event: unknown, windowId: string) => listener(windowId);
  ipcRenderer.on(POPOUT_CLOSED_CHANNEL, handler);
  return () => void ipcRenderer.removeListener(POPOUT_CLOSED_CHANNEL, handler);
}

contextBridge.exposeInMainWorld("composition", {
  ...api,
  importDroppedPdf,
  onAppearance,
  onTodosChanged,
  onImportPdfRequest,
  onPopoutClosed,
  onUpdateState,
  onAssistantEvent,
  initial: ipcRenderer.sendSync(INITIAL_CHANNEL),
  platform: process.platform,
});
