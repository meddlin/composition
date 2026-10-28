import type { EditorFontName } from "./editorFonts";
import type { PreviewFontName } from "./previewFonts";
import type { ThemeName } from "./themes";

/**
 * How the app looks, as every window needs to hear it: the color scheme and the two fonts, plus (for "Follow the sun")
 * where on the sunrise and sunset ramp it starts. Types only, so it is safe to import anywhere (renderer, preload, main).
 * It is what a window's first paint is given (`window.composition.initial`), and what the main process pushes to every
 * open window when Settings changes any of it.
 */
export type AppearanceMessage = {
  theme: ThemeName;
  previewFont: PreviewFontName;
  editorFont: EditorFontName;
  /** Present for the "auto" scheme. */
  sun?: { tone: "light" | "dark"; autoLight: string };
};

export type AppearanceListener = (appearance: AppearanceMessage) => void;
