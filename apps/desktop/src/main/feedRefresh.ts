/**
 * Keeps the RSS Reader's feeds fresh while the app is open (docs/rss-reader-plan.md, D9, D10). The timer only ticks; each
 * tick asks whether the plugin is on and a window is open, so turning the plugin off, or closing every window, stops the
 * fetching at the next tick without any timer to take down.
 */

/** About every half hour. */
export const FEED_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export type FeedRefreshDeps = {
  /** Whether the RSS Reader plugin is on now. */
  enabled: () => boolean;
  /** Whether a window is open: on macOS the app can outlive its windows, and nobody is reading then. */
  hasWindow: () => boolean;
  refreshAll: () => Promise<unknown>;
  intervalMs?: number;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
};

/** Starts the timer; returns a function that stops it. A tick that finds the last refresh still running does nothing. */
export function startFeedRefresh(deps: FeedRefreshDeps): () => void {
  const set = deps.setInterval ?? ((callback, ms) => globalThis.setInterval(callback, ms));
  const clear = deps.clearInterval ?? ((handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>));
  let running = false;
  const handle = set(() => {
    if (running || !deps.enabled() || !deps.hasWindow()) return;
    running = true;
    deps.refreshAll().catch(() => {}).finally(() => (running = false));
  }, deps.intervalMs ?? FEED_REFRESH_INTERVAL_MS);
  // The timer must not keep the process alive on its own.
  (handle as { unref?: () => void } | null)?.unref?.();
  return () => clear(handle);
}
