import { Menu, MenuItem } from "electron";
import { fileMenuIndex, FILE_MENU_IMPORT_INDEX } from "./appMenu";

/** The id the menu item has, which the smoke test uses to find it. */
export const IMPORT_PDF_MENU_ID = "import-pdf";

/**
 * "Import PDF…" at the top of the File menu, with a separator under it. What it does is in importPdfRequest.ts; this only
 * places it in Electron's default menu.
 */
export function installImportPdfMenuItem(onClick: () => void): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const at = fileMenuIndex(menu.items);
  const fileMenu = at >= 0 ? menu.items[at].submenu : null;
  if (!fileMenu) return;
  fileMenu.insert(FILE_MENU_IMPORT_INDEX, new MenuItem({ type: "separator" }));
  fileMenu.insert(FILE_MENU_IMPORT_INDEX, new MenuItem({ id: IMPORT_PDF_MENU_ID, label: "Import PDF…", click: onClick }));
  Menu.setApplicationMenu(menu);
}
