import fs from "node:fs";
import path from "node:path";

/**
 * The `composition` command that ships inside the app (Contents/Resources/cli/composition) and
 * the symlink that puts it on the PATH. A disk image can only copy the app, so the link is made
 * by an app menu item, as editors do for their `code` command. No administrator password: the
 * link goes in the first of a few directories the user can already write to.
 *
 * Everything here takes its directories as arguments, so the tests run on temporary folders.
 */

export const COMMAND_NAME = "composition";

/** Where the link may go, best first. The last is created on demand; the others only if they exist and are writable. */
export function linkDirectories(home: string): string[] {
  return ["/opt/homebrew/bin", "/usr/local/bin", path.join(home, ".local", "bin")];
}

export function launcherPath(resourcesPath: string): string {
  return path.join(resourcesPath, "cli", COMMAND_NAME);
}

/** A copy of the app that won't stay put (a mounted disk image, or Gatekeeper's temporary copy) can't be linked to. */
export function locationProblem(launcher: string): string | null {
  if (launcher.includes("/AppTranslocation/") || launcher.startsWith("/Volumes/")) {
    return "Composition is running from a disk image or another volume. Drag it to the Applications folder, open it from there, and try again.";
  }
  return null;
}

export type LinkState =
  | { kind: "missing" }
  /** The link points at this app's launcher. */
  | { kind: "installed"; link: string }
  /** The name is ours but points at another copy of the app, or at nothing: safe to replace. */
  | { kind: "elsewhere"; link: string }
  /** Something else owns the name; never touched. */
  | { kind: "occupied"; link: string };

function inspectLink(link: string, launcher: string): LinkState {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(link);
  } catch {
    return { kind: "missing" };
  }
  if (!stat.isSymbolicLink()) return { kind: "occupied", link };
  const target = path.resolve(path.dirname(link), fs.readlinkSync(link));
  if (target === launcher) return { kind: "installed", link };
  const oursInAnotherApp = target.endsWith(`/Contents/Resources/cli/${COMMAND_NAME}`);
  return oursInAnotherApp || !fs.existsSync(target) ? { kind: "elsewhere", link } : { kind: "occupied", link };
}

/** The state of the command across all candidate directories: installed beats elsewhere beats occupied beats missing. */
export function inspect(dirs: string[], launcher: string): LinkState {
  const states = dirs.map((dir) => inspectLink(path.join(dir, COMMAND_NAME), launcher));
  for (const kind of ["installed", "elsewhere", "occupied"] as const) {
    const found = states.find((state) => state.kind === kind);
    if (found) return found;
  }
  return { kind: "missing" };
}

function isWritableDirectory(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Where a new link would go: the first existing writable directory, else the last (created if needed). */
export function chooseDirectory(dirs: string[]): string {
  return dirs.slice(0, -1).find(isWritableDirectory) ?? dirs[dirs.length - 1];
}

export type InstallResult =
  | { ok: true; link: string; alreadyInstalled: boolean }
  | { ok: false; reason: string };

export function install(dirs: string[], launcher: string): InstallResult {
  const problem = locationProblem(launcher);
  if (problem) return { ok: false, reason: problem };
  if (!fs.existsSync(launcher)) return { ok: false, reason: "This copy of Composition doesn't include the command line tool." };

  const state = inspect(dirs, launcher);
  if (state.kind === "installed") return { ok: true, link: state.link, alreadyInstalled: true };
  if (state.kind === "occupied") {
    return { ok: false, reason: `${state.link} already exists and isn't a link to Composition. Remove or rename it, then try again.` };
  }

  const link = state.kind === "elsewhere" ? state.link : path.join(chooseDirectory(dirs), COMMAND_NAME);
  try {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    if (state.kind === "elsewhere") fs.unlinkSync(link);
    fs.symlinkSync(launcher, link);
  } catch (error) {
    return { ok: false, reason: `Couldn't create ${link}: ${(error as Error).message}` };
  }
  return { ok: true, link, alreadyInstalled: false };
}

export type UninstallResult = { ok: true; removed: string[] } | { ok: false; reason: string };

/** Removes the command wherever it is a link to a copy of this app; never touches anything else of that name. */
export function uninstall(dirs: string[], launcher: string): UninstallResult {
  const removed: string[] = [];
  for (const dir of dirs) {
    const link = path.join(dir, COMMAND_NAME);
    const state = inspectLink(link, launcher);
    if (state.kind !== "installed" && state.kind !== "elsewhere") continue;
    try {
      fs.unlinkSync(link);
      removed.push(link);
    } catch (error) {
      return { ok: false, reason: `Couldn't remove ${link}: ${(error as Error).message}` };
    }
  }
  return { ok: true, removed };
}

/** True if `dir` is on the PATH string given (a login shell's, since a Finder-launched app has a short one). */
export function isOnPath(dir: string, pathValue: string): boolean {
  return pathValue.split(path.delimiter).includes(dir);
}
