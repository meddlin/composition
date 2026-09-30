import { contextBridge, ipcRenderer } from "electron";
import { API_METHODS } from "../../../web/src/lib/composition/api";
import { channelFor, INITIAL_CHANNEL } from "../shared/channels";

/**
 * Exposes `window.composition`: every CompositionApi method, each forwarded to
 * the main process, plus a synchronous snapshot of the settings the first
 * paint needs. Nothing else from Electron or Node reaches the page.
 */
const api = Object.fromEntries(
  API_METHODS.map((method) => [
    method,
    (...args: unknown[]) => ipcRenderer.invoke(channelFor(method), ...args),
  ]),
);

contextBridge.exposeInMainWorld("composition", {
  ...api,
  initial: ipcRenderer.sendSync(INITIAL_CHANNEL),
  platform: process.platform,
});
