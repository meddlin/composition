"use client";

import { useEffect } from "react";
import { SUN_SETTINGS_CHANGED } from "@/components/SunThemeSync";
import type { AppearanceMessage } from "@/lib/composition/appearanceApi";
import { applyWindowOpacity } from "@/lib/composition/windowOpacity";
import { editorFontStack } from "@/lib/composition/editorFonts";
import { previewFontStack } from "@/lib/composition/previewFonts";

/** Puts how the app looks on a document, as the layout's first-paint script does (and Settings, in its own window). */
function applyAppearance(root: HTMLElement, appearance: AppearanceMessage): void {
  root.dataset.theme = appearance.theme;
  root.dataset.noteBackground = appearance.noteBackground;
  // A flag, as the layout's first-paint script sets it: present means see-through.
  if (appearance.translucent) root.dataset.translucent = "";
  else delete root.dataset.translucent;
  applyWindowOpacity(root, appearance.opacity);
  root.style.setProperty("--preview-font", previewFontStack(appearance.previewFont));
  root.style.setProperty("--editor-font", editorFontStack(appearance.editorFont));
  if (appearance.sun) {
    root.dataset.tone = appearance.sun.tone;
    root.style.setProperty("--auto-light", appearance.sun.autoLight);
  }
}

/**
 * Keeps this window looking as Settings says. The color scheme and fonts are set on the document when it is made, and by
 * Settings in the window it is in; a pop-out is another document, so the main process tells every window when one is
 * saved. (The "Follow the sun" scheme keeps moving on its own in each window; see `SunThemeSync`.)
 */
export function AppearanceSync() {
  useEffect(() => {
    return window.composition?.onAppearance((appearance) => {
      applyAppearance(document.documentElement, appearance);
      // The scheme or the city may have changed what the sun's schedule is.
      window.dispatchEvent(new Event(SUN_SETTINGS_CHANGED));
    });
  }, []);
  return null;
}
