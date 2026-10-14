import type { CompositionApi } from "./api";
import type { AttachmentsApi } from "./attachmentsApi";
import type { DesktopBackupApi } from "./backupApi";
import type { Layout } from "./layout";
import type { ThemeName } from "./themes";
import type { UpdatesApi, UpdateStateListener } from "./updatesApi";

/**
 * What Electron's preload script exposes on `window.composition` (apps/desktop).
 * Everything in CompositionApi, plus the desktop-only AttachmentsApi, DesktopBackupApi and UpdatesApi, plus a
 * synchronous snapshot taken before the page paints so the first frame already
 * has the right color scheme.
 */
export type DesktopBridge = CompositionApi &
  AttachmentsApi &
  DesktopBackupApi &
  UpdatesApi & {
    /** Calls `listener` with each update state the app pushes; returns the function that stops listening. */
    onUpdateState(listener: UpdateStateListener): () => void;
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
