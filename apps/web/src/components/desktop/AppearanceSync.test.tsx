// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppearanceListener, AppearanceMessage } from "@/lib/composition/appearanceApi";
import { SUN_SETTINGS_CHANGED } from "@/components/SunThemeSync";
import { editorFontStack } from "@/lib/composition/editorFonts";
import { previewFontStack } from "@/lib/composition/previewFonts";
import { AppearanceSync } from "./AppearanceSync";

let listeners: Set<AppearanceListener>;
const unsubscribe = vi.fn();

beforeEach(() => {
  listeners = new Set();
  unsubscribe.mockClear();
  (window as unknown as { composition?: unknown }).composition = {
    onAppearance: (listener: AppearanceListener) => {
      listeners.add(listener);
      return () => {
        unsubscribe();
        listeners.delete(listener);
      };
    },
  };
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { composition?: unknown }).composition;
  const root = document.documentElement;
  root.removeAttribute("data-theme");
  root.removeAttribute("data-tone");
  root.removeAttribute("style");
});

/** Tells the window how the app looks; the note background and see-through look are the plain, opaque ones unless said. */
const tell = (appearance: Omit<AppearanceMessage, "noteBackground" | "translucent"> & Partial<Pick<AppearanceMessage, "noteBackground" | "translucent">>) =>
  listeners.forEach((listener) => listener({ noteBackground: "plain", translucent: false, ...appearance }));
const root = () => document.documentElement;

describe("AppearanceSync", () => {
  it("gives the window the color scheme and fonts it is told of", () => {
    render(<AppearanceSync />);

    tell({ theme: "forest", previewFont: "lora", editorFont: "jetbrains-mono" });

    expect(root().dataset.theme).toBe("forest");
    expect(root().style.getPropertyValue("--preview-font")).toBe(previewFontStack("lora"));
    expect(root().style.getPropertyValue("--editor-font")).toBe(editorFontStack("jetbrains-mono"));
  });

  it("gives it where it is on the sunrise and sunset ramp, when it follows the sun", () => {
    render(<AppearanceSync />);

    tell({ theme: "auto", previewFont: "default", editorFont: "default", sun: { tone: "light", autoLight: "0.65" } });

    expect(root().dataset.theme).toBe("auto");
    expect(root().dataset.tone).toBe("light");
    expect(root().style.getPropertyValue("--auto-light")).toBe("0.65");
  });

  it("tells the window's own sun sync to read the schedule again, since the scheme or the city may have changed it", () => {
    render(<AppearanceSync />);
    const heard = vi.fn();
    window.addEventListener(SUN_SETTINGS_CHANGED, heard);

    tell({ theme: "auto", previewFont: "default", editorFont: "default" });

    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(SUN_SETTINGS_CHANGED, heard);
  });

  it("stops listening when the window's page goes", () => {
    const { unmount } = render(<AppearanceSync />);

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it("does nothing outside the desktop app, where there is no bridge to listen to", () => {
    delete (window as unknown as { composition?: unknown }).composition;

    expect(() => render(<AppearanceSync />)).not.toThrow();
  });
});
