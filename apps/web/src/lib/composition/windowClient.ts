import type { WindowTranslucency } from "./windowApi";

/**
 * What the Settings page imports to read and change the window's translucency. The web app has
 * no window of its own, so here every call fails; the desktop build resolves
 * `windowClient.desktop.ts` instead (next.config.ts), which talks to the main process. UI checks
 * `WINDOW_SETTINGS_AVAILABLE` first and renders nothing when it is false.
 */
export const WINDOW_SETTINGS_AVAILABLE = false;

const unavailable = <T>(): Promise<T> => Promise.reject(new Error("Window translucency is only available in the desktop app."));

export const getWindowTranslucency = (): Promise<WindowTranslucency> => unavailable();
export const setWindowTranslucency = (enabled: boolean): Promise<WindowTranslucency> => (void enabled, unavailable());
