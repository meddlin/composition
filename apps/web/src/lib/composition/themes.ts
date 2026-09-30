/**
 * Color schemes the user can choose between in Settings.
 *
 * Mirrors the CLI's `apps/cli/src/composition/themes.py`:
 *   dark   -> textual-dark (default)
 *   light  -> composition-light
 *   forest -> composition-forest
 *   cream  -> web only (no CLI counterpart yet)
 *   auto   -> web only; blends dark and light along the saved city's sunrise and sunset
 * The palettes themselves live in `app/globals.css`, keyed by `data-theme`.
 */

export const THEME_CHOICES = [
  { name: "dark", label: "Dark" },
  { name: "light", label: "Light" },
  { name: "forest", label: "Forest (dark green)" },
  { name: "cream", label: "Cream (warm light)" },
  { name: "auto", label: "Follow the sun (dark at night, light by day)" },
] as const;

export type ThemeName = (typeof THEME_CHOICES)[number]["name"];

export const DEFAULT_THEME: ThemeName = "dark";

export function isThemeName(value: unknown): value is ThemeName {
  return THEME_CHOICES.some((choice) => choice.name === value);
}
