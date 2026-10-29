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
  root.removeAttribute("data-note-background");
  root.removeAttribute("data-translucent");
  root.removeAttribute("style");
});

/** Tells the window how the app looks; the note background and see-through look are the plain, opaque ones unless said. */
const tell = (appearance: Omit<AppearanceMessage, "noteBackground" | "translucent" | "opacity"> & Partial<Pick<AppearanceMessage, "noteBackground" | "translucent" | "opacity">>) =>
  listeners.forEach((listener) => listener({ noteBackground: "plain", translucent: false, opacity: 0.8, ...appearance }));
const root = () => document.documentElement;

describe("AppearanceSync", () => {
  it("gives the window the color scheme and fonts it is told of", () => {
    render(<AppearanceSync />);

    tell({ theme: "forest", previewFont: "lora", editorFont: "jetbrains-mono" });

    expect(root().dataset.theme).toBe("forest");
    expect(root().style.getPropertyValue("--preview-font")).toBe(previewFontStack("lora"));
    expect(root().style.getPropertyValue("--editor-font")).toBe(editorFontStack("jetbrains-mono"));
  });

  it("gives the window the note background it is told of", () => {
    render(<AppearanceSync />);

    tell({ theme: "dark", previewFont: "default", editorFont: "default", noteBackground: "architect" });
    expect(root().dataset.noteBackground).toBe("architect");

    tell({ theme: "dark", previewFont: "default", editorFont: "default", noteBackground: "plain" });
    expect(root().dataset.noteBackground).toBe("plain");
  });

  it("makes the window see-through, or solid again, as it is told", () => {
    render(<AppearanceSync />);

    tell({ theme: "dark", previewFont: "default", editorFont: "default", translucent: true });
    expect(root().hasAttribute("data-translucent")).toBe(true);

    tell({ theme: "dark", previewFont: "default", editorFont: "default", translucent: false });
    expect(root().hasAttribute("data-translucent")).toBe(false);
  });

  it("sets how solid the see-through fills are, as a percentage", () => {
    render(<AppearanceSync />);

    tell({ theme: "dark", previewFont: "default", editorFont: "default", translucent: true, opacity: 0.55 });
    expect(root().style.getPropertyValue("--glass-alpha")).toBe("55");
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
