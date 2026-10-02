import type { CompositionApi } from "./api";
import type { AttachmentsApi } from "./attachmentsApi";
import type { DesktopBackupApi } from "./backupApi";
import type { Layout } from "./layout";
import type { ThemeName } from "./themes";

/**
 * What Electron's preload script exposes on `window.composition` (apps/desktop).
 * Everything in CompositionApi, plus the desktop-only AttachmentsApi and DesktopBackupApi, plus a
 * synchronous snapshot taken before the page paints so the first frame already
 * has the right color scheme.
 */
export type DesktopBridge = CompositionApi &
  AttachmentsApi &
  DesktopBackupApi & {
    readonly initial: {
      theme: ThemeName;
      layout: Layout;
      /** Present for the "auto" scheme: where on the sunrise/sunset ramp the first frame starts. */
      sun?: { tone: "light" | "dark"; autoLight: string };
    };
    readonly platform: string;
  };

declare global {
  interface Window {
    composition?: DesktopBridge;
  }
}
