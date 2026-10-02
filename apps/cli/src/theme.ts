import { SyntaxStyle } from "@opentui/core";
import { INK_FLIP_LEVEL } from "./backend";

/**
 * The colors the UI is drawn with: one palette per color scheme, plus "follow the sun",
 * which is computed from the time of day. The scheme colors come from the web app's
 * globals.css (theme.test.ts fails if they drift); the rest are derived from them.
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
  /** Code block colors, by what highlight.js calls the token (the web's --syntax-*). */
  syntax: SyntaxColors;
};

export type SyntaxColors = {
  comment: string;
  keyword: string;
  string: string;
  number: string;
  function: string;
  type: string;
  attr: string;
};

// --- color math ------------------------------------------------------------------

const channels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const toHex = (rgb: readonly number[]): string =>
  `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** `t` of the way from `a` to `b`: 0 is `a`, 1 is `b`. */
export function mix(a: string, b: string, t: number): string {
  const from = channels(a);
  const to = channels(b);
  return toHex(from.map((c, i) => c + (to[i] - c) * t));
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * White or near-black text for `background`. White is the convention on mid-tones such as a
 * brand blue, so it is kept wherever it stays comfortably readable; near-black takes over on
 * light colors.
 */
export function readableOn(background: string): string {
  const lum = luminance(background);
  const againstWhite = 1.05 / (lum + 0.05);
  const againstBlack = (lum + 0.05) / 0.05;
  return againstWhite >= 4 || againstWhite >= againstBlack ? "#FFFFFF" : "#0B0B0B";
}

// --- the schemes ---------------------------------------------------------------------

type Base = {
  name: string;
  background: string;
  foreground: string;
  surface: string;
  /** The web's --brand. */
  primary: string;
  /** The web's --highlight. */
  accent: string;
  warning: string;
  error: string;
  success: string;
  syntax: SyntaxColors;
};

function palette(base: Base): Palette {
  return {
    ...base,
    // Quieter ink, and lines between areas: the foreground faded into the background, as the web does.
    muted: mix(base.background, base.foreground, 0.6),
    border: mix(base.background, base.foreground, 0.2),
    selection: base.primary,
    selectionText: readableOn(base.primary),
    borderFocused: base.primary,
  };
}

const DARK = palette({
  name: "dark",
  background: "#121212",
  foreground: "#E0E0E0",
  surface: "#1E1E1E",
  primary: "#0178D4",
  accent: "#FFA62B",
  warning: "#FFA62B",
  error: "#BA3C5B",
  success: "#4EBF71",
  syntax: {
    comment: "#8B949E",
    keyword: "#FF7B72",
    string: "#A5D6FF",
    number: "#79C0FF",
    function: "#D2A8FF",
    type: "#FFA657",
    attr: "#7EE787",
  },
});

const LIGHT = palette({
  name: "light",
  background: "#F7F7F4",
  foreground: "#24292F",
  surface: "#EDEDE8",
  primary: "#0B62D6",
  accent: "#C2570C",
  warning: "#B7791F",
  error: "#C4314B",
  success: "#1A7F4B",
  syntax: {
    comment: "#5C6670",
    keyword: "#CF222E",
    string: "#0A3069",
    number: "#0550AE",
    function: "#7442D1",
    type: "#953800",
    attr: "#116329",
  },
});

const FOREST = palette({
  name: "forest",
  background: "#0C1510",
  foreground: "#D5E5DA",
  surface: "#132019",
  primary: "#3FB876",
  accent: "#E3B341",
  warning: "#E0A030",
  error: "#D9596B",
  success: "#7BD88F",
  syntax: {
    comment: "#84A08D",
    keyword: "#F08FA0",
    string: "#A8D98A",
    number: "#E3B341",
    function: "#7CC7E8",
    type: "#E0A066",
    attr: "#7BD88F",
  },
});

const CREAM = palette({
  name: "cream",
  background: "#F6F0E1",
  foreground: "#3B3226",
  surface: "#EEE5D0",
  primary: "#9A4A1F",
  accent: "#C2762B",
  warning: "#96600C",
  error: "#B23A48",
  success: "#4F7A3A",
  syntax: {
    comment: "#6B5C46",
    keyword: "#A8341F",
    string: "#3F6B2C",
    number: "#8A5608",
    function: "#7A3E9D",
    type: "#9A4A1F",
    attr: "#22627A",
  },
});

export const PALETTES = { dark: DARK, light: LIGHT, forest: FOREST, cream: CREAM } as const;

/** The palette for a scheme by name. "auto" is computed (see `autoPalette`), so it, and anything unknown, is dark here. */
export function paletteFor(theme: string): Palette {
  return (PALETTES as Record<string, Palette>)[theme] ?? DARK;
}

// --- follow the sun --------------------------------------------------------------------

/** Whether the terminal can show a smooth blend rather than a fixed set of colors. */
export function isTruecolor(env: Record<string, string | undefined> = process.env): boolean {
  return env.COLORTERM === "truecolor" || env.COLORTERM === "24bit";
}

/**
 * The palette for how light it is (0 night, 1 day; see the web's `sunLevel`). The surfaces
 * fade smoothly; the text snaps to the dark or light scheme's own at INK_FLIP_LEVEL, because a
 * blend of the two inks disappears against the half-way background. Without truecolor there
 * is nothing to blend with, so it snaps to whichever scheme is nearer.
 */
export function autoPalette(level: number, truecolor = true): Palette {
  if (!truecolor) return level >= 0.5 ? { ...LIGHT, name: "auto" } : { ...DARK, name: "auto" };
  const ink = level >= INK_FLIP_LEVEL ? LIGHT : DARK;
  const background = mix(DARK.background, LIGHT.background, level);
  const surface = mix(DARK.surface, LIGHT.surface, level);
  return {
    ...ink,
    name: "auto",
    background,
    surface,
    muted: mix(background, ink.foreground, 0.6),
    border: mix(background, ink.foreground, 0.2),
  };
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
    // code blocks (codeHighlight.ts)
    "code.comment": { fg: p.syntax.comment, italic: true },
    "code.keyword": { fg: p.syntax.keyword },
    "code.string": { fg: p.syntax.string },
    "code.number": { fg: p.syntax.number },
    "code.function": { fg: p.syntax.function },
    "code.type": { fg: p.syntax.type },
    "code.attr": { fg: p.syntax.attr },
    "code.emphasis": { fg: p.foreground, italic: true },
    "code.strong": { fg: p.foreground, bold: true },
  });
}
