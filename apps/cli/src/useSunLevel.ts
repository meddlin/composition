import { useEffect, useState } from "react";
import type { Api } from "./api";
import { DEFAULT_SUN_HOURS, sunLevel, type SunHours } from "./backend";

/** How often the level is recomputed while "follow the sun" is showing. */
export const TICK_MS = 30 * 1000;

/**
 * How light the "follow the sun" scheme should be right now: 0 (night) to 1 (day), or null when another scheme is chosen.
 * It starts from the default hours so the first draw is already plausible, switches to the person's saved hours once they
 * load, and keeps moving along the fades between them. `version` is bumped when the hours or the scheme change, to make it
 * read them again. Nothing here asks the network for anything. Mirrors the web app's SunThemeSync.
 */
export function useSunLevel(enabled: boolean, api: Pick<Api, "loadSunHours">, version: number): number | null {
  const [hours, setHours] = useState<SunHours>(DEFAULT_SUN_HOURS);
  const [level, setLevel] = useState(() => sunLevel(DEFAULT_SUN_HOURS, Date.now()));

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    api.loadSunHours().then(
      (next) => active && next && setHours(next),
      () => {}, // keep what is showing
    );
    return () => {
      active = false;
    };
  }, [enabled, version]);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => setLevel(sunLevel(hours, Date.now()));
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [enabled, hours]);

  return enabled ? level : null;
}
