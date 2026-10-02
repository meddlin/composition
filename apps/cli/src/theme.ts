import { SyntaxStyle } from "@opentui/core";
import type { ThemeName } from "./backend";

/**
 * The colors the UI is drawn with. One palette per color scheme; step by step the other
 * schemes get filled in, and until one has a palette it falls back to dark.
 */
export type Palette = {
  name: string;
  background: string;
  /** Raised areas: panes, dialogs. */
  surface: string;
  foreground: string;
  muted: string;
  primary: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
  /** The highlighted row. */
  selection: string;
  selectionText: string;
  border: string;
  borderFocused: string;
};

// The look the Python CLI shipped with: Textual's built-in dark theme.
const DARK: Palette = {
  name: "dark",
  background: "#121212",
  surface: "#1E1E1E",
  foreground: "#E0E0E0",
  muted: "#8B949E",
  primary: "#0178D4",
  accent: "#FFA62B",
  error: "#BA3C5B",
  warning: "#FFA62B",
  success: "#4EBF71",
  selection: "#0178D4",
  selectionText: "#FFFFFF",
  border: "#3A3F47",
  borderFocused: "#0178D4",
};

const PALETTES: Partial<Record<ThemeName, Palette>> = { dark: DARK };

export function paletteFor(theme: string): Palette {
  return PALETTES[theme as ThemeName] ?? DARK;
}

/**
 * Styles for the editor's highlights (`highlight.ts`) and for the Markdown preview, whose
 * names are tree-sitter captures (a name like `markup.heading.2` falls back to
 * `markup.heading`).
 */
export function syntaxStyleFor(p: Palette): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: p.foreground },
    // editor highlights
    heading: { fg: p.primary, bold: true },
    bold: { fg: p.accent, bold: true },
    italic: { fg: p.foreground, italic: true },
    code: { fg: p.success },
    link: { fg: p.primary, underline: true },
    marker: { fg: p.accent },
    quote: { fg: p.muted, italic: true },
    meta: { fg: p.muted },
    // preview
    "markup.heading": { fg: p.primary, bold: true },
    "markup.strong": { fg: p.foreground, bold: true },
    "markup.italic": { fg: p.foreground, italic: true },
    "markup.strikethrough": { fg: p.muted },
    "markup.raw": { fg: p.success },
    "markup.raw.block": { fg: p.success },
    "markup.link": { fg: p.primary },
    "markup.link.label": { fg: p.primary, underline: true },
    "markup.link.url": { fg: p.muted },
    "markup.list": { fg: p.accent },
    "markup.list.checked": { fg: p.success },
    "markup.list.unchecked": { fg: p.muted },
    "markup.quote": { fg: p.muted, italic: true },
    "punctuation.special": { fg: p.muted },
  });
}
