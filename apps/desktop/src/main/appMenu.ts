/**
 * Where the app's own menu items go ("Check for Updates…", "Install Command Line Tool…").
 *
 * On macOS they sit in the application menu, the first menu, after "About". Linux has no application
 * menu: the same items go at the end of the Help menu, as most Linux apps do. "Import PDF…" is a file
 * action, so it goes at the top of the File menu on every platform. No Electron imports: the callers pass
 * menu entries, so the placement is tested on plain objects.
 */

export type MenuEntry = { label?: string; role?: string };

/** Which top-level menu holds the app's items; -1 if the platform has none (the item is then left out). */
export function appMenuIndex(topLevel: MenuEntry[], platform: NodeJS.Platform): number {
  if (platform === "darwin") return topLevel.length > 0 ? 0 : -1;
  if (platform === "linux") return topLevel.findIndex((entry) => entry.role?.toLowerCase() === "help");
  return -1;
}

/** Where in that menu the item goes: right after `after` (a label) when it is there, else after "About" on macOS, else last. */
export function insertionIndex(entries: MenuEntry[], platform: NodeJS.Platform, after?: string): number {
  const afterLabel = after ? entries.findIndex((entry) => entry.label === after) : -1;
  if (afterLabel >= 0) return afterLabel + 1;
  if (platform === "darwin") return entries.findIndex((entry) => entry.role === "about") + 1;
  return entries.length;
}

/** Which top-level menu is File (Electron's default menu has one on every platform); -1 if there is none, and the item is left out. */
export function fileMenuIndex(topLevel: MenuEntry[]): number {
  const byRole = topLevel.findIndex((entry) => entry.role?.toLowerCase() === "filemenu");
  return byRole >= 0 ? byRole : topLevel.findIndex((entry) => entry.label === "File");
}

/** Where "Import PDF…" goes in the File menu: first, above "Close Window" or "Quit", with a separator after it. */
export const FILE_MENU_IMPORT_INDEX = 0;
