/**
 * Fonts the user can choose for the Markdown editor in Settings.
 *
 * Like the preview fonts (`previewFonts.ts`), every family here is open source (SIL Open
 * Font License 1.1) and is bundled by `next/font` (see `app/fonts.ts`), so nothing is
 * fetched at runtime and they work offline in the desktop app.
 *
 * Monospace is only a default, not a rule. The editor is a textarea with a copy of its text
 * drawn underneath for colour, and that copy (and the completion menus' caret measuring)
 * takes its font from the same CSS variable, so any family lines up. What proportional fonts
 * give up is column alignment in tables and code fences, which is why monospace comes first.
 */

export const EDITOR_FONT_CHOICES = [
  {
    name: "default",
    label: "Geist Mono (default)",
    kind: "monospace",
    stack: "var(--font-geist-mono), ui-monospace, monospace",
  },
  {
    name: "jetbrains-mono",
    label: "JetBrains Mono",
    kind: "monospace",
    stack: "var(--font-editor-jetbrains-mono), ui-monospace, monospace",
  },
  {
    name: "source-code-pro",
    label: "Source Code Pro",
    kind: "monospace",
    stack: "var(--font-editor-source-code-pro), ui-monospace, monospace",
  },
  {
    name: "ibm-plex-mono",
    label: "IBM Plex Mono",
    kind: "monospace",
    stack: "var(--font-editor-ibm-plex-mono), ui-monospace, monospace",
  },
  {
    name: "geist",
    label: "Geist",
    kind: "proportional",
    stack: "var(--font-geist-sans), system-ui, sans-serif",
  },
  {
    name: "inter",
    label: "Inter",
    kind: "proportional",
    stack: "var(--font-preview-inter), system-ui, sans-serif",
  },
  {
    name: "atkinson",
    label: "Atkinson Hyperlegible (easy to read)",
    kind: "proportional",
    stack: "var(--font-preview-atkinson), system-ui, sans-serif",
  },
  {
    name: "source-serif",
    label: "Source Serif",
    kind: "proportional",
    stack: "var(--font-preview-source-serif), Georgia, serif",
  },
  {
    name: "lora",
    label: "Lora",
    kind: "proportional",
    stack: "var(--font-preview-lora), Georgia, serif",
  },
  {
    name: "literata",
    label: "Literata (made for long reading)",
    kind: "proportional",
    stack: "var(--font-preview-literata), Georgia, serif",
  },
] as const;

export type EditorFontName = (typeof EDITOR_FONT_CHOICES)[number]["name"];

export const DEFAULT_EDITOR_FONT: EditorFontName = "default";

export function isEditorFontName(value: unknown): value is EditorFontName {
  return EDITOR_FONT_CHOICES.some((choice) => choice.name === value);
}

/** The CSS `font-family` for a choice; what `--editor-font` is set to (see globals.css). */
export function editorFontStack(name: EditorFontName): string {
  return EDITOR_FONT_CHOICES.find((choice) => choice.name === name)!.stack;
}
