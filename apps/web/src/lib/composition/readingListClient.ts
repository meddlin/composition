import type { ReadingListApi } from "./readingListApi";
import type {} from "./desktopBridge";

/**
 * The desktop app's Reading List, reached over Electron IPC through the preload script's `window.composition`. Only the
 * desktop build uses it (the web app has no panels), so there is no Server Action twin.
 */

function bridge(): ReadingListApi {
  const api = typeof window === "undefined" ? undefined : window.composition;
  if (!api) {
    throw new Error("The Composition desktop bridge is unavailable. The Reading List only runs inside the desktop app.");
  }
  return api;
}

export const listReadingItems: ReadingListApi["listReadingItems"] = () => bridge().listReadingItems();
export const addReadingItem: ReadingListApi["addReadingItem"] = (url) => bridge().addReadingItem(url);
export const setReadingItemTitle: ReadingListApi["setReadingItemTitle"] = (id, title) => bridge().setReadingItemTitle(id, title);
export const setReadingItemRead: ReadingListApi["setReadingItemRead"] = (id, read) => bridge().setReadingItemRead(id, read);
export const deleteReadingItem: ReadingListApi["deleteReadingItem"] = (id) => bridge().deleteReadingItem(id);
export const clearReadingData: ReadingListApi["clearReadingData"] = () => bridge().clearReadingData();
