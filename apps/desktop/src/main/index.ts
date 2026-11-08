import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, screen, session, shell, utilityProcess } from "electron";
import { broadcastAppearance, notifyAppearanceChanges, notifyTranslucencyChange, type AppearanceMessage } from "./appearance";
import { createAttachmentsApi } from "./attachments";
import { createBackupApi } from "./backup";
import { createDocumentsApi } from "./documents";
import { runExport, workerPath } from "./exportProcess";
import { installCliToolMenuItem } from "./cliToolMenu";
import { installContextMenu } from "./contextMenu";
import { installEmbedReferer } from "./embedReferer";
import { closeDb, contactsService, defaultSharedLocationPath, feedsService, indexReportNotes, listNotes, loadWebSettings, panelsService, readingListService, runTodoCycle, searchIndex, service, todosService, type CompositionApi, type ThemeName } from "./backend";
import { createAssistantHost } from "./assistant";
import { fetchFeedText } from "./feedFetcher";
import { startFeedRefresh } from "./feedRefresh";
import { createFeedsController } from "./feedsController";
import { flushRenderers } from "./flushRenderers";
import { isTrustedUrl, registerIpc } from "./ipc";
import { originOf } from "./origin";
import { READING_LIST_PARTITION } from "../../../web/src/lib/composition/readingListApi";
import { APP_ORIGIN, registerAppProtocol, registerSchemePrivileges } from "./protocol";
import { isExecutableFile, resolveMeiliBinary, SearchSidecar } from "./search";
import { createElectronUpdates } from "./updater";
import { clearReadingData, installReadingListGuard } from "./readingListGuard";
import { createPopoutManager } from "./popoutManager";
import { broadcastTodosChanged, createTodoCycleRunner, notifyTodoReports } from "./todoCycleRunner";
import { createWindowPrefsStore, createWindowTranslucency } from "./translucency";
import { createWindowState } from "./windowState";
import { createMainWindow, THEME_BACKGROUND } from "./window";

app.setName("Composition");
app.setAboutPanelOptions({
  applicationName: "Composition",
  copyright: "Copyright © Composition contributors",
  credits:
    "Includes Meilisearch (MIT), Node.js (MIT) for the command line tool, Electron and Chromium. License notices are in the app bundle's Resources/licenses folder.",
});
// Before the app is ready, as Electron requires for custom schemes.
registerSchemePrivileges();

// This app keeps its own settings file under Electron's per-app data folder
// (the web app and CLI have theirs). The notes database itself is shared and
// lives in ~/.composition by default (docs/product-builds.md).
const userData = app.getPath("userData");
process.env.COMPOSITION_SETTINGS_PATH = path.join(userData, "settings.json");
// The data location alone is agreed with the terminal app, which shares the database, so a
// move made in either one is followed by the other (docs/product-builds.md).
process.env.COMPOSITION_SHARED_LOCATION_PATH = defaultSharedLocationPath(app.getPath("home"));

// Images stay on this machine, so the web app's upload size limit does not apply.
service.setMaxImageBytes(null);

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

/** How the app looks now: what a window's first paint is given, and what the others are told when Settings changes it. */
function currentAppearance(): AppearanceMessage {
  const { theme, previewFont, editorFont, noteBackground, sunPair } = loadWebSettings();
  return { theme, previewFont, editorFont, noteBackground, sunPair, translucent: translucency.isActive(), opacity: translucency.opacity(), sun: service.initialSunTheme() };
}

/** Tells every open window how the app looks now. */
function announceAppearance(): void {
  broadcastAppearance(BrowserWindow.getAllWindows(), currentAppearance());
}

// The data location can change in Settings; the search index follows it. So does the look of every window: Settings
// is a page in one window, and pop-outs and the rest follow what is chosen there.
const api: CompositionApi = notifyAppearanceChanges(
  {
    ...service,
    async saveSettings(input) {
      const result = await service.saveSettings(input);
      if (result.success) void sidecar.reindex();
      return result;
    },
  },
  announceAppearance,
);

// Files are chosen and saved in native dialogs, over the window that asked.
const attachments = createAttachmentsApi(service, {
  async pickFiles() {
    const options = { properties: ["openFile", "multiSelections"] as ("openFile" | "multiSelections")[] };
    const parent = BrowserWindow.getFocusedWindow();
    const { canceled, filePaths } = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return canceled ? [] : filePaths;
  },
  async pickSavePath(defaultName) {
    const options = { defaultPath: defaultName };
    const parent = BrowserWindow.getFocusedWindow();
    const { canceled, filePath } = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    return canceled || !filePath ? null : filePath;
  },
  reveal: (file) => shell.showItemInFolder(file),
});

// A PDF to import is chosen in a native dialog too; the page is only told which note and PDF came of it. Exporting one asks
// for the file to save in a native dialog, and writes it in a utility process (exportProcess.ts).
const documents = createDocumentsApi(service, {
  async pickExportPath(defaultName) {
    const options = { defaultPath: defaultName, filters: [{ name: "PDF", extensions: ["pdf"] }] };
    const parent = BrowserWindow.getFocusedWindow();
    const { canceled, filePath } = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    return canceled || !filePath ? null : filePath;
  },
  exportPdf: (job) =>
    runExport(() => utilityProcess.fork(workerPath(__dirname), [], { serviceName: "Composition PDF export", stdio: "ignore" }), job),
  async pickPdf() {
    const options = {
      properties: ["openFile"] as "openFile"[],
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    };
    const parent = BrowserWindow.getFocusedWindow();
    const { canceled, filePaths } = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return canceled || filePaths.length === 0 ? null : filePaths[0];
  },
});

// Where a backup is saved, and which one is restored, are also chosen in native dialogs.
const backup = createBackupApi(service, {
  async pickSavePath(defaultName) {
    const options = { defaultPath: path.join(app.getPath("documents"), defaultName), filters: [{ name: "Composition backup", extensions: ["gz"] }] };
    const parent = BrowserWindow.getFocusedWindow();
    const { canceled, filePath } = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options);
    return canceled || !filePath ? null : filePath;
  },
  async pickBackupFile() {
    const options = {
      properties: ["openFile"] as "openFile"[],
      defaultPath: app.getPath("documents"),
      filters: [{ name: "Composition backup", extensions: ["gz"] }],
    };
    const parent = BrowserWindow.getFocusedWindow();
    const { canceled, filePaths } = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return canceled || filePaths.length === 0 ? null : filePaths[0];
  },
});

/** How long quitting waits for the pages to send their unsaved text before it goes ahead without them. */
const FLUSH_TIMEOUT_MS = 2000;

// Stopping Meilisearch and closing the database, once, whichever way the app quits: Cmd+Q, the
// last window closing, or restarting into an update (which calls this itself, ahead of
// quitAndInstall, so the installer never meets a prevented `before-quit`).
let shutdown: Promise<void> | undefined;
let shutdownDone = false;
function shutDown(): Promise<void> {
  shutdown ??= (async () => {
    try {
      todoCycle.stop();
      // The pages go first: once the database is closed, what they still hold (text typed in the last moments, which
      // waits half a second to be saved) could no longer be, as their own unload comes too late.
      await flushRenderers(BrowserWindow.getAllWindows(), FLUSH_TIMEOUT_MS);
      // Quitting closes every window, and a pop-out that is closed (rather than destroyed) tells the workspace its
      // window is gone, which would drop it from the saved layout. Destroyed, it comes back at the next launch.
      popouts.destroyAll();
      await sidecar.stop();
    } finally {
      closeDb();
      shutdownDone = true;
    }
  })();
  return shutdown;
}

const updates = createElectronUpdates({ userData, prepareToQuit: shutDown });

// The to-do list's weekly cycle: weeks that have ended are closed as the app starts (before the first window reads the list)
// and then every hour, and every window is told when that changed the list.
const announceTodos = () => broadcastTodosChanged(BrowserWindow.getAllWindows());
const todoCycle = createTodoCycleRunner({
  run: () => runTodoCycle(),
  announce: announceTodos,
  indexReports: (noteIds) => void indexReportNotes(noteIds),
  log: (message, detail) => console.log(message, detail ?? ""),
});

const themeBackgroundKey = (theme: ThemeName) => (theme === "auto" ? "dark" : theme);

// "auto" opens as the dark or light end of its ramp, per the cached sun times.
const currentThemeKey = () => service.initialSunTheme()?.tone ?? themeBackgroundKey(loadWebSettings().theme);

// The macOS see-through look of the windows (a setting; see translucency.ts).
const translucency = createWindowTranslucency({
  platform: process.platform,
  prefs: createWindowPrefsStore(path.join(userData, "window.json")),
  windows: () => BrowserWindow.getAllWindows(),
  solidBackground: () => THEME_BACKGROUND[currentThemeKey()] ?? THEME_BACKGROUND.dark,
});

// The Reading List's pages live in a session of their own, apart from the app's UI (cookies, cache, storage).
const readingSession = () => session.fromPartition(READING_LIST_PARTITION);

/** What every window gets so its page may hold a Reading List web view, and only while the plugin is on. */
function attachReadingListGuard(webContents: Parameters<typeof installReadingListGuard>[0]): void {
  installReadingListGuard(webContents, {
    // Read from the settings file at each attach, so switching the plugin off takes effect without a restart.
    pluginEnabled: () => loadWebSettings().plugins["reading-list"],
    openExternal: (url) => void shell.openExternal(url),
    readingSession,
  });
}

// The RSS Reader's feeds: fetched here (the renderer has no network access), only while the plugin is on. A fetch from this
// computer's own addresses is refused; only an unpackaged build started with COMPOSITION_FEEDS_ALLOW_PRIVATE=1 (the smoke
// test, which serves a feed from 127.0.0.1) lifts that.
const feeds = createFeedsController({
  store: feedsService,
  fetchFeed: (url, validators) =>
    fetchFeedText(url, validators, {
      fetch,
      lookup: async (hostname) => (await dns.lookup(hostname, { all: true })).map(({ address }) => address),
      allowPrivate: !app.isPackaged && process.env.COMPOSITION_FEEDS_ALLOW_PRIVATE === "1",
      userAgent: `Composition/${app.getVersion()}`,
    }),
  pluginEnabled: () => loadWebSettings().plugins.rss,
});

// Pop-outs: a panel pulled into a window of its own. The main window's page opens them; this decides that they may be
// opened, remembers where each was put (in a file only this process writes) and closes them with the main window.
const popouts = createPopoutManager({
  allowedOrigins,
  preloadPath: path.join(__dirname, "preload.js"),
  backgroundColor: () => translucency.backgroundColor(),
  translucent: () => translucency.isActive(),
  windowState: createWindowState({
    file: path.join(userData, "window-state.json"),
    displays: () => screen.getAllDisplays().map((display) => display.workArea),
  }),
  openExternal: (url) => void shell.openExternal(url),
  installContextMenu,
  installReadingListGuard: attachReadingListGuard,
});

function openMainWindow(): BrowserWindow {
  return createMainWindow({
    preloadPath: path.join(__dirname, "preload.js"),
    entryUrl: devUrl ?? `${APP_ORIGIN}/`,
    allowedOrigins,
    theme: currentThemeKey(),
    translucent: translucency.isActive(),
    popouts,
    installReadingListGuard: attachReadingListGuard,
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

  // Built, the editor is part of the renderer export; under `pnpm dev` there is none, so it is read from where it was fetched.
  const builtEditor = path.join(__dirname, "renderer", "drawio");
  registerAppProtocol(path.join(__dirname, "renderer"), service.readImage, (id) => service.findDocumentFile(id)?.path ?? null, {
    root: fs.existsSync(builtEditor) ? builtEditor : path.resolve(__dirname, "..", "..", "web", "public", "drawio"),
    parentOrigins: [APP_ORIGIN, ...(devOrigin ? [devOrigin] : [])],
  });
  installEmbedReferer(session.defaultSession.webRequest);
  registerIpc({
    ipcMain,
    api,
    attachments,
    documents,
    backup,
    panels: panelsService,
    todos: notifyTodoReports(todosService, announceTodos),
    // Clearing is the one call that needs a browser session, which only this process has.
    readingList: { ...readingListService, clearReadingData: () => clearReadingData(readingSession()) },
    contacts: contactsService,
    feeds,
    updates: updates.manager,
    window: notifyTranslucencyChange(translucency, announceAppearance),
    assistant: createAssistantHost({ stream: service.streamAssistantChat }),
    isTrustedUrl: (url) => isTrustedUrl(url, allowedOrigins),
    initial: () => {
      const { sidebarWidth, editorRatio } = loadWebSettings();
      return { ...currentAppearance(), layout: { sidebarWidth, editorRatio } };
    },
  });

  // Search comes up in the background; the window doesn't wait for it.
  void sidecar.start();
  // Before the window, so a week that ended while the app was closed is already closed when the list is first read.
  todoCycle.start();
  openMainWindow();
  startFeedRefresh({
    enabled: () => loadWebSettings().plugins.rss,
    hasWindow: () => BrowserWindow.getAllWindows().length > 0,
    refreshAll: () => feeds.refreshAllFeeds(),
  });
  updates.installMenuItem();
  installCliToolMenuItem({ packaged: app.isPackaged, resourcesPath: process.resourcesPath });
  updates.manager.start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Stop Meilisearch and close the database cleanly before exiting, so no
// orphaned server is left holding the index and the WAL is checkpointed.
app.on("before-quit", (event) => {
  if (shutdownDone) return;
  event.preventDefault();
  updates.manager.stop();
  void shutDown().finally(() => app.quit());
});

main().catch((error) => {
  console.error("Composition failed to start:", error);
  app.exit(1);
});
