import { useSyncExternalStore } from "react";

// Whether this is the desktop app never changes, so there is nothing to subscribe to. The server snapshot is "no", so
// the first render matches the server's and the desktop-only parts appear on hydration.
const subscribeNever = () => () => {};
// The desktop app's preload script is what puts `composition` on the page.
const clientIsDesktop = () => "composition" in window;
const serverIsDesktop = () => false;

/** Whether the page is in the desktop app (the web app has no panels, and so none of their commands). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeNever, clientIsDesktop, serverIsDesktop);
}
