import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { closeDb, listNotes, loadWebSettings, searchIndex, service, type CompositionApi, type ThemeName } from "./backend";
import { isTrustedUrl, registerIpc } from "./ipc";
import { originOf } from "./origin";
import { APP_ORIGIN, registerAppProtocol, registerSchemePrivileges } from "./protocol";
import { isExecutableFile, resolveMeiliBinary, SearchSidecar } from "./search";
import { createMainWindow } from "./window";

app.setName("Composition");
app.setAboutPanelOptions({
  applicationName: "Composition",
  copyright: "Copyright © Composition contributors",
  credits:
    "Includes Meilisearch (MIT), Electron and Chromium. License notices are in the app bundle's Resources/licenses folder.",
});
// Before the app is ready, as Electron requires for custom schemes.
registerSchemePrivileges();

// This app keeps its own settings file under Electron's per-app data folder
// (the web app and CLI have theirs). The notes database itself is shared and
// lives in ~/.composition by default (docs/product-builds.md).
const userData = app.getPath("userData");
process.env.COMPOSITION_SETTINGS_PATH = path.join(userData, "settings.json");

// Development loads the UI from `next dev`; a packaged app never does.
const devUrl = app.isPackaged ? undefined : process.env.COMPOSITION_DEV_URL;
const devOrigin = devUrl ? originOf(devUrl) : null;
const allowedOrigins = [APP_ORIGIN, ...(devOrigin ? [devOrigin] : [])];

const sidecar = new SearchSidecar({
  binary: resolveMeiliBinary({
    env: process.env,
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    platform: process.platform,
    isExecutable: isExecutableFile,
  }),
  dir: path.join(userData, "search"),
  searchIndex,
  listNotes,
  log: (message, detail) => console.log(message, detail ?? ""),
});

// The data location can change in Settings; the search index follows it.
const api: CompositionApi = {
  ...service,
  async saveSettings(input) {
    const result = await service.saveSettings(input);
    if (result.success) void sidecar.reindex();
    return result;
  },
};

const themeBackgroundKey = (theme: ThemeName) => (theme === "auto" ? "dark" : theme);

function openMainWindow(): BrowserWindow {
  return createMainWindow({
    preloadPath: path.join(__dirname, "preload.js"),
    entryUrl: devUrl ?? `${APP_ORIGIN}/`,
    allowedOrigins,
    // "auto" opens as the dark or light end of its ramp, per the cached sun times.
    theme: service.initialSunTheme()?.tone ?? themeBackgroundKey(loadWebSettings().theme),
  });
}

async function main(): Promise<void> {
  // A second launch would fight over the same database and search index.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  await app.whenReady();

  registerAppProtocol(path.join(__dirname, "renderer"));
  registerIpc({
    ipcMain,
    api,
    isTrustedUrl: (url) => isTrustedUrl(url, allowedOrigins),
    initial: () => {
      const { theme, sidebarWidth, editorRatio } = loadWebSettings();
      return { theme, layout: { sidebarWidth, editorRatio }, sun: service.initialSunTheme() };
    },
  });

  // Search comes up in the background; the window doesn't wait for it.
  void sidecar.start();
  openMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Stop Meilisearch and close the database cleanly before exiting, so no
// orphaned server is left holding the index and the WAL is checkpointed.
let shuttingDown = false;
app.on("before-quit", (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  void sidecar.stop().finally(() => {
    closeDb();
    app.quit();
  });
});

main().catch((error) => {
  console.error("Composition failed to start:", error);
  app.exit(1);
});
