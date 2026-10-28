import type { CompositionApi } from "./api";
import type { AssistantEventListener, AssistantStreamApi } from "./assistantApi";
import type { AppearanceListener, AppearanceMessage } from "./appearanceApi";
import type { AttachmentsApi } from "./attachmentsApi";
import type { DesktopBackupApi } from "./backupApi";
import type { PanelsApi } from "./panelsApi";
import type { Layout } from "./layout";
import type { UpdatesApi, UpdateStateListener } from "./updatesApi";
import type { WindowApi } from "./windowApi";

/**
 * What Electron's preload script exposes on `window.composition` (apps/desktop).
 * Everything in CompositionApi, plus the desktop-only AttachmentsApi, DesktopBackupApi, PanelsApi, UpdatesApi, WindowApi and AssistantStreamApi, plus a
 * synchronous snapshot taken before the page paints so the first frame already
 * has the right color scheme.
 */
export type DesktopBridge = CompositionApi &
  AttachmentsApi &
  DesktopBackupApi &
  PanelsApi &
  UpdatesApi &
  WindowApi &
  AssistantStreamApi & {
    /** Calls `listener` with each event of the AI helper's chat turns the app pushes; returns the function that stops listening. */
    onAssistantEvent(listener: AssistantEventListener): () => void;
    /** Calls `listener` with the id of each pop-out window the user closes; returns the function that stops listening. */
    onPopoutClosed(listener: (windowId: string) => void): () => void;
    /** Calls `listener` with how the app looks each time the scheme, a font or the sun's city is saved; returns the function that stops listening. */
    onAppearance(listener: AppearanceListener): () => void;
    /** Calls `listener` with each update state the app pushes; returns the function that stops listening. */
    onUpdateState(listener: UpdateStateListener): () => void;
    readonly initial: AppearanceMessage & { layout: Layout };
    readonly platform: string;
  };

declare global {
  interface Window {
    composition?: DesktopBridge;
  }
}
