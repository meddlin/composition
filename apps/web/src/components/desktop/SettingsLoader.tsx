"use client";

import { SettingsScreen } from "@/app/settings/SettingsScreen";
import { loadSettings } from "@/lib/composition/client";
import { LoadFailed } from "./LoadFailed";
import { useLoaded } from "./useLoaded";

/** Desktop settings: load the snapshot over IPC, then render the web's SettingsScreen. */
export function SettingsLoader() {
  const snapshot = useLoaded(loadSettings);

  if (snapshot.status === "error") {
    return <LoadFailed what="your settings" message={snapshot.message} />;
  }
  if (snapshot.status === "loading") {
    return <div aria-busy="true" className="min-h-screen" />;
  }
  return <SettingsScreen snapshot={snapshot.value} />;
}
