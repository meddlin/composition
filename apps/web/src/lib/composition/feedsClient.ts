import { stripIpcPrefix } from "./feeds";
import type { FeedsApi } from "./feedsApi";
import type {} from "./desktopBridge";

/**
 * The desktop app's RSS Reader, reached over Electron IPC through the preload script's `window.composition`. Only the
 * desktop build uses it (the web app has no panels), so there is no Server Action twin.
 */

function bridge(): FeedsApi {
  const api = typeof window === "undefined" ? undefined : window.composition;
  if (!api) {
    throw new Error("The Composition desktop bridge is unavailable. The RSS Reader only runs inside the desktop app.");
  }
  return api;
}

/** Calls the main process; a refusal reads as its reason alone, since the panel shows it as it is. */
async function reasoned<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw error instanceof Error ? new Error(stripIpcPrefix(error.message)) : error;
  }
}

export const listFeeds: FeedsApi["listFeeds"] = () => reasoned(() => bridge().listFeeds());
export const subscribeFeed: FeedsApi["subscribeFeed"] = (url) => reasoned(() => bridge().subscribeFeed(url));
export const unsubscribeFeed: FeedsApi["unsubscribeFeed"] = (id) => reasoned(() => bridge().unsubscribeFeed(id));
export const listFeedEntries: FeedsApi["listFeedEntries"] = (feedId) => reasoned(() => bridge().listFeedEntries(feedId));
export const refreshFeed: FeedsApi["refreshFeed"] = (id) => reasoned(() => bridge().refreshFeed(id));
export const refreshAllFeeds: FeedsApi["refreshAllFeeds"] = () => reasoned(() => bridge().refreshAllFeeds());
export const setFeedEntryRead: FeedsApi["setFeedEntryRead"] = (id, read) => reasoned(() => bridge().setFeedEntryRead(id, read));
export const markFeedRead: FeedsApi["markFeedRead"] = (feedId) => reasoned(() => bridge().markFeedRead(feedId));
