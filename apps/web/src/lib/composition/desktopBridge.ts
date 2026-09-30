import type { CompositionApi } from "./api";
import type { Layout } from "./layout";
import type { ThemeName } from "./themes";

/**
 * What Electron's preload script exposes on `window.composition` (apps/desktop).
 * Everything in CompositionApi, plus a synchronous snapshot taken before the
 * page paints so the first frame already has the right color scheme.
 */
export type DesktopBridge = CompositionApi & {
  readonly initial: { theme: ThemeName; layout: Layout };
  readonly platform: string;
};

declare global {
  interface Window {
    composition?: DesktopBridge;
  }
}
