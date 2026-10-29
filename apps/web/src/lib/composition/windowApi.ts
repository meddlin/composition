/**
 * What the Settings screen's Appearance section and the desktop main process exchange about
 * the window's see-through look. Types only plus the one attribute name, so it is safe to import
 * anywhere (renderer, preload, main).
 *
 * Desktop only, and only where the OS can blur what is behind a window (macOS): the web app has
 * no window of its own and the CLI is a terminal.
 */

export type WindowTranslucency = {
  /** False where the window cannot be made translucent; the setting is then hidden. */
  supported: boolean;
  /** Whether the person wants it. The window is translucent only when this and `supported` are both true. */
  enabled: boolean;
  /** How solid the page's background fills are while translucent: 0 (fully see-through) to 1 (solid). */
  opacity: number;
};

/** The default fill opacity: 70% transparent, a happy medium between the desktop showing through and text staying easy to read. */
export const DEFAULT_WINDOW_OPACITY = 0.3;
/** Fully see-through is allowed; it is the person's call. */
export const MIN_WINDOW_OPACITY = 0;

/** A number from the page or a file, brought into range; anything else is the default. */
export const clampWindowOpacity = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(MIN_WINDOW_OPACITY, value))
    : DEFAULT_WINDOW_OPACITY;

/** The desktop app's contract. */
export interface WindowApi {
  getWindowTranslucency(): Promise<WindowTranslucency>;
  setWindowTranslucency(enabled: boolean): Promise<WindowTranslucency>;
  setWindowOpacity(opacity: number): Promise<WindowTranslucency>;
}

/** Every method of WindowApi, as data; the check below fails to compile if one is missing (see API_METHODS in api.ts). */
export const WINDOW_METHODS = ["getWindowTranslucency", "setWindowTranslucency", "setWindowOpacity"] as const satisfies readonly (keyof WindowApi)[];

export type WindowMethod = (typeof WINDOW_METHODS)[number];

type MissingFromWindowMethods = Exclude<keyof WindowApi, WindowMethod>;
const _everyMethodListed: [MissingFromWindowMethods] extends [never] ? true : never = true;
void _everyMethodListed;

/** Whether the window is actually translucent right now. */
export const isTranslucent = ({ supported, enabled }: WindowTranslucency): boolean => supported && enabled;
