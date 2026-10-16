import type { UpdateState, UpdateStateListener } from "./updatesApi";

/**
 * What the Settings page and the sidebar import to read and drive updates. The web app and
 * CLI have no updater, so here every call fails and nothing is ever pushed; the desktop
 * build resolves `updatesClient.desktop.ts` instead (next.config.ts), which talks to the
 * main process. UI checks `UPDATES_AVAILABLE` first and renders nothing when it is false.
 */
export const UPDATES_AVAILABLE = false;

const unavailable = <T>(): Promise<T> => Promise.reject(new Error("Updates are only available in the desktop app."));

export const getUpdateState = (): Promise<UpdateState> => unavailable();
export const checkForUpdates = (): Promise<UpdateState> => unavailable();
export const downloadUpdate = (): Promise<UpdateState> => unavailable();
export const installUpdate = (): Promise<UpdateState> => unavailable();
export const setAutoCheckUpdates = (enabled: boolean): Promise<UpdateState> => (void enabled, unavailable());
export const setAllowPrerelease = (enabled: boolean): Promise<UpdateState> => (void enabled, unavailable());
export const subscribeToUpdateState = (listener: UpdateStateListener): (() => void) => (void listener, () => {});
