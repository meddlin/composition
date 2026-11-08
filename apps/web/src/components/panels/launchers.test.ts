import { describe, expect, it } from "vitest";
import { DEFAULT_PLUGIN_SETTINGS, PLUGINS, type PluginSettings } from "@/lib/composition/plugins";
import { KINDS } from "./kinds";
import { LAUNCHERS, availableLaunchers, isKindAvailable, isLauncherKind, launcherFor } from "./launchers";

const allOn = Object.fromEntries(PLUGINS.map((plugin) => [plugin.id, true])) as PluginSettings;
const allOff = Object.fromEntries(PLUGINS.map((plugin) => [plugin.id, false])) as PluginSettings;
const kinds = (enabled: PluginSettings) => availableLaunchers(enabled).map((launcher) => launcher.kind);

describe("the launchers", () => {
  it("are every kind but the empty panel, a note and a PDF, each once, in the empty panel's order", () => {
    expect(LAUNCHERS.map((launcher) => launcher.kind)).toEqual(["notes-browser", "ai", "todo", "reading-list", "rss", "contacts"]);
    expect(Object.keys(KINDS).filter((kind) => !isLauncherKind(kind as never))).toEqual(["empty", "note", "pdf"]);
  });

  it("have a name, an icon and a way to be found in the palette", () => {
    for (const launcher of LAUNCHERS) {
      expect(launcher.label.trim()).not.toBe("");
      expect(launcher.icon).toBeTruthy();
      expect(launcher.keywords.length).toBeGreaterThan(0);
    }
  });

  it("reuse a panel of the kind that is open, except the notes browser, of which a second is the point", () => {
    expect(LAUNCHERS.filter((launcher) => launcher.reuse === "new").map((launcher) => launcher.kind)).toEqual(["notes-browser"]);
    expect(launcherFor("rss").reuse).toBe("focus");
  });
});

describe("the launchers on offer", () => {
  it("are all of them while every plugin is on", () => {
    expect(kinds(allOn)).toEqual(["notes-browser", "ai", "todo", "reading-list", "rss", "contacts"]);
  });

  it("leave out a kind whose plugin is off, and only that one", () => {
    expect(kinds({ ...allOn, rss: false })).toEqual(["notes-browser", "ai", "todo", "reading-list", "contacts"]);
    expect(kinds({ ...allOn, todo: false, "reading-list": false })).toEqual(["notes-browser", "ai", "rss", "contacts"]);
  });

  it("keep the kinds that belong to no plugin when every plugin is off", () => {
    expect(kinds(allOff)).toEqual(["notes-browser", "ai"]);
  });

  it("follow the defaults: Reading List and RSS Reader are not offered until turned on", () => {
    expect(kinds(DEFAULT_PLUGIN_SETTINGS)).toEqual(["notes-browser", "ai", "todo", "contacts"]);
  });

  it("say whether any kind is offered, the empty panel and a note always being so", () => {
    expect(isKindAvailable("note", allOff)).toBe(true);
    expect(isKindAvailable("empty", allOff)).toBe(true);
    expect(isKindAvailable("rss", allOff)).toBe(false);
    expect(isKindAvailable("rss", allOn)).toBe(true);
  });
});
