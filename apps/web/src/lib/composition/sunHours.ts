/**
 * The four hours a person sets by hand for the "Follow the sun" color scheme (Settings > Styling > Follow the sun):
 * when it starts getting lighter, when it is fully light, when it starts getting darker and when it is fully dark.
 * They are times on the device's own wall clock (no time zone, no city), stored as `HH:MM` on a 24-hour clock under
 * `sunHours` in settings.json. The Swift core ports this (`CompositionCore/Sun/SunHours.swift`), and
 * `fixtures/conformance/sun.json` checks the two agree.
 *
 * The four go once round the clock in order, from any starting point (a day that begins in the evening is fine), with
 * at least a minute between neighbours; see `validateSunHours`.
 */

export type SunHours = {
  /** The page starts getting lighter. */
  lightenFrom: string;
  /** The page is fully light from here, until it starts getting darker. */
  lightFrom: string;
  /** The page starts getting darker. */
  darkenFrom: string;
  /** The page is fully dark from here, until it starts getting lighter again. */
  darkFrom: string;
};

export const SUN_HOUR_KEYS = ["lightenFrom", "lightFrom", "darkenFrom", "darkFrom"] as const satisfies readonly (keyof SunHours)[];

/** What Settings calls each hour. */
export const SUN_HOUR_LABELS: Record<keyof SunHours, string> = {
  lightenFrom: "Starts getting lighter",
  lightFrom: "Fully light from",
  darkenFrom: "Starts getting darker",
  darkFrom: "Fully dark from",
};

/**
 * What the scheme did before the hours were the person's, with no city saved: 06:30 and 18:30 with a 90-minute fade
 * centred on each. Anyone who never chose a city sees no change.
 */
export const DEFAULT_SUN_HOURS: SunHours = { lightenFrom: "05:45", lightFrom: "07:15", darkenFrom: "17:45", darkFrom: "19:15" };

export const MINUTES_PER_DAY = 24 * 60;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `"07:15"` as minutes after midnight (435), or undefined for anything that is not `HH:MM` on a 24-hour clock. */
export function parseClock(value: unknown): number | undefined {
  const match = typeof value === "string" ? CLOCK.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

/** Minutes after midnight (0 to 1439) as `HH:MM`. */
export function formatClock(minutes: number): string {
  const whole = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

/** The four hours as minutes after midnight, or undefined unless every one is a valid `HH:MM`. */
export function sunMinutes(value: unknown): [number, number, number, number] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const minutes = SUN_HOUR_KEYS.map((key) => parseClock(record[key]));
  return minutes.every((minute) => minute !== undefined) ? (minutes as [number, number, number, number]) : undefined;
}

export const SUN_HOURS_FORMAT_ERROR = "Each time must be hours and minutes on a 24-hour clock, like 07:15.";
export const SUN_HOURS_ORDER_ERROR =
  "The four times must follow each other once round the clock (starts getting lighter, fully light, starts getting darker, fully dark), each at least a minute after the one before.";

/**
 * Whether the hours go once round the clock in order: each of the four gaps, measured forward from one hour to the next
 * (the last back to the first), is at least a minute, and together they make exactly one day, never two.
 */
export function goRoundTheClock(minutes: readonly number[]): boolean {
  let total = 0;
  for (let index = 0; index < minutes.length; index++) {
    const gap = (minutes[(index + 1) % minutes.length] - minutes[index] + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    if (gap < 1) return false;
    total += gap;
  }
  return total === MINUTES_PER_DAY;
}

/** A set of hours ready to save, or the reason it is refused (`error`). Anything else in `value` is ignored. */
export function validateSunHours(value: unknown): { hours?: SunHours; error?: string } {
  const minutes = sunMinutes(value);
  if (!minutes) return { error: SUN_HOURS_FORMAT_ERROR };
  if (!goRoundTheClock(minutes)) return { error: SUN_HOURS_ORDER_ERROR };
  const [lightenFrom, lightFrom, darkenFrom, darkFrom] = minutes.map(formatClock);
  return { hours: { lightenFrom, lightFrom, darkenFrom, darkFrom } };
}

/** What a settings file's `sunHours` comes to: all four valid and in order, or the defaults (a half-valid set does not describe a day). */
export function parseSunHours(value: unknown): SunHours {
  return validateSunHours(value).hours ?? DEFAULT_SUN_HOURS;
}
