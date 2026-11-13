"use client";

import { useEffect, useState } from "react";
import { loadSunHours } from "@/lib/composition/client";
import { sunLevel, sunThemeAttributes } from "@/lib/composition/sunSchedule";
import { inkFlipLevelOf } from "@/lib/composition/sunPairs";
import type { SunHours } from "@/lib/composition/sunHours";

const TICK_MS = 30 * 1000;

/** Dispatch on `window` after the color scheme, the pair of colors or the hours change, so this re-reads the hours. */
export const SUN_SETTINGS_CHANGED = "composition:sun-settings-changed";

/** Sets the CSS variable and attribute the `auto` color scheme reads (see globals.css), for the pair of colors `data-sun-pair` names. */
export function applySunTheme(root: HTMLElement, hours: SunHours, now: number) {
  const { tone, autoLight } = sunThemeAttributes(sunLevel(hours, now), inkFlipLevelOf(root.dataset.sunPair));
  root.style.setProperty("--auto-light", autoLight);
  root.dataset.tone = tone;
}

type Props = {
  /**
   * The hours the server rendered the page with, or null when another scheme
   * is selected. Leave it out (desktop, where nothing renders on a server) to
   * load them on mount.
   */
  initial?: SunHours | null;
};

/**
 * Keeps the "Follow the sun" scheme moving while the page stays open. The first
 * paint already starts at the right point; this advances it along the fade
 * between the hours the person set, and picks the scheme or new hours up when
 * they are changed in Settings. Nothing here asks the network for anything.
 */
export function SunThemeSync({ initial }: Props) {
  const [hours, setHours] = useState<SunHours | null>(initial ?? null);

  // The web layout re-renders with new hours after settings change.
  const [seenInitial, setSeenInitial] = useState(initial);
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    if (initial !== undefined) setHours(initial);
  }

  useEffect(() => {
    let active = true;
    function reload() {
      loadSunHours().then(
        (next) => active && setHours(next),
        () => {}, // keep what we have
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
    if (!hours) return;
    const root = document.documentElement;
    const tick = () => applySunTheme(root, hours, Date.now());
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [hours]);

  return null;
}
