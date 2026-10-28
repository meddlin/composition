import { BrowserWindow, shell, type WebPreferences } from "electron";
import type { ThemeName } from "./backend";
import { installContextMenu } from "./contextMenu";
import { isAllowedOrigin } from "./origin";
import { isExternalUrl } from "./popoutWindows";
import type { createPopoutManager, WindowLike } from "./popoutManager";

/**
 * Window background per color scheme, so the very first frame matches the UI
 * instead of flashing white. Mirrors `--background` in apps/web/src/app/globals.css
 * (window.test.ts fails if they drift apart). The "auto" scheme has no entry of
 * its own: the window starts out as whichever of dark or light it begins in.
 */
export const THEME_BACKGROUND: Record<Exclude<ThemeName, "auto">, string> = {
  dark: "#121212",
  light: "#f7f7f4",
  forest: "#0c1510",
  wine: "#160a0e",
  cream: "#f6f0e1",
};

/** What the main window's page is given: exactly the window.composition bridge, and its timers kept running. */
export function mainWindowPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    // The UI gets exactly the window.composition bridge and nothing else.
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    // Underlines misspelled words in the editor (the OS dictionary on macOS); contextMenu.ts offers the fixes.
    spellcheck: true,
    // The workspace's autosave timers run in this page for every window, pop-outs included: a minimised main window
    // that throttled them to about one tick a second would delay saving what is typed in a pop-out.
    backgroundThrottling: false,
  };
}

export function createMainWindow(options: {
  preloadPath: string;
  entryUrl: string;
  allowedOrigins: readonly string[];
  theme: Exclude<ThemeName, "auto">;
  /** Decides which windows its page may open (pop-outs, and nothing else), and looks after them. */
  popouts: ReturnType<typeof createPopoutManager>;
}): BrowserWindow {
  const { preloadPath, entryUrl, allowedOrigins, theme, popouts } = options;

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: "Composition",
    backgroundColor: THEME_BACKGROUND[theme] ?? THEME_BACKGROUND.dark,
    webPreferences: mainWindowPreferences(preloadPath),
  });
  installContextMenu(window.webContents);

  window.once("ready-to-show", () => window.show());

  // Links in rendered notes open in the user's browser; the app window never navigates away from its own UI. The
  // one window it may open is a pop-out, which the manager allows and looks after.
  popouts.attach(window as unknown as WindowLike);
  window.webContents.on("will-navigate", (event, url) => {
    if (isAllowedOrigin(url, allowedOrigins)) return;
    event.preventDefault();
    if (isExternalUrl(url)) void shell.openExternal(url);
  });

  void window.loadURL(entryUrl);
  return window;
}
