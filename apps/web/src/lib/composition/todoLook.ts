/**
 * How the to-do panels look, apart from the notes area: one setting for all of them (Settings > Styling). The notes'
 * background is a pattern on the whole window; the to-do panels can follow it or draw their own pattern, and can have a
 * color of their own under it. Types and rules only, so it is safe to import anywhere (renderer, preload, main).
 */

export const TODO_BACKGROUND_CHOICES = [
  { name: "notes", label: "Same as notes" },
  { name: "plain", label: "Plain" },
  { name: "grid", label: "Grid" },
  { name: "dots", label: "Dots" },
  { name: "lines", label: "Ruled lines" },
] as const;

export type TodoBackgroundName = (typeof TODO_BACKGROUND_CHOICES)[number]["name"];

/** `color` is `#rrggbb`, or null for the color scheme's own background. */
export type TodoLook = { background: TodoBackgroundName; color: string | null };

export const DEFAULT_TODO_LOOK: TodoLook = { background: "notes", color: null };

/** Colors offered next to the color picker: paper, pastel and dark tones, none of them loud. */
export const TODO_COLOR_PRESETS = [
  { color: "#fbf3d9", label: "Paper" },
  { color: "#e4efe1", label: "Sage" },
  { color: "#e3edf7", label: "Sky" },
  { color: "#f6e3e3", label: "Blush" },
  { color: "#2a2a33", label: "Slate" },
  { color: "#14202b", label: "Navy" },
  { color: "#1c2a20", label: "Pine" },
] as const;

export function isTodoBackgroundName(value: unknown): value is TodoBackgroundName {
  return TODO_BACKGROUND_CHOICES.some((choice) => choice.name === value);
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

/** Reads a saved look (any JSON value); whatever is missing or not valid is the default. */
export function readTodoLook(saved: unknown): TodoLook {
  if (typeof saved !== "object" || saved === null || Array.isArray(saved)) return DEFAULT_TODO_LOOK;
  const { background, color } = saved as Record<string, unknown>;
  return {
    background: isTodoBackgroundName(background) ? background : DEFAULT_TODO_LOOK.background,
    color: isHexColor(color) ? color.toLowerCase() : null,
  };
}

/** Whether text on this color should be light (true) or dark, by the color's relative luminance (WCAG's formula). */
export function needsLightText(hex: string): boolean {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Light text gives the better contrast below this luminance (where white and black contrast equally).
  return luminance < 0.179;
}

/** Whether a value is exactly a look: a known background, and a `#rrggbb` color or none. */
export function isTodoLook(value: unknown): value is TodoLook {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { background, color } = value as Record<string, unknown>;
  return isTodoBackgroundName(background) && (color === null || isHexColor(color));
}
