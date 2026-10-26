"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_WRITING_SETTINGS, type WritingSettings } from "@/lib/composition/writing";

const WritingContext = createContext<WritingSettings>(DEFAULT_WRITING_SETTINGS);

/**
 * Hands the editors in a workspace the ruler and reflow settings. They are read when the
 * workspace loads, so a change in Settings reaches the editor the next time notes are opened.
 */
export function WritingProvider({ value, children }: { value: WritingSettings; children: ReactNode }) {
  return <WritingContext.Provider value={value}>{children}</WritingContext.Provider>;
}

export function useWriting(): WritingSettings {
  return useContext(WritingContext);
}
