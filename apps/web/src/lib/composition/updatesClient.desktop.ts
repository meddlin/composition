import type {} from "./desktopBridge";
import type { UpdateState, UpdateStateListener } from "./updatesApi";

/**
 * Desktop build's replacement for `updatesClient.ts` (see next.config.ts): the same
 * functions, carried over Electron IPC by the preload script's `window.composition`.
 */
function bridge() {
  const api = typeof window === "undefined" ? undefined : window.composition;
  if (!api) {
    throw new Error(
      "The Composition desktop bridge is unavailable. This build only runs inside the desktop app.",
    );
  }
  return api;
}

export const UPDATES_AVAILABLE = true;

export const getUpdateState = (): Promise<UpdateState> => bridge().getUpdateState();
export const checkForUpdates = (): Promise<UpdateState> => bridge().checkForUpdates();
export const downloadUpdate = (): Promise<UpdateState> => bridge().downloadUpdate();
export const installUpdate = (): Promise<UpdateState> => bridge().installUpdate();
export const setAutoCheckUpdates = (enabled: boolean): Promise<UpdateState> => bridge().setAutoCheckUpdates(enabled);
export const setAllowPrerelease = (enabled: boolean): Promise<UpdateState> => bridge().setAllowPrerelease(enabled);
export const subscribeToUpdateState = (listener: UpdateStateListener): (() => void) => bridge().onUpdateState(listener);
