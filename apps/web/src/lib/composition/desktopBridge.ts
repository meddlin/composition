import type { CompositionApi } from "./api";
import type { AssistantEventListener, AssistantStreamApi } from "./assistantApi";
import type { AttachmentsApi } from "./attachmentsApi";
import type { DesktopBackupApi } from "./backupApi";
import type { Layout } from "./layout";
import type { EditorFontName } from "./editorFonts";
import type { NoteBackgroundName } from "./noteBackgrounds";
import type { PreviewFontName } from "./previewFonts";
import type { ThemeName } from "./themes";
import type { UpdatesApi, UpdateStateListener } from "./updatesApi";
import type { WindowApi } from "./windowApi";

/**
 * What Electron's preload script exposes on `window.composition` (apps/desktop).
 * Everything in CompositionApi, plus the desktop-only AttachmentsApi, DesktopBackupApi, UpdatesApi, WindowApi and AssistantStreamApi, plus a
 * synchronous snapshot taken before the page paints so the first frame already
 * has the right color scheme.
 */
export type DesktopBridge = CompositionApi &
  AttachmentsApi &
  DesktopBackupApi &
  UpdatesApi &
  WindowApi &
  AssistantStreamApi & {
    /** Calls `listener` with each event of the AI helper's chat turns the app pushes; returns the function that stops listening. */
    onAssistantEvent(listener: AssistantEventListener): () => void;
    /** Calls `listener` with each update state the app pushes; returns the function that stops listening. */
    onUpdateState(listener: UpdateStateListener): () => void;
    readonly initial: {
      theme: ThemeName;
      previewFont: PreviewFontName;
      editorFont: EditorFontName;
      noteBackground: NoteBackgroundName;
      layout: Layout;
      /** Whether the window is translucent, so the first frame already lets it show through. */
      translucent: boolean;
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
