// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { parsePanelPrefs, resetPanelPrefs, setRailKindHidden, setShowPluginRail, toggleShowPluginRail } from "./panelPrefs";

const STORAGE_KEY = "composition.panels";
const saved = () => parsePanelPrefs(window.localStorage.getItem(STORAGE_KEY));

beforeEach(() => {
  window.localStorage.clear();
  resetPanelPrefs();
});

describe("reading the saved panel preferences", () => {
  it("gives the defaults for nothing, junk, or the wrong shapes: the rail shown, nothing hidden, the warning on", () => {
    const defaults = { warnDuplicateNotePanels: true, showPluginRail: true, hiddenRailKinds: [] };

    expect(parsePanelPrefs(null)).toEqual(defaults);
    expect(parsePanelPrefs("not json")).toEqual(defaults);
    expect(parsePanelPrefs("null")).toEqual(defaults);
    expect(parsePanelPrefs(JSON.stringify({ showPluginRail: "no", hiddenRailKinds: "rss", warnDuplicateNotePanels: 1 }))).toEqual(defaults);
  });

  it("reads preferences saved before the rail existed as they were, with the rail on", () => {
    expect(parsePanelPrefs(JSON.stringify({ warnDuplicateNotePanels: false }))).toEqual({
      warnDuplicateNotePanels: false,
      showPluginRail: true,
      hiddenRailKinds: [],
    });
  });

  it("keeps the hidden launchers it knows, once each, in the launchers' order, and drops the rest", () => {
    const raw = JSON.stringify({ hiddenRailKinds: ["rss", "ai", "rss", "note", "empty", "gone", 3, null] });

    expect(parsePanelPrefs(raw).hiddenRailKinds).toEqual(["ai", "rss"]);
  });
});

describe("the rail preferences", () => {
  it("turn the rail off and on, and are saved", () => {
    setShowPluginRail(false);
    expect(saved().showPluginRail).toBe(false);

    setShowPluginRail(true);
    expect(saved().showPluginRail).toBe(true);
  });

  it("toggle the rail", () => {
    toggleShowPluginRail();
    expect(saved().showPluginRail).toBe(false);

    toggleShowPluginRail();
    expect(saved().showPluginRail).toBe(true);
  });

  it("hide a launcher and bring it back, without touching the others or the rail itself", () => {
    setRailKindHidden("rss", true);
    setRailKindHidden("todo", true);
    expect(saved().hiddenRailKinds).toEqual(["todo", "rss"]);

    setRailKindHidden("rss", false);
    expect(saved().hiddenRailKinds).toEqual(["todo"]);
    expect(saved().showPluginRail).toBe(true);
  });

  it("hide a launcher once, however often it is asked to", () => {
    setRailKindHidden("ai", true);
    setRailKindHidden("ai", true);

    expect(saved().hiddenRailKinds).toEqual(["ai"]);
  });

  it("keep what the others saved: the warning, the rail and the hidden launchers do not undo each other", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ warnDuplicateNotePanels: false }));
    resetPanelPrefs();

    setShowPluginRail(false);
    setRailKindHidden("todo", true);

    expect(saved()).toEqual({ warnDuplicateNotePanels: false, showPluginRail: false, hiddenRailKinds: ["todo"] });
  });

  it("work when the storage cannot be written, for as long as the page is open", () => {
    const setItem = window.localStorage.setItem;
    window.localStorage.setItem = () => {
      throw new Error("full");
    };
    try {
      expect(() => setShowPluginRail(false)).not.toThrow();
    } finally {
      window.localStorage.setItem = setItem;
    }
  });
});
