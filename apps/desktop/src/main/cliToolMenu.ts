import os from "node:os";
import path from "node:path";
import { BrowserWindow, dialog, Menu, MenuItem } from "electron";
import { appMenuIndex, insertionIndex } from "./appMenu";
import { chooseDirectory, COMMAND_NAME, inspect, install, isOnPath, launcherPath, linkDirectories, uninstall } from "./cliTool";

/**
 * "Install Command Line Tool…" in the app menu: links the bundled `composition` command onto
 * the PATH, or removes the link. The logic and its tests are in cliTool.ts; this is the dialogs.
 */
export function installCliToolMenuItem(options: { packaged: boolean; resourcesPath: string }): void {
  // A development run has no bundled command line tool to link to.
  if (!options.packaged) return;
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const at = appMenuIndex(menu.items, process.platform);
  const appMenu = at >= 0 ? menu.items[at].submenu : null;
  if (!appMenu) return;

  const launcher = launcherPath(options.resourcesPath);
  const dirs = linkDirectories(os.homedir());

  async function say(type: "info" | "error", message: string, detail: string, buttons: string[] = ["OK"]): Promise<number> {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const box = { type, message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 };
    const { response } = parent ? await dialog.showMessageBox(parent, box) : await dialog.showMessageBox(box);
    return response;
  }

  async function onClick(): Promise<void> {
    const state = inspect(dirs, launcher);

    if (state.kind === "installed") {
      const choice = await say("info", "The command line tool is installed.", `Run “${COMMAND_NAME}” in Terminal.\n\n${state.link}`, ["Uninstall", "OK"]);
      if (choice !== 0) return;
      const result = uninstall(dirs, launcher);
      if (!result.ok) return void (await say("error", "Couldn't uninstall the command line tool.", result.reason));
      return void (await say("info", "The command line tool was removed.", result.removed.join("\n")));
    }

    const destination = state.kind === "elsewhere" ? state.link : path.join(chooseDirectory(dirs), COMMAND_NAME);
    const choice = await say(
      "info",
      `Install the “${COMMAND_NAME}” command?`,
      `This adds a link at ${destination} so you can run Composition's terminal app from any Terminal window. Composition includes everything it needs, including its own copy of Node.`,
      ["Install", "Cancel"],
    );
    if (choice !== 0) return;

    const result = install(dirs, launcher);
    if (!result.ok) return void (await say("error", "Couldn't install the command line tool.", result.reason));

    const dir = path.dirname(result.link);
    const hint = isOnPath(dir, process.env.PATH ?? "")
      ? ""
      : `\n\n${dir} may not be on your PATH. If “${COMMAND_NAME}” isn't found, add this line to ${process.platform === "linux" ? "~/.profile" : "~/.zshrc"} and open a new Terminal window:\n\nexport PATH="${dir}:$PATH"`;
    await say("info", "The command line tool is installed.", `Run “${COMMAND_NAME}” in Terminal.\n\n${result.link}${hint}`);
  }

  appMenu.insert(
    insertionIndex(appMenu.items, process.platform, "Check for Updates…"),
    new MenuItem({ label: "Install Command Line Tool…", click: () => void onClick() }),
  );
  Menu.setApplicationMenu(menu);
}
