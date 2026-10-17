import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LAYOUT, MAX_SIDEBAR_WIDTH, MIN_EDITOR_RATIO } from "./layout";
import { DEFAULT_THEME } from "./themes";

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

  it("keeps the terminal app's sidebar width apart from the pixel one, and clamps it", async () => {
    const { loadWebSettings } = await import("./webSettings");
    writeSettings({ appDataDir: "/data", sidebarWidth: 320, cliSidebarColumns: 44.6 });
    expect(loadWebSettings()).toMatchObject({ sidebarWidth: 320, cliSidebarColumns: 45 });

    writeSettings({ appDataDir: "/data", cliSidebarColumns: 500 });
    expect(loadWebSettings().cliSidebarColumns).toBe(60);
    writeSettings({ appDataDir: "/data", cliSidebarColumns: "wide" });
    expect(loadWebSettings().cliSidebarColumns).toBe(34);
    writeSettings({ appDataDir: "/data" });
    expect(loadWebSettings()).not.toHaveProperty("cliSidebarColumns");
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

describe("data location shared between the desktop and terminal apps", () => {
  // Two hosts of the same code: each has its own settings file, both name the same shared file.
  const desktopSettings = () => path.join(home, "desktop", "settings.json");
  const cliSettings = () => path.join(home, "cli", "settings.json");
  const sharedFile = () => path.join(home, ".composition-location.json");

  function runAs(settingsFile: string) {
    vi.stubEnv("COMPOSITION_SETTINGS_PATH", settingsFile);
    vi.stubEnv("COMPOSITION_SHARED_LOCATION_PATH", sharedFile());
  }
  const write = (file: string, data: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  };
  const readShared = () => JSON.parse(fs.readFileSync(sharedFile(), "utf-8"));

  it("is off unless a host opts in, so the web app answers to its own settings alone", async () => {
    write(path.join(home, ".composition-web", "settings.json"), { appDataDir: "/web-data" });
    write(sharedFile(), { appDataDir: "/agreed" });
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");

    expect(loadWebSettings().appDataDir).toBe("/web-data");
    saveWebSettings({ ...loadWebSettings(), appDataDir: "/moved" });
    expect(readShared()).toEqual({ appDataDir: "/agreed" });
  });

  it("changes nothing for an install nobody has moved: each app keeps its own setting", async () => {
    write(desktopSettings(), { appDataDir: "/desktop-data", theme: "forest" });
    write(cliSettings(), { appDataDir: "/cli-data" });
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");

    runAs(desktopSettings());
    expect(loadWebSettings().appDataDir).toBe("/desktop-data");
    runAs(cliSettings());
    expect(loadWebSettings().appDataDir).toBe("/cli-data");
    // Saving something else (the color scheme) does not start an agreement either.
    saveWebSettings({ ...loadWebSettings(), theme: "dark" });
    expect(fs.existsSync(sharedFile())).toBe(false);
  });

  it("makes the other app follow a move, and only the location", async () => {
    write(desktopSettings(), { appDataDir: "/old", theme: "forest", sidebarWidth: 300 });
    write(cliSettings(), { appDataDir: "/old", theme: "dark" });
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");

    runAs(desktopSettings());
    saveWebSettings({ ...loadWebSettings(), appDataDir: "/new" });

    runAs(cliSettings());
    expect(loadWebSettings()).toMatchObject({ appDataDir: "/new", theme: "dark" });
    expect(loadWebSettings().sidebarWidth).toBe(DEFAULT_LAYOUT.sidebarWidth);
    runAs(desktopSettings());
    expect(loadWebSettings()).toMatchObject({ appDataDir: "/new", theme: "forest", sidebarWidth: 300 });
  });

  it("works in both directions", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");

    runAs(cliSettings());
    saveWebSettings({ ...loadWebSettings(), appDataDir: "/from-cli" });
    runAs(desktopSettings());
    expect(loadWebSettings().appDataDir).toBe("/from-cli");

    saveWebSettings({ ...loadWebSettings(), appDataDir: "/from-desktop" });
    runAs(cliSettings());
    expect(loadWebSettings().appDataDir).toBe("/from-desktop");
  });

  it("carries a database override, and drops it when the location is set without one", async () => {
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");

    runAs(desktopSettings());
    saveWebSettings({ ...loadWebSettings(), appDataDir: "/data", dbPath: "/elsewhere/notes.db" });
    runAs(cliSettings());
    expect(loadWebSettings()).toMatchObject({ appDataDir: "/data", dbPath: "/elsewhere/notes.db" });

    saveWebSettings({ ...loadWebSettings(), dbPath: undefined });
    runAs(desktopSettings());
    expect(loadWebSettings().dbPath).toBeUndefined();
    expect(readShared()).toEqual({ appDataDir: "/data" });
  });

  it("leaves the agreement alone when a save does not change the location", async () => {
    write(sharedFile(), { appDataDir: "/agreed" });
    write(cliSettings(), { appDataDir: "/stale", theme: "dark" });
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");

    runAs(cliSettings());
    saveWebSettings({ ...loadWebSettings(), theme: "forest" });

    expect(readShared()).toEqual({ appDataDir: "/agreed" });
    // The app's own file now agrees too, so deleting the shared file keeps this location.
    fs.rmSync(sharedFile());
    expect(loadWebSettings()).toMatchObject({ appDataDir: "/agreed", theme: "forest" });
  });

  it("ignores a shared file it cannot use", async () => {
    write(cliSettings(), { appDataDir: "/own" });
    const { loadWebSettings } = await import("./webSettings");
    runAs(cliSettings());

    for (const junk of ["not json", JSON.stringify({ appDataDir: "" }), JSON.stringify({ appDataDir: 3 }), "null"]) {
      fs.writeFileSync(sharedFile(), junk);
      expect(loadWebSettings().appDataDir).toBe("/own");
    }
  });

  it("applies to an app that has no settings file yet", async () => {
    write(sharedFile(), { appDataDir: "/agreed" });
    const { loadWebSettings } = await import("./webSettings");

    runAs(cliSettings());

    expect(loadWebSettings()).toMatchObject({ appDataDir: "/agreed", theme: DEFAULT_THEME });
  });

  it("does not announce a location it failed to save", async () => {
    write(sharedFile(), { appDataDir: "/agreed" });
    write(cliSettings(), { appDataDir: "/agreed" });
    const { loadWebSettings, saveWebSettings } = await import("./webSettings");
    runAs(cliSettings());
    const settings = { ...loadWebSettings(), appDataDir: "/attempted" };

    // The settings file's folder can't be written: a file stands where its folder would be.
    fs.rmSync(path.dirname(cliSettings()), { recursive: true });
    fs.writeFileSync(path.dirname(cliSettings()), "in the way");

    expect(() => saveWebSettings(settings)).toThrow();
    expect(readShared()).toEqual({ appDataDir: "/agreed" });
  });
});
