/**
 * Pure math for the "Follow the sun" color scheme: given the four hours a person set by hand (sunHours.ts), how light
 * should the app be right now?
 *
 * The level is 0 (fully dark) to 1 (fully light), and it is a function of the time of day on the device's wall clock
 * alone, with no events and no calendar. Measured forward from "starts getting lighter", it eases from 0 to 1 over the
 * span to "fully light from", holds 1 until "starts getting darker", eases back to 0 over the span to "fully dark
 * from", and holds 0 round to the start. A fade may cross midnight.
 *
 * Everything is whole milliseconds (the time of day in milliseconds, the spans in milliseconds), so the Swift port
 * (`CompositionCore/Sun/SunSchedule.swift`) divides the same two integers and gets the same level to the last bit.
 */
import { DEFAULT_SUN_HOURS, goRoundTheClock, MINUTES_PER_DAY, sunMinutes, type SunHours } from "./sunHours";

export const MS_PER_MINUTE = 60 * 1000;
export const MS_PER_DAY = MINUTES_PER_DAY * MS_PER_MINUTE;

/**
 * Text flips between its dark-scheme and light-scheme color at this level rather than cross-fading: a blend of the two
 * inks is unreadable against the half-way background. ~0.45 is where both inks have equal contrast against it for the
 * classic light and dark pair; the other pairs have their own (sunPairs.ts).
 */
export const INK_FLIP_LEVEL = 0.45;

function smoothstep(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

/**
 * The milliseconds since midnight on the wall clock of `timeZone` (the device's own when it is left out) at `now`
 * (epoch milliseconds). A day with a clock change is as long as the clock says: the time of day just follows the wall.
 */
export function msOfLocalDay(now: number, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    fractionalSecondDigits: 3,
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);
  return (((part("hour") % 24) * 60 + part("minute")) * 60 + part("second")) * 1000 + part("fractionalSecond");
}

/** The level at a time of day, in milliseconds since midnight (0 up to a day). */
export function levelAtTimeOfDay(hours: SunHours, msOfDay: number): number {
  const minutes = sunMinutes(hours);
  // Hours that do not go round the clock in order describe no day: they read as the defaults, as a settings file's do.
  if (!minutes || !goRoundTheClock(minutes)) return levelAtTimeOfDay(DEFAULT_SUN_HOURS, msOfDay);
  const [lightenFrom, lightFrom, darkenFrom, darkFrom] = minutes;
  // Measure everything forward from "starts getting lighter", which is 0.
  const since = (minute: number) => ((((minute - lightenFrom) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) * MS_PER_MINUTE;
  const rise = since(lightFrom);
  const fall = since(darkenFrom);
  const dark = since(darkFrom);
  const at = (((msOfDay - lightenFrom * MS_PER_MINUTE) % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;

  if (at < rise) return smoothstep(at / rise);
  if (at < fall) return 1;
  if (at < dark) return 1 - smoothstep((at - fall) / (dark - fall));
  return 0;
}

/** How light the app should be at `now` (epoch milliseconds), 0 (dark) to 1 (light), on the device's clock. */
export function sunLevel(hours: SunHours, now: number, timeZone?: string): number {
  return levelAtTimeOfDay(hours, msOfLocalDay(now, timeZone));
}

/** `flipLevel` is the pair's own point (see `inkFlipLevelOf` in sunPairs.ts); the classic pair's by default. */
export function toneForLevel(level: number, flipLevel = INK_FLIP_LEVEL): "light" | "dark" {
  return level >= flipLevel ? "light" : "dark";
}

/** What goes on `<html>`: `data-tone` and the `--auto-light` percentage (see globals.css). */
export function sunThemeAttributes(
  level: number,
  flipLevel = INK_FLIP_LEVEL,
): { tone: "light" | "dark"; autoLight: string } {
  return { tone: toneForLevel(level, flipLevel), autoLight: `${(level * 100).toFixed(1)}%` };
}
