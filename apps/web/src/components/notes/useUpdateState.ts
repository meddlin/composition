"use client";

import { useEffect, useState } from "react";
import type { UpdateState } from "@/lib/composition/updatesApi";
import { getUpdateState, subscribeToUpdateState, UPDATES_AVAILABLE } from "@/lib/composition/updatesClient";

/**
 * The desktop app's update state, kept current as the main process pushes changes; null
 * until the first answer, and always null in the web app, which has no updater.
 */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    if (!UPDATES_AVAILABLE) return;
    let live = true;
    let pushed = false;
    const unsubscribe = subscribeToUpdateState((next) => {
      pushed = true;
      if (live) setState(next);
    });
    // A push that arrives before this answer is newer than it, so it wins.
    getUpdateState()
      .then((initial) => {
        if (live && !pushed) setState(initial);
      })
      .catch(() => {});
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  return state;
}
