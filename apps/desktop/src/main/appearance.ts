import type { AppearanceMessage } from "../../../web/src/lib/composition/appearanceApi";
import type { WindowApi } from "../../../web/src/lib/composition/windowApi";
import { APPEARANCE_CHANNEL } from "../shared/channels";

export type { AppearanceMessage };

type WindowLike = { isDestroyed(): boolean; webContents: { send(channel: string, ...args: unknown[]): void } };

/** Tells every open window how the app looks now, so a window beside Settings follows what is chosen there. */
export function broadcastAppearance(windows: readonly WindowLike[], appearance: AppearanceMessage): void {
  for (const window of windows) {
    if (!window.isDestroyed()) window.webContents.send(APPEARANCE_CHANNEL, appearance);
  }
}

type Change = (value: string) => Promise<{ error?: string }>;

/**
 * The API with `announce` called after each way of changing the appearance has gone through (not after one that was
 * refused or failed). Settings is one page in one window; this is what lets the others, pop-outs among them, follow it.
 */
export function notifyAppearanceChanges<
  T extends Record<"saveTheme" | "savePreviewFont" | "saveEditorFont" | "saveLocation" | "saveNoteBackground", Change>,
>(
  api: T,
  announce: () => void,
): T {
  const announcing =
    (change: Change): Change =>
    async (value) => {
      const result = await change(value);
      if (!result.error) announce();
      return result;
    };
  return {
    ...api,
    saveTheme: announcing(api.saveTheme),
    savePreviewFont: announcing(api.savePreviewFont),
    saveEditorFont: announcing(api.saveEditorFont),
    saveLocation: announcing(api.saveLocation),
    saveNoteBackground: announcing(api.saveNoteBackground),
  } as T;
}

/**
 * The window API with `announce` called once the see-through look has been changed (the windows are already changed by
 * then), so a window that is not the one in Settings, a pop-out, follows it too.
 */
export function notifyTranslucencyChange<T extends WindowApi>(api: T, announce: () => void): T {
  return {
    ...api,
    async setWindowTranslucency(enabled: boolean) {
      const state = await api.setWindowTranslucency(enabled);
      announce();
      return state;
    },
    async setWindowOpacity(opacity: number) {
      const state = await api.setWindowOpacity(opacity);
      announce();
      return state;
    },
  };
}
