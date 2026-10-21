import { useSyncExternalStore } from "react";

// The platform never changes, so there is nothing to subscribe to. The server snapshot is
// non-Mac, so the first render matches the server's and the Mac glyphs appear on hydration.
const subscribeNever = () => () => {};
const clientIsMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const serverIsMac = () => false;

/** Whether "Mod" is Cmd here (macOS, iOS) rather than Ctrl. */
export function useIsMac(): boolean {
  return useSyncExternalStore(subscribeNever, clientIsMac, serverIsMac);
}
