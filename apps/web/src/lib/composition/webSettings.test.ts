import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT, MAX_SIDEBAR_WIDTH, MIN_EDITOR_RATIO } from "./layout";

// WEB_SETTINGS_PATH is fixed from the home directory at import time, so point
// HOME at a temp dir and import a fresh copy of the module for every test.
let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "composition-web-settings-"));
  vi.stubEnv("HOME", home);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

function writeSettings(data: unknown) {
  const file = path.join(home, ".composition-web", "settings.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

describe("web settings layout", () => {
  it("defaults the layout when there is no settings file", async () => {
    const { loadWebSettings } = await import("./webSettings");

    expect(loadWebSettings()).toMatchObject(DEFAULT_LAYOUT);
  });

  it("defaults the layout for a settings file written before it existed", async () => {
    writeSettings({ appDataDir: "/data", theme: "forest" });
    const { loadWebSettings } = await import("./webSettings");

    expect(loadWebSettings()).toEqual({ appDataDir: "/data", theme: "forest", ...DEFAULT_LAYOUT });
  });

  it("loads a saved layout", async () => {
    writeSettings({ appDataDir: "/data", theme: "dark", sidebarWidth: 320, editorRatio: 0.35 });
    const { loadWebSettings } = await import("./webSettings");

    expect(loadWebSettings()).toMatchObject({ sidebarWidth: 320, editorRatio: 0.35 });
  });

  it("clamps out-of-range values and ignores junk", async () => {
    writeSettings({ appDataDir: "/data", sidebarWidth: 99999, editorRatio: 0 });
    const { loadWebSettings } = await import("./webSettings");
    expect(loadWebSettings()).toMatchObject({
      sidebarWidth: MAX_SIDEBAR_WIDTH,
      editorRatio: MIN_EDITOR_RATIO,
    });

    writeSettings({ appDataDir: "/data", sidebarWidth: "wide", editorRatio: null });
    expect(loadWebSettings()).toMatchObject(DEFAULT_LAYOUT);
  });

  it("round-trips through save and load", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    const settings = { ...loadWebSettings(), sidebarWidth: 300, editorRatio: 0.4 };

    saveWebSettings(settings);

    expect(loadWebSettings()).toEqual(settings);
  });
});
