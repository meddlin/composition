import type { BrowserWindowConstructorOptions } from "electron";
import { isAllowedOrigin } from "./origin";
import { WINDOW_VIBRANCY } from "./translucency";

/** The page a pop-out shows (the renderer's `app/popout` route; see `page.desktop.tsx`), reached with `?w=<window id>`. */
export const POPOUT_PATH = "/popout/";

/** The ids the renderer gives pop-out windows (`w1`, `w2`, ...). The main window is not one. */
const POPOUT_WINDOW_ID = /^w\d+$/;

const DEFAULT_SIZE = { width: 900, height: 700 };

export type Bounds = { x: number; y: number; width: number; height: number };

export type WindowOpenDecision =
  | {
      action: "deny";
      /** A link for the user's browser: nothing opens in a window of ours, but a normal link still goes somewhere. */
      openExternally?: string;
    }
  | { action: "allow"; windowId: string; options: BrowserWindowConstructorOptions };

/** Links in rendered notes that belong in the user's browser. */
export function isExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

/** The window id in a pop-out's URL, or null if the URL is not exactly one of ours (the page, one `w` parameter). */
export function popoutWindowId(url: string, allowedOrigins: readonly string[]): string | null {
  if (!isAllowedOrigin(url, allowedOrigins)) return null;
  try {
    const parsed = new URL(url);
    const params = [...parsed.searchParams];
    if (parsed.pathname !== POPOUT_PATH || params.length !== 1 || params[0][0] !== "w") return null;
    return POPOUT_WINDOW_ID.test(params[0][1]) ? params[0][1] : null;
  } catch {
    return null;
  }
}

/**
 * What to do when a page asks to open a window. The only window the app opens is a pop-out, and only for the main
 * window, at one exact URL, with the same isolation as the main window's (a pop-out is a page of ours, never a
 * place to load anything else). Anything else is refused, and an ordinary link goes to the user's browser.
 */
export function decideWindowOpen(input: {
  url: string;
  /** Whether the page asking is itself a pop-out. */
  openedByPopout: boolean;
  allowedOrigins: readonly string[];
  preloadPath: string;
  backgroundColor: string;
  /** Whether windows are see-through now (macOS): a pop-out blurs what is behind it, as the main window does. */
  translucent: boolean;
  /** Where this pop-out was last, if that is known and still on a display. */
  bounds?: Bounds;
}): WindowOpenDecision {
  const { url, openedByPopout, allowedOrigins, preloadPath, backgroundColor, translucent, bounds } = input;

  const windowId = openedByPopout ? null : popoutWindowId(url, allowedOrigins);
  if (windowId === null) {
    return !isAllowedOrigin(url, allowedOrigins) && isExternalUrl(url) ? { action: "deny", openExternally: url } : { action: "deny" };
  }

  return {
    action: "allow",
    windowId,
    options: {
      ...DEFAULT_SIZE,
      ...bounds,
      minWidth: 360,
      minHeight: 280,
      show: false,
      title: "Composition",
      ...(translucent ? { vibrancy: WINDOW_VIBRANCY } : {}),
      backgroundColor,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: true,
        // As in the main window: the Reading List panel can be pulled out, and its web view needs the tag here too.
        webviewTag: true,
      },
    },
  };
}
