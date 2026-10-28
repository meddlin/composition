import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// window.ts imports Electron, which only exists inside the app; the color table
// is all this test needs.
vi.mock("electron", () => ({ BrowserWindow: class {}, Menu: {}, shell: {} }));

describe("THEME_BACKGROUND", () => {
  it("matches each theme's --background in the web app's stylesheet", async () => {
    const { THEME_BACKGROUND } = await import("./window");
    const css = fs.readFileSync(
      path.resolve(__dirname, "../../../web/src/app/globals.css"),
      "utf-8",
    );

    for (const [theme, color] of Object.entries(THEME_BACKGROUND)) {
      // Some blocks are selector lists: `dark` is also the :root default and, like
      // `light`, is shared with the "auto" scheme's matching tone.
      const block = new RegExp(`\\[data-theme="${theme}"\\](?:,\\s*\\[data-theme="\\w+"\\](?:\\[data-tone="\\w+"\\])?)*\\s*\\{([^}]*)\\}`).exec(css);
      expect(block, `no [data-theme="${theme}"] block in globals.css`).not.toBeNull();
      const background = /--background:\s*(#[0-9a-fA-F]{6})/.exec(block![1]);
      expect(background?.[1].toLowerCase(), theme).toBe(color);
    }
  });
});

describe("mainWindowPreferences", () => {
  it("keeps the page isolated, and keeps its timers running when the window is hidden or minimised", async () => {
    const { mainWindowPreferences } = await import("./window");

    expect(mainWindowPreferences("/app/preload.js")).toEqual({
      preload: "/app/preload.js",
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
      // The workspace's autosave timers run in this page for every window, pop-outs included: a minimised main window
      // that throttled them to about one tick a second would delay saving what is typed in a pop-out.
      backgroundThrottling: false,
    });
  });
});
