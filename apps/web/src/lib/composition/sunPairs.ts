import { INK_FLIP_LEVEL } from "./sunSchedule";

/**
 * The light and dark colors the "Follow the sun" color scheme moves between, chosen in Settings > Styling > Follow
 * the sun. Each is a day palette and a night palette from `app/globals.css`: the page fades from one to the other
 * around sunrise and sunset, and its text switches between the two palettes' own ink at `inkFlipLevel`.
 *
 *   classic      -> Light and Dark, the first pair there was (the default)
 *   cream-amber  -> Cream (warm paper) to a dark amber
 *   mint-forest  -> a pale green to Forest (dark green)
 *   blush-wine   -> a pale rose to Wine (dark red)
 *   sky-midnight -> a pale blue to a midnight navy
 *
 * Only a pair's surfaces blend. The palettes are keyed `[data-theme="auto"][data-sun-pair="<name>"][data-tone="light"]`
 * (or "dark"); the classic pair is also what shows when the attribute is missing. `inkFlipLevel` is where, along the
 * blend, the two inks are equally readable against it, which differs a little from pair to pair; `themes.test.ts`
 * recomputes it from the palettes, so a recolored pair that moves it fails there. The terminal app only knows `classic`.
 */

export const SUN_PAIR_CHOICES = [
  { name: "classic", label: "Light and dark", day: "light", night: "dark", inkFlipLevel: INK_FLIP_LEVEL },
  { name: "cream-amber", label: "Cream to dark amber", day: "cream", night: "amber", inkFlipLevel: 0.5 },
  { name: "mint-forest", label: "Light green to dark forest", day: "mint", night: "forest", inkFlipLevel: 0.46 },
  { name: "blush-wine", label: "Blush to wine", day: "blush", night: "wine", inkFlipLevel: 0.47 },
  { name: "sky-midnight", label: "Sky to midnight", day: "sky", night: "midnight", inkFlipLevel: 0.47 },
] as const;

export type SunPairName = (typeof SUN_PAIR_CHOICES)[number]["name"];

export const DEFAULT_SUN_PAIR: SunPairName = "classic";

export function isSunPairName(value: unknown): value is SunPairName {
  return SUN_PAIR_CHOICES.some((choice) => choice.name === value);
}

/** Where the text of the given pair switches from its night ink to its day ink (see `toneForLevel`). */
export function inkFlipLevelOf(pair: unknown): number {
  return SUN_PAIR_CHOICES.find((choice) => choice.name === pair)?.inkFlipLevel ?? INK_FLIP_LEVEL;
}
