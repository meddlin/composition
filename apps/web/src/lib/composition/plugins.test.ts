import { describe, expect, it } from "vitest";
import { DEFAULT_PLUGIN_SETTINGS, isPluginId, parsePluginSettings, PLUGINS, pluginRunsIn, validatePluginSettings } from "./plugins";

describe("plugins", () => {
  it("has the to-do list on by default, so the app is unchanged until a choice is made, and the Reading List off", () => {
    expect(DEFAULT_PLUGIN_SETTINGS).toEqual({ todo: true, "reading-list": false });
    expect(PLUGINS.map(({ id }) => id)).toEqual(["todo", "reading-list"]);
  });

  it("reads saved settings, repairing what is missing or invalid and dropping what is unknown", () => {
    expect(parsePluginSettings({ todo: false, "reading-list": true })).toEqual({ todo: false, "reading-list": true });
    expect(parsePluginSettings({ todo: "off", other: false })).toEqual({ todo: true, "reading-list": false });
    expect(parsePluginSettings(null)).toEqual({ todo: true, "reading-list": false });
    expect(parsePluginSettings([false])).toEqual({ todo: true, "reading-list": false });
  });

  it("reads a settings file from before the Reading List as having it off", () => {
    expect(parsePluginSettings({ todo: true })).toEqual({ todo: true, "reading-list": false });
    expect(parsePluginSettings({ todo: false })).toEqual({ todo: false, "reading-list": false });
  });

  it("accepts a full set of settings from outside", () => {
    expect(validatePluginSettings({ todo: false, "reading-list": true })).toEqual({ settings: { todo: false, "reading-list": true } });
  });

  it("refuses settings that are incomplete, mistyped or about an unknown plugin", () => {
    expect(validatePluginSettings(null).error).toBeTruthy();
    expect(validatePluginSettings([]).error).toBeTruthy();
    expect(validatePluginSettings({}).error).toMatch(/To-do/);
    expect(validatePluginSettings({ todo: true }).error).toMatch(/Reading List/);
    expect(validatePluginSettings({ todo: 1, "reading-list": false }).error).toMatch(/To-do/);
    expect(validatePluginSettings({ todo: true, "reading-list": false, mystery: true }).error).toMatch(/mystery/);
  });

  it("knows its own ids", () => {
    expect(isPluginId("todo")).toBe(true);
    expect(isPluginId("reading-list")).toBe(true);
    expect(isPluginId("mystery")).toBe(false);
  });

  it("says where a plugin runs", () => {
    expect(pluginRunsIn({ host: "desktop" }, "desktop")).toBe(true);
    expect(pluginRunsIn({ host: "desktop" }, "web")).toBe(false);
    expect(pluginRunsIn({ host: "any" }, "web")).toBe(true);
  });
});
