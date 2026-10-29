import fs from "node:fs";
import path from "node:path";
import { clampWindowOpacity, DEFAULT_WINDOW_OPACITY, isTranslucent, type WindowApi, type WindowTranslucency } from "../../../web/src/lib/composition/windowApi";

/**
 * macOS's blur material for a window's whole background (NSVisualEffectView, "under-window").
 * The OS draws it, so it follows the system appearance and goes opaque by itself when the person
 * has turned on Reduce Transparency.
 */
export const WINDOW_VIBRANCY = "under-window";

/** What the window is painted with where the web page lets it through: nothing, so the blur shows. */
export const TRANSLUCENT_BACKGROUND = "#00000000";

/** The one preference, in its own small file under the app's data folder like the update preferences. */
export type WindowPrefs = { translucent: boolean; opacity: number };

export type WindowPrefsStore = {
  load(): WindowPrefs;
  save(prefs: WindowPrefs): void;
};

/** On until the person turns it off; a missing or damaged file means "on". */
export const DEFAULT_WINDOW_PREFS: WindowPrefs = { translucent: true, opacity: DEFAULT_WINDOW_OPACITY };

export function createWindowPrefsStore(file: string): WindowPrefsStore {
  return {
    load() {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
        const { translucent, opacity } = (parsed ?? {}) as { translucent?: unknown; opacity?: unknown };
        return {
          translucent: typeof translucent === "boolean" ? translucent : DEFAULT_WINDOW_PREFS.translucent,
          opacity: clampWindowOpacity(opacity),
        };
      } catch {
        return { ...DEFAULT_WINDOW_PREFS };
      }
    },
    save(prefs) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // Write beside the file and rename over it, so a crash can't leave half a file.
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify({ translucent: prefs.translucent, opacity: prefs.opacity }, null, 2)}\n`);
      fs.renameSync(temporary, file);
    },
  };
}

/** The slice of a BrowserWindow this module changes, so tests don't need Electron. */
export type TranslucentWindow = {
  setVibrancy(type: typeof WINDOW_VIBRANCY | null): void;
  setBackgroundColor(color: string): void;
};

export type WindowTranslucencyController = WindowApi & {
  /** Whether a window opened now should be translucent. */
  isActive(): boolean;
  /** The color a window opened now starts with. */
  backgroundColor(): string;
  /** How solid the page's fills are now. */
  opacity(): number;
};

export function createWindowTranslucency(options: {
  platform: string;
  prefs: WindowPrefsStore;
  windows: () => readonly TranslucentWindow[];
  /** The opaque color of the current color scheme, used when the window is not translucent. */
  solidBackground: () => string;
}): WindowTranslucencyController {
  const { platform, prefs, windows, solidBackground } = options;
  const supported = platform === "darwin";
  const loaded = prefs.load();
  let enabled = loaded.translucent;
  let opacity = loaded.opacity;

  const state = (): WindowTranslucency => ({ supported, enabled, opacity });
  const active = () => isTranslucent(state());
  const backgroundColor = () => (active() ? TRANSLUCENT_BACKGROUND : solidBackground());

  return {
    isActive: active,
    backgroundColor,
    opacity: () => opacity,
    async getWindowTranslucency() {
      return state();
    },
    async setWindowTranslucency(next) {
      if (next !== enabled) {
        enabled = next;
        prefs.save({ translucent: enabled, opacity });
        for (const window of windows()) {
          window.setVibrancy(active() ? WINDOW_VIBRANCY : null);
          window.setBackgroundColor(backgroundColor());
        }
      }
      return state();
    },
    async setWindowOpacity(next) {
      const clamped = clampWindowOpacity(next);
      if (clamped !== opacity) {
        opacity = clamped;
        prefs.save({ translucent: enabled, opacity });
      }
      return state();
    },
  };
}
