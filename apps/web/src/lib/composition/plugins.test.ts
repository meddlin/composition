import { describe, expect, it } from "vitest";
import { DEFAULT_PLUGIN_SETTINGS, isPluginId, parsePluginSettings, PLUGINS, pluginRunsIn, validatePluginSettings } from "./plugins";

describe("plugins", () => {
  it("has every plugin on by default, so the app is unchanged until a choice is made", () => {
    expect(DEFAULT_PLUGIN_SETTINGS).toEqual({ todo: true });
    expect(PLUGINS.map(({ id }) => id)).toContain("todo");
  });

  it("reads saved settings, repairing what is missing or invalid and dropping what is unknown", () => {
    expect(parsePluginSettings({ todo: false })).toEqual({ todo: false });
    expect(parsePluginSettings({ todo: "off", other: false })).toEqual({ todo: true });
    expect(parsePluginSettings(null)).toEqual({ todo: true });
    expect(parsePluginSettings([false])).toEqual({ todo: true });
  });

  it("accepts a full set of settings from outside", () => {
    expect(validatePluginSettings({ todo: false })).toEqual({ settings: { todo: false } });
  });

  it("refuses settings that are incomplete, mistyped or about an unknown plugin", () => {
    expect(validatePluginSettings(null).error).toBeTruthy();
    expect(validatePluginSettings([]).error).toBeTruthy();
    expect(validatePluginSettings({}).error).toMatch(/To-do/);
    expect(validatePluginSettings({ todo: 1 }).error).toMatch(/To-do/);
    expect(validatePluginSettings({ todo: true, mystery: true }).error).toMatch(/mystery/);
  });

  it("knows its own ids", () => {
    expect(isPluginId("todo")).toBe(true);
    expect(isPluginId("mystery")).toBe(false);
  });

  it("says where a plugin runs", () => {
    expect(pluginRunsIn({ host: "desktop" }, "desktop")).toBe(true);
    expect(pluginRunsIn({ host: "desktop" }, "web")).toBe(false);
    expect(pluginRunsIn({ host: "any" }, "web")).toBe(true);
  });
});
