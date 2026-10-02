import { useEffect, useState } from "react";
import type { Api } from "./api";
import { fallbackSunEvents, RAMP_HALF_WIDTH_MS, sunLevel, type SunSchedule } from "./backend";

/** How often the level is recomputed while "follow the sun" is showing. */
export const TICK_MS = 30 * 1000;
/** How often to ask again when the real times are missing or used up. */
const REFRESH_MS = 10 * 60 * 1000;

/**
 * How light the "follow the sun" scheme should be right now: 0 (night) to 1 (day), or null
 * when another scheme is chosen. It starts from stand-in times so the first draw is already
 * plausible, switches to the real times for the saved city once they load, and keeps moving
 * along the sunrise/sunset ramp. `version` is bumped when the city or scheme changes, to
 * make it ask again. Mirrors the web app's SunThemeSync.
 */
export function useSunLevel(enabled: boolean, api: Pick<Api, "loadSunSchedule">, version: number): number | null {
  const [schedule, setSchedule] = useState<SunSchedule | null>(null);
  const [level, setLevel] = useState(() => sunLevel(fallbackSunEvents(Date.now()), Date.now()));

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.loadSunSchedule().then(
      (next) => active && setSchedule(next),
      () => {}, // keep what is showing; the next refresh tries again
    );
    return () => {
      active = false;
    };
  }, [enabled, version]);

  useEffect(() => {
    if (!enabled) return;
    const events = schedule?.events ?? fallbackSunEvents(Date.now());
    let lastRefresh = Date.now();
    let active = true;

    const tick = () => {
      const now = Date.now();
      setLevel(sunLevel(schedule?.events ?? fallbackSunEvents(now), now));
      const exhausted = !events.some((event) => event.at + RAMP_HALF_WIDTH_MS > now);
      if ((schedule?.retry || exhausted) && now - lastRefresh >= REFRESH_MS) {
        lastRefresh = now;
        api.loadSunSchedule().then(
          (next) => active && setSchedule(next),
          () => {},
        );
      }
    };
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled, schedule]);

  return enabled ? level : null;
}
