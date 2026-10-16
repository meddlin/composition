import path from "node:path";
import { app, BrowserWindow, dialog, Menu, MenuItem } from "electron";
import { autoUpdater } from "electron-updater";
import { UPDATE_STATE_CHANNEL } from "../shared/channels";
import { createUpdatePrefsStore } from "./updatePrefs";
import { findLatestRelease, STABLE_FEED_URL } from "./releaseFeed";
import { UpdateManager, type UpdaterLike } from "./updates";

/**
 * The Electron side of updates: picks the real updater (or an inert one), pushes state to
 * the windows, and adds "Check for Updates…" to the app menu. The logic is in updates.ts.
 * The feed it reads is fixed at build time (`publish` in electron-builder.yml, which
 * electron-builder copies into the app as app-update.yml). The one other place it can read from
 * is a GitHub release of this repo, found by releaseFeed.ts when "Include pre-release versions"
 * is on; no URL ever comes from a window.
 */

/** Stands in where updating is impossible (development runs), so electron-updater is never touched. */
const inertUpdater: UpdaterLike = {
  autoDownload: false,
  autoInstallOnAppQuit: false,
  allowPrerelease: false,
  setFeedURL: () => {},
  checkForUpdates: async () => null,
  downloadUpdate: async () => [],
  quitAndInstall: () => {},
  on: () => undefined,
};

function supportFor(packaged: boolean, platform: NodeJS.Platform): { ok: true } | { ok: false; reason: string } {
  if (!packaged) return { ok: false, reason: "Updates only work in the installed app, not in a development run." };
  if (platform !== "darwin") return { ok: false, reason: "Automatic updates are only available on macOS for now." };
  return { ok: true };
}

export function createElectronUpdates(options: {
  /** Electron's per-app data folder; the update preference lives there. */
  userData: string;
  /** Stops Meilisearch and closes the database; see UpdateManagerOptions.prepareToQuit. */
  prepareToQuit: () => Promise<void>;
}) {
  const support = supportFor(app.isPackaged, process.platform);

  const manager = new UpdateManager({
    // `autoUpdater` builds the real updater on first access, so it is only read when it's usable.
    updater: support.ok ? autoUpdater : inertUpdater,
    currentVersion: app.getVersion(),
    support,
    prefs: createUpdatePrefsStore(path.join(options.userData, "updates.json")),
    prepareToQuit: options.prepareToQuit,
    releaseFeed: support.ok ? { findLatest: () => findLatestRelease(), stableUrl: STABLE_FEED_URL } : undefined,
    onChange: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(UPDATE_STATE_CHANNEL, state);
      }
    },
    log: (message, detail) => console.log(message, detail ?? ""),
  });

  const parentWindow = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];

  async function say(message: string, detail: string, buttons: string[] = ["OK"]): Promise<number> {
    const parent = parentWindow();
    const box = { type: "info" as const, message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 };
    const { response } = parent ? await dialog.showMessageBox(parent, box) : await dialog.showMessageBox(box);
    return response;
  }

  async function offerRestart(version: string | undefined): Promise<void> {
    const choice = await say(
      `Version ${version} is ready to install.`,
      "Composition will restart to finish the update. Your notes are not affected.",
      ["Restart now", "Later"],
    );
    if (choice === 0) await manager.installUpdate();
  }

  /** "Check for Updates…" in the app menu: the same machine, with the answer in a dialog. */
  async function checkFromMenu(): Promise<void> {
    let state = await manager.checkForUpdates();
    if (!state.supported) return void (await say("Updates are not available.", state.unsupportedReason ?? ""));

    if (state.phase === "available") {
      const choice = await say(
        `Version ${state.version} is available.`,
        `You have ${state.currentVersion}.${state.releaseNotes ? `\n\n${state.releaseNotes}` : ""}`,
        ["Download", "Later"],
      );
      if (choice !== 0) return;
      state = await manager.downloadUpdate();
    }

    if (state.phase === "ready") return offerRestart(state.version);
    if (state.phase === "error") {
      const title = state.version ? "Couldn't download the update." : "Couldn't check for updates.";
      return void (await say(title, state.error ?? "Something went wrong. Please try again later."));
    }
    await say("Already running the latest supported version.", `You have ${state.currentVersion}.`);
  }

  /** Adds "Check for Updates…" under "About Composition", in Electron's default application menu. */
  function installMenuItem(): void {
    if (process.platform !== "darwin") return;
    const menu = Menu.getApplicationMenu();
    const appMenu = menu?.items[0]?.submenu;
    if (!menu || !appMenu) return;
    const aboutAt = appMenu.items.findIndex((entry) => entry.role === "about");
    appMenu.insert(aboutAt + 1, new MenuItem({ label: "Check for Updates…", click: () => void checkFromMenu() }));
    Menu.setApplicationMenu(menu);
  }

  return { manager, installMenuItem };
}
