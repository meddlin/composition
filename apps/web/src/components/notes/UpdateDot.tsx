"use client";

import { updateNeedsAttention } from "@/lib/composition/updatesApi";
import { useUpdateState } from "./useUpdateState";

/**
 * A small dot beside "Settings" when an update is waiting on the person: one to download, or
 * one downloaded and ready to restart into. Renders nothing otherwise, and always nothing in
 * the web app.
 */
export function UpdateDot() {
  const state = useUpdateState();
  if (!state || !updateNeedsAttention(state)) return null;
  const label = state.phase === "ready" ? "Update ready to install" : "Update available";
  return (
    <span role="img" aria-label={label} title={label} className="ml-auto size-2 rounded-full bg-primary" />
  );
}
