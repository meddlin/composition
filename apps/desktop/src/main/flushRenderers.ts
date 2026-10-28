type WindowLike = { isDestroyed(): boolean; webContents: { executeJavaScript(code: string): Promise<unknown> } };

/**
 * Run in each page: the one that holds the workspace (the main window's) sends what was typed but is still inside the
 * autosave delay, and answers once the saves have been made. Any other page has no workspace and answers at once.
 * The code is in the page's own world, which is where the workspace is published (see `popoutLink.ts`).
 */
export const FLUSH_SCRIPT = "Promise.resolve(window.__workspace && window.__workspace.store.flushSaves()).then(() => undefined)";

/**
 * Asks every window to send its unsaved text, and waits (up to `timeoutMs`, so a window that never answers cannot stop
 * the app quitting) for it to be saved. Run before the database is closed: after that, a page that is closing can no
 * longer save anything.
 */
export async function flushRenderers(windows: readonly WindowLike[], timeoutMs: number): Promise<void> {
  const asks = windows
    .filter((window) => !window.isDestroyed())
    .map((window) => window.webContents.executeJavaScript(FLUSH_SCRIPT).then(
      () => undefined,
      () => undefined, // a page that is already gone has nothing to send
    ));

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)));
  try {
    await Promise.race([Promise.all(asks), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
