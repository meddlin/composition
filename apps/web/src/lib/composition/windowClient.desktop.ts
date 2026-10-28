import type {} from "./desktopBridge";
import type { WindowTranslucency } from "./windowApi";

/**
 * Desktop build's replacement for `windowClient.ts` (see next.config.ts): the same
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

export const WINDOW_SETTINGS_AVAILABLE = true;

export const getWindowTranslucency = (): Promise<WindowTranslucency> => bridge().getWindowTranslucency();
export const setWindowTranslucency = (enabled: boolean): Promise<WindowTranslucency> => bridge().setWindowTranslucency(enabled);
