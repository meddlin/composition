/**
 * Pure math for the "Follow the sun" color scheme: given today's sunrise and
 * sunset times, how light should the app be right now?
 *
 * The level is 0 (fully dark) to 1 (fully light). It ramps up across a window
 * centered on each sunrise and back down across a window centered on each
 * sunset, and holds steady the rest of the time.
 */

export type SunEvent = { at: number; kind: "sunrise" | "sunset" }; // `at` is epoch ms

/** The ramp extends this far before and after each event (90 minutes end to end). */
export const RAMP_HALF_WIDTH_MS = 45 * 60 * 1000;

/**
 * Text flips between its dark-scheme and light-scheme color at this level
 * rather than cross-fading: a blend of the two inks is unreadable against the
 * half-way background. ~0.45 is where both inks have equal contrast against it.
 */
export const INK_FLIP_LEVEL = 0.45;

function smoothstep(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

export function sunLevel(events: readonly SunEvent[], now: number): number {
  const sorted = [...events].sort((a, b) => a.at - b.at);

  let previous: SunEvent | undefined;
  for (const event of sorted) {
    const progress = (now - event.at + RAMP_HALF_WIDTH_MS) / (2 * RAMP_HALF_WIDTH_MS);
    if (progress >= 0 && progress <= 1) {
      const eased = smoothstep(progress);
      return event.kind === "sunrise" ? eased : 1 - eased;
    }
    if (progress < 0) break;
    previous = event;
  }

  if (previous) return previous.kind === "sunrise" ? 1 : 0;
  // Before every known event: it's night if the next one is a sunrise.
  const next = sorted[0];
  if (!next) return 0;
  return next.kind === "sunrise" ? 0 : 1;
}

export function toneForLevel(level: number): "light" | "dark" {
  return level >= INK_FLIP_LEVEL ? "light" : "dark";
}

/** What goes on `<html>`: `data-tone` and the `--auto-light` percentage (see globals.css). */
export function sunThemeAttributes(level: number): { tone: "light" | "dark"; autoLight: string } {
  return { tone: toneForLevel(level), autoLight: `${(level * 100).toFixed(1)}%` };
}

/**
 * Stand-in times for when the real ones are unavailable (no city saved, or the
 * lookup failed and nothing is cached): 06:30 and 18:30 machine-local time,
 * for yesterday, today and tomorrow.
 */
export function fallbackSunEvents(now: number): SunEvent[] {
  const events: SunEvent[] = [];
  for (const dayOffset of [-1, 0, 1]) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    const at = (hour: number, minute: number) => new Date(day).setHours(hour, minute, 0, 0);
    events.push({ at: at(6, 30), kind: "sunrise" }, { at: at(18, 30), kind: "sunset" });
  }
  return events;
}
