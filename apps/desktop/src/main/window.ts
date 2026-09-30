import { BrowserWindow, shell } from "electron";
import type { ThemeName } from "./backend";
import { isAllowedOrigin } from "./origin";

/**
 * Window background per color scheme, so the very first frame matches the UI
 * instead of flashing white. Mirrors `--background` in apps/web/src/app/globals.css
 * (window.test.ts fails if they drift apart).
 */
export const THEME_BACKGROUND: Record<ThemeName, string> = {
  dark: "#121212",
  light: "#f7f7f4",
  forest: "#0c1510",
  cream: "#f6f0e1",
};

function isExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:";
  } catch {
    return false;
  }
}

export function createMainWindow(options: {
  preloadPath: string;
  entryUrl: string;
  allowedOrigins: readonly string[];
  theme: ThemeName;
}): BrowserWindow {
  const { preloadPath, entryUrl, allowedOrigins, theme } = options;

  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: "Composition",
    backgroundColor: THEME_BACKGROUND[theme] ?? THEME_BACKGROUND.dark,
    webPreferences: {
      preload: preloadPath,
      // The UI gets exactly the window.composition bridge and nothing else.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  // Links in rendered notes open in the user's browser; the app window never
  // navigates away from its own UI.
  const isOurs = (url: string) => isAllowedOrigin(url, allowedOrigins);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isOurs(url)) return;
    event.preventDefault();
    if (isExternalUrl(url)) void shell.openExternal(url);
  });

  void window.loadURL(entryUrl);
  return window;
}
