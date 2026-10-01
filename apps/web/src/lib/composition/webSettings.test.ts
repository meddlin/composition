import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT, MAX_SIDEBAR_WIDTH, MIN_EDITOR_RATIO } from "./layout";

// The default settings path is fixed from the home directory at import time, so point
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

    expect(loadWebSettings()).toEqual({
      appDataDir: "/data",
      theme: "forest",
      ...DEFAULT_LAYOUT,
      favorites: [],
    });
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

describe("web settings favorites", () => {
  it("loads saved favorites and drops malformed entries", async () => {
    writeSettings({
      appDataDir: "/data",
      favorites: [{ type: "group", id: 2 }, { type: "note", id: "x" }, null, { type: "note", id: 9 }],
    });
    const { loadWebSettings } = await import("./webSettings");

    expect(loadWebSettings().favorites).toEqual([
      { type: "group", id: 2 },
      { type: "note", id: 9 },
    ]);
  });

  it("round-trips through save and load", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    const settings = { ...loadWebSettings(), favorites: [{ type: "note" as const, id: 4 }] };

    saveWebSettings(settings);

    expect(loadWebSettings()).toEqual(settings);
  });
});

describe("settings file location", () => {
  it("uses COMPOSITION_SETTINGS_PATH, read at call time, instead of the home default", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    const custom = path.join(home, "elsewhere", "desktop-settings.json");
    vi.stubEnv("COMPOSITION_SETTINGS_PATH", custom);

    saveWebSettings({ ...loadWebSettings(), theme: "light" });

    expect(JSON.parse(fs.readFileSync(custom, "utf-8")).theme).toBe("light");
    expect(fs.existsSync(path.join(home, ".composition-web", "settings.json"))).toBe(false);
    expect(loadWebSettings().theme).toBe("light");
  });
});

describe("web settings location", () => {
  const austin = {
    name: "Austin, Texas, United States",
    latitude: 30.26715,
    longitude: -97.74306,
    timezone: "America/Chicago",
  };

  it("has no location by default", async () => {
    writeSettings({ appDataDir: "/data", theme: "auto" });
    const { loadWebSettings } = await import("./webSettings");

    expect(loadWebSettings()).not.toHaveProperty("location");
  });

  it("round-trips a saved location", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");

    saveWebSettings({ ...loadWebSettings(), theme: "auto", location: austin });

    expect(loadWebSettings()).toMatchObject({ theme: "auto", location: austin });
  });

  it.each([
    ["a missing timezone", { ...austin, timezone: "" }],
    ["a latitude off the globe", { ...austin, latitude: 91 }],
    ["a longitude off the globe", { ...austin, longitude: "west" }],
    ["a non-object", "Austin"],
  ])("ignores a stored location with %s", async (_label, location) => {
    writeSettings({ appDataDir: "/data", theme: "auto", location });
    const { loadWebSettings } = await import("./webSettings");

    expect(loadWebSettings()).not.toHaveProperty("location");
  });
});
