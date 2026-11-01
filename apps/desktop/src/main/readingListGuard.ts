import { READING_LIST_PARTITION } from "../../../web/src/lib/composition/readingListApi";
import { isExternalUrl } from "./popoutWindows";

/* eslint-disable @typescript-eslint/no-explicit-any -- Electron's event emitters are typed per event; these are the parts used */
type Listener = (...args: any[]) => void;

/** The part of a `webContents` the guard uses: the window's page (the host) and a web view's page (the guest). */
export type GuardedContents = {
  on(event: string, listener: Listener): unknown;
  setWindowOpenHandler?(handler: (details: { url: string }) => any): void;
  /** On a guest: the page that holds the `<webview>`. */
  hostWebContents?: { sendInputEvent(event: any): void } | null;
};

/** The part of a browser session the guard uses. */
export type SessionLike = {
  setPermissionRequestHandler(handler: (...args: any[]) => void): void;
  setPermissionCheckHandler(handler: (...args: any[]) => boolean): void;
  setDevicePermissionHandler?(handler: (...args: any[]) => boolean): void;
  on(event: string, listener: Listener): unknown;
  clearStorageData(): Promise<void>;
  clearCache(): Promise<void>;
};

export type ReadingListGuardDeps = {
  /** Whether the Reading List plugin is on now. Read at each attach, so turning it off takes effect at once. */
  pluginEnabled: () => boolean;
  openExternal: (url: string) => void;
  /** The session the web views live in. */
  readingSession: () => SessionLike;
};

const isWebUrl = (url: unknown): url is string => {
  if (typeof url !== "string") return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Settles what a `<webview>` may be. The page asks for one with attributes of its own (`src`, `partition`, `preload`,
 * `nodeintegration`, `webpreferences`, ...), and a page that is compromised, or a bug, could ask for anything, so nothing
 * it asked for is trusted: the preferences are set outright, and the parameters are rebuilt from the only two that are
 * kept (`src`, and only a web address, and the Reading List's own partition). The partition cannot be set here: Electron
 * has chosen the guest's session by the time this runs (a view that names another is created in that one whatever is
 * written into `params`), so a view that did not ask for exactly the Reading List's partition is refused. Returns false
 * when it must not attach at all.
 */
export function guardWebviewAttach(webPreferences: Record<string, any>, params: Record<string, any>, pluginEnabled: boolean): boolean {
  if (!pluginEnabled || !isWebUrl(params.src) || params.partition !== READING_LIST_PARTITION) return false;

  // The guest gets no bridge and no Node: it is an arbitrary web page.
  delete webPreferences.preload;
  delete webPreferences.preloadURL;
  delete webPreferences.enableBlinkFeatures;
  delete webPreferences.disableBlinkFeatures;
  Object.assign(webPreferences, {
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    webviewTag: false,
    plugins: false,
  });

  const src = params.src;
  for (const key of Object.keys(params)) delete params[key];
  params.src = src;
  params.partition = READING_LIST_PARTITION;
  // Popups are allowed so that a new-window request reaches the guest's open handler, which denies it and opens the browser.
  params.allowpopups = "true";
  return true;
}

/** The keys the app owns (held with Mod and Shift; see panelCommands.ts), by physical key, and the key each is sent to the page as. */
const APP_KEYS: Record<string, string> = { Backslash: "\\", KeyW: "W", BracketRight: "]", BracketLeft: "[", KeyP: "P" };

/** The key to hand on to the host page when a press inside a web view is one the app owns, else null. */
export function appShortcutKey(
  input: { type?: string; code?: string; shift?: boolean; control?: boolean; meta?: boolean; alt?: boolean; isAutoRepeat?: boolean },
  platform: string,
): string | null {
  if (input.type !== "keyDown" || input.alt || input.isAutoRepeat || !input.shift) return null;
  if (!(platform === "darwin" ? input.meta : input.control)) return null;
  return (input.code !== undefined && APP_KEYS[input.code]) || null;
}

/** Locks down the session the web views share: no permission is ever granted, and nothing downloads. Safe to call again. */
export function secureReadingSession(session: SessionLike): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback: (granted: boolean) => void) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler?.(() => false);
  session.on("will-download", (event: { preventDefault(): void }) => event.preventDefault());
}

/**
 * Wipes what the pages stored in the Reading List's session: cookies, local storage, the cache. The links are not touched.
 */
export async function clearReadingData(session: SessionLike): Promise<void> {
  await session.clearStorageData();
  await session.clearCache();
}

/** Looks after one web view's page once it is attached. */
function guardGuest(guest: GuardedContents, deps: ReadingListGuardDeps, platform: string): void {
  // A click that stays in the tab navigates the view; a new-window request (`target=_blank`, `window.open`) goes to the
  // browser, and nothing opens a window of ours.
  guest.setWindowOpenHandler?.(({ url }) => {
    if (isExternalUrl(url)) deps.openExternal(url);
    return { action: "deny" };
  });
  // The view only ever shows web pages: not `app://`, not `file://`, not whatever a redirect points at.
  const refuseNonWeb = (event: { preventDefault(): void }, url: string) => {
    if (!isWebUrl(url)) event.preventDefault();
  };
  guest.on("will-navigate", refuseNonWeb);
  guest.on("will-redirect", refuseNonWeb);
  // Key presses inside a guest page never reach the host page, so the few the app owns are handed on to it.
  guest.on("before-input-event", (event: { preventDefault(): void }, input: Parameters<typeof appShortcutKey>[0]) => {
    const keyCode = appShortcutKey(input, platform);
    const host = guest.hostWebContents;
    if (keyCode === null || !host) return;
    event.preventDefault();
    const modifiers = [platform === "darwin" ? "meta" : "control", "shift"];
    host.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    host.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  });
}

/**
 * Takes charge of the web views a window's page may attach. Called for the main window and for each pop-out (both build
 * their own preferences, so the same guard must be attached to both). Nothing attaches while the plugin is off.
 */
export function installReadingListGuard(host: GuardedContents, deps: ReadingListGuardDeps, platform: string = process.platform): void {
  host.on("will-attach-webview", (event: { preventDefault(): void }, webPreferences: Record<string, any>, params: Record<string, any>) => {
    if (!guardWebviewAttach(webPreferences, params, deps.pluginEnabled())) {
      event.preventDefault();
      return;
    }
    secureReadingSession(deps.readingSession());
  });
  host.on("did-attach-webview", (_event: unknown, guest: GuardedContents) => guardGuest(guest, deps, platform));
}
