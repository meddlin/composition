/**
 * Fonts the user can choose for a note's preview in Settings.
 *
 * Every family here is open source (SIL Open Font License 1.1), so bundling them
 * raises no licensing questions. They are fetched once at build time by `next/font`
 * (see `app/fonts.ts`) and served from the app itself: no request to Google at
 * runtime, and they work offline in the desktop app.
 *
 * `variable` is the CSS custom property `next/font` defines for the family; the
 * default is the app's own Geist, which is always loaded.
 */

export const PREVIEW_FONT_CHOICES = [
  {
    name: "default",
    label: "Geist (default)",
    stack: "var(--font-geist-sans), system-ui, sans-serif",
  },
  {
    name: "inter",
    label: "Inter",
    stack: "var(--font-preview-inter), system-ui, sans-serif",
  },
  {
    name: "atkinson",
    label: "Atkinson Hyperlegible (easy to read)",
    stack: "var(--font-preview-atkinson), system-ui, sans-serif",
  },
  {
    name: "source-serif",
    label: "Source Serif",
    stack: "var(--font-preview-source-serif), Georgia, serif",
  },
  {
    name: "lora",
    label: "Lora",
    stack: "var(--font-preview-lora), Georgia, serif",
  },
  {
    name: "literata",
    label: "Literata (made for long reading)",
    stack: "var(--font-preview-literata), Georgia, serif",
  },
  {
    name: "mono",
    label: "Geist Mono",
    stack: "var(--font-geist-mono), ui-monospace, monospace",
  },
] as const;

export type PreviewFontName = (typeof PREVIEW_FONT_CHOICES)[number]["name"];

export const DEFAULT_PREVIEW_FONT: PreviewFontName = "default";

export function isPreviewFontName(value: unknown): value is PreviewFontName {
  return PREVIEW_FONT_CHOICES.some((choice) => choice.name === value);
}

/** The CSS `font-family` for a choice; what `--preview-font` is set to (see globals.css). */
export function previewFontStack(name: PreviewFontName): string {
  return PREVIEW_FONT_CHOICES.find((choice) => choice.name === name)!.stack;
}
