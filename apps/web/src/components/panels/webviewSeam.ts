import type { ComponentType, Ref } from "react";

/** What the Reading List panel learns from the page in its web view as it loads and is navigated. */
export type WebviewState = {
  /** The address now showing (after redirects and links followed). */
  url: string;
  /** The page's own title, once it has said. */
  title: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  /** Why the page could not load, or null. */
  failure: string | null;
};

/** What the panel can ask of the web view. Back and forward are the view's own history; they never touch the list. */
export type WebviewHandle = {
  back(): void;
  forward(): void;
  reload(): void;
};

export type WebviewProps = {
  /** Where the view starts. Changing it does not navigate: the panel gives each link a view of its own (a `key`). */
  src: string;
  onChange: (state: Partial<WebviewState>) => void;
  handle: Ref<WebviewHandle>;
};

/**
 * The seam between the panel and Electron's `<webview>` tag (the only thing in the panel that is not plain React), so the
 * panel can be tested with a fake: jsdom has no `<webview>`.
 */
export type WebviewComponent = ComponentType<WebviewProps>;
