import { IMPORT_PDF_CHANNEL } from "../shared/channels";

/** The slice of the main window this needs, so tests don't need Electron. */
export type RequestWindow = {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  webContents: { send(channel: string, ...args: unknown[]): void };
};

/**
 * What File > Import PDF… does. The menu is the app's, not a window's, and the page decides where a PDF goes (the group and
 * notebook its sidebar is on), so this only tells the main window's page to start the import it would start for its own
 * button, after bringing that window forward (a pop-out may be the one in front). The page then asks the main process to open
 * the picker, so the renderer still never names a path. With no main window open (macOS keeps the menu after the last window
 * closes) it opens one, as clicking the Dock icon would; a window that has just opened has not loaded its page yet, so the
 * import is for the next click.
 */
export function requestImportPdf(options: { mainWindow: () => RequestWindow | null; openMainWindow: () => void }): void {
  const window = options.mainWindow();
  if (!window || window.isDestroyed()) {
    options.openMainWindow();
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  window.webContents.send(IMPORT_PDF_CHANNEL);
}
