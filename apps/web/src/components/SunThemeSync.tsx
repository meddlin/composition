"use client";

import { useEffect, useState } from "react";
import { loadSunSchedule } from "@/lib/composition/client";
import {
  RAMP_HALF_WIDTH_MS,
  sunThemeAttributes,
  sunLevel,
  type SunEvent,
} from "@/lib/composition/sunSchedule";
import type { SunSchedule } from "@/lib/composition/sunTimes";

const TICK_MS = 30 * 1000;
/** How often to ask again when real times are missing or used up. */
const REFRESH_MS = 10 * 60 * 1000;

/** Dispatch on `window` after the color scheme or the saved city changes, so this re-reads the schedule. */
export const SUN_SETTINGS_CHANGED = "composition:sun-settings-changed";

/** Sets the CSS variable and attribute the `auto` color scheme reads (see globals.css). */
export function applySunTheme(root: HTMLElement, events: readonly SunEvent[], now: number) {
  const { tone, autoLight } = sunThemeAttributes(sunLevel(events, now));
  root.style.setProperty("--auto-light", autoLight);
  root.dataset.tone = tone;
}

type Props = {
  /**
   * The schedule the server rendered the page with, or null when another scheme
   * is selected. Leave it out (desktop, where nothing renders on a server) to
   * load the schedule on mount.
   */
  initial?: SunSchedule | null;
};

/**
 * Keeps the "Follow the sun" scheme moving while the page stays open. The first
 * paint already starts at the right point; this advances it along the
 * sunrise/sunset ramp, fetches fresh times when the ones it has are used up (or
 * were only estimates), and picks the scheme up when it's chosen in Settings.
 */
export function SunThemeSync({ initial }: Props) {
  const [schedule, setSchedule] = useState<SunSchedule | null>(initial ?? null);

  // The web layout re-renders with a new schedule after settings change.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    if (initial !== undefined) setSchedule(initial);
  }

  useEffect(() => {
    let active = true;
    function reload() {
      loadSunSchedule().then(
        (next) => active && setSchedule(next),
        () => {}, // keep what we have; the next tick tries again
      );
    }

    if (initial === undefined) reload();
    window.addEventListener(SUN_SETTINGS_CHANGED, reload);
    return () => {
      active = false;
      window.removeEventListener(SUN_SETTINGS_CHANGED, reload);
    };
    // `initial` only decides whether to load on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!schedule) return;
    const root = document.documentElement;
    let lastRefresh = Date.now();
    let active = true;

    function tick() {
      const now = Date.now();
      applySunTheme(root, schedule!.events, now);

      const exhausted = !schedule!.events.some((event) => event.at + RAMP_HALF_WIDTH_MS > now);
      if ((schedule!.retry || exhausted) && now - lastRefresh >= REFRESH_MS) {
        lastRefresh = now;
        loadSunSchedule().then(
          (next) => active && setSchedule(next),
          () => {},
        );
      }
    }

    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [schedule]);

  return null;
}
