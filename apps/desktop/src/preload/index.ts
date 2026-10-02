import { contextBridge, ipcRenderer } from "electron";
import { API_METHODS } from "../../../web/src/lib/composition/api";
import { ATTACHMENT_METHODS } from "../../../web/src/lib/composition/attachmentsApi";
import { BACKUP_METHODS } from "../../../web/src/lib/composition/backupApi";
import { channelFor, INITIAL_CHANNEL } from "../shared/channels";

/**
 * Exposes `window.composition`: every CompositionApi, AttachmentsApi and DesktopBackupApi method,
 * each forwarded to the main process, plus a synchronous snapshot of the settings the first
 * paint needs. Nothing else from Electron or Node reaches the page.
 */
const api = Object.fromEntries(
  [...API_METHODS, ...ATTACHMENT_METHODS, ...BACKUP_METHODS].map((method) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke(channelFor(method), ...args),
  ]),
);

contextBridge.exposeInMainWorld("composition", {
  ...api,
  initial: ipcRenderer.sendSync(INITIAL_CHANNEL),
  platform: process.platform,
});
