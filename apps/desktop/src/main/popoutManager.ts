import { POPOUT_CLOSED_CHANNEL } from "../shared/channels";
import { isAllowedOrigin } from "./origin";
import { decideWindowOpen, isExternalUrl, popoutWindowId, type Bounds } from "./popoutWindows";
import type { WindowState } from "./windowState";

/* eslint-disable @typescript-eslint/no-explicit-any -- Electron's event emitters are typed per event; these are the parts used */
type Listener = (...args: any[]) => void;

/** The part of a `webContents` the manager uses. */
export type WebContentsLike = {
  on(event: string, listener: Listener): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => any): void;
  send(channel: string, ...args: unknown[]): void;
};

/** The part of a `BrowserWindow` the manager uses. */
export type WindowLike = {
  webContents: WebContentsLike;
  on(event: string, listener: Listener): unknown;
  show(): void;
  destroy(): void;
  isDestroyed(): boolean;
  getBounds(): Bounds;
};

/** How long after a pop-out stops moving or resizing its place is written down. */
const BOUNDS_DELAY_MS = 300;

/** How far a pop-out with no remembered place is from the main window's corner, and from the last one. */
const CASCADE_FIRST_PX = 40;
const CASCADE_STEP_PX = 30;

type Options = {
  allowedOrigins: readonly string[];
  preloadPath: string;
  /** The color a new window shows before its page paints, for the color scheme now. */
  backgroundColor: () => string;
  windowState: WindowState;
  openExternal: (url: string) => void;
  /** Attaches the right-click menu (spelling, editing) to a window's page. */
  installContextMenu: (webContents: any) => void;
};

/**
 * Owns the pop-out windows, which are pages of ours that the main window's page opens with `window.open` (so that
 * `window.opener` reaches the shared workspace; see docs/panel-system-plan.md). It lets that one kind of window open
 * and nothing else, gives each the guards the main window has, remembers where each was put, and destroys them all
 * when the main window goes (closes, or loads a different page), because the workspace they show lives in its page.
 *
 * Destroying, rather than closing, skips their unload handlers, so a pop-out that goes with the main window is not
 * mistaken for one the user closed: the saved layout still has it, and it comes back with the main window.
 */
export function createPopoutManager(options: Options) {
  const { allowedOrigins, preloadPath, backgroundColor, windowState, openExternal, installContextMenu } = options;
  const open = new Map<string, WindowLike>();
  const destroying = new Set<string>();

  function destroyAll(): void {
    for (const [id, window] of [...open]) {
      open.delete(id);
      if (window.isDestroyed()) continue;
      destroying.add(id);
      window.destroy();
    }
  }

  function guard(window: WindowLike, id: string, main: WindowLike): void {
    installContextMenu(window.webContents);
    // A pop-out opens nothing of its own: links in its notes go to the browser, as in the main window.
    window.webContents.setWindowOpenHandler(({ url }) => {
      const decision = decideWindowOpen({ url, openedByPopout: true, allowedOrigins, preloadPath, backgroundColor: backgroundColor() });
      if (decision.action === "deny" && decision.openExternally) openExternal(decision.openExternally);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event: { preventDefault(): void }, url: string) => {
      if (isAllowedOrigin(url, allowedOrigins)) return;
      event.preventDefault();
      if (isExternalUrl(url)) openExternal(url);
    });

    window.on("ready-to-show", () => window.show());

    let timer: ReturnType<typeof setTimeout> | undefined;
    const remember = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!window.isDestroyed()) windowState.remember(id, window.getBounds());
      }, BOUNDS_DELAY_MS);
    };
    window.on("move", remember);
    window.on("resize", remember);
    window.on("closed", () => {
      clearTimeout(timer);
      open.delete(id);
      if (destroying.delete(id)) return;
      // Closed by the user, not by us: it is gone for good, so its place is too, and the workspace is told. (The page's
      // own unload events cannot say which it was: a destroyed window runs them too.)
      windowState.forget(id);
      if (!main.isDestroyed()) main.webContents.send(POPOUT_CLOSED_CHANNEL, id);
    });
  }

  return {
    /** Takes charge of what the main window may open, and of pop-outs for as long as it lasts. */
    attach(main: WindowLike): void {
      main.webContents.setWindowOpenHandler(({ url }) => {
        const common = { url, openedByPopout: false, allowedOrigins, preloadPath, backgroundColor: backgroundColor() };
        const decision = decideWindowOpen(common);
        if (decision.action === "deny") {
          if (decision.openExternally) openExternal(decision.openExternally);
          return { action: "deny" };
        }

        const remembered = windowState.boundsFor(decision.windowId);
        const mainBounds = main.getBounds();
        const offset = CASCADE_FIRST_PX + CASCADE_STEP_PX * open.size;
        const place = remembered ?? { x: mainBounds.x + offset, y: mainBounds.y + offset };
        return { action: "allow", overrideBrowserWindowOptions: { ...decision.options, ...place } };
      });

      main.webContents.on("did-create-window", (window: WindowLike, details: { url: string }) => {
        const id = popoutWindowId(details.url, allowedOrigins);
        if (id === null) {
          window.destroy();
          return;
        }
        open.set(id, window);
        guard(window, id, main);
      });

      main.webContents.on("did-start-navigation", (event: { isMainFrame: boolean; isSameDocument: boolean }) => {
        if (event.isMainFrame && !event.isSameDocument) destroyAll();
      });
      // As soon as it starts to close, not when it has: the pop-outs would otherwise be asked to close too, and a pop-out
      // that closes tells the workspace its window is gone, which would drop it from the saved layout.
      main.on("close", destroyAll);
      main.on("closed", destroyAll);
    },
    destroyAll,
  };
}
