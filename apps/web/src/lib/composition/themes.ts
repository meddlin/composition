/**
 * Color schemes the user can choose between in Settings.
 *
 * The same six schemes exist in the terminal app, which reads these names from here:
 *   dark   -> the default
 *   light
 *   forest -> dark green
 *   wine   -> dark red
 *   cream  -> warm light
 *   auto   -> blends dark and light along the saved city's sunrise and sunset
 * The palettes themselves live in `app/globals.css`, keyed by `data-theme`; the terminal
 * app's copy is apps/cli/src/theme.ts.
 */

export const THEME_CHOICES = [
  { name: "dark", label: "Dark" },
  { name: "light", label: "Light" },
  { name: "forest", label: "Forest (dark green)" },
  { name: "wine", label: "Wine (dark red)" },
  { name: "cream", label: "Cream (warm light)" },
  { name: "auto", label: "Follow the sun (dark at night, light by day)" },
] as const;

export type ThemeName = (typeof THEME_CHOICES)[number]["name"];

export const DEFAULT_THEME: ThemeName = "dark";

export function isThemeName(value: unknown): value is ThemeName {
  return THEME_CHOICES.some((choice) => choice.name === value);
}
