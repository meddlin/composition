import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_SETTINGS, parseHomeSettings, validateHomeSettings } from "./home";

describe("parseHomeSettings", () => {
  it("defaults to the side rail, every section shown, 12 recent standard cards, opening on a note", () => {
    expect(DEFAULT_HOME_SETTINGS).toEqual({
      layout: "rail",
      sections: [
        { id: "notebooks", visible: true },
        { id: "pinned", visible: true },
        { id: "recent", visible: true },
      ],
      recentCount: 12,
      density: "standard",
      startup: "note",
      pinnedNotebooks: [],
      notebookColors: {},
      recentSort: "edited",
      recentNotebook: null,
      header: { show: true, title: "" },
    });
    expect(parseHomeSettings(undefined)).toEqual(DEFAULT_HOME_SETTINGS);
    expect(parseHomeSettings({})).toEqual(DEFAULT_HOME_SETTINGS);
  });

  it("keeps known choices and repairs unknown ones", () => {
    expect(parseHomeSettings({ layout: "strip", density: "list", startup: "home", recentCount: 24 })).toMatchObject({
      layout: "strip",
      density: "list",
      startup: "home",
      recentCount: 24,
    });
    expect(parseHomeSettings({ layout: "grid", density: "huge", startup: "never", recentCount: 10 })).toEqual(
      DEFAULT_HOME_SETTINGS,
    );
  });

  it("keeps the order and visibility of sections", () => {
    const sections = [
      { id: "recent", visible: false },
      { id: "notebooks", visible: true },
      { id: "pinned", visible: true },
    ];
    expect(parseHomeSettings({ sections }).sections).toEqual(sections);
  });

  it("drops junk and duplicate sections, and brings back any that are missing", () => {
    const parsed = parseHomeSettings({
      sections: [{ id: "recent", visible: false }, { id: "recent", visible: true }, { id: "sidebar" }, null, { id: "pinned" }],
    });
    expect(parsed.sections).toEqual([
      { id: "recent", visible: false },
      { id: "pinned", visible: true },
      { id: "notebooks", visible: true },
    ]);
  });
});

describe("parseHomeSettings: pins, colors, order and heading", () => {
  it("keeps pinned notebooks in order, once each, and drops anything that isn't a notebook id", () => {
    expect(parseHomeSettings({ pinnedNotebooks: [3, 1, 3, "2", 0, -4, 1.5, null] }).pinnedNotebooks).toEqual([3, 1]);
    expect(parseHomeSettings({ pinnedNotebooks: "all" }).pinnedNotebooks).toEqual([]);
  });

  it("keeps the colors it knows and drops the rest", () => {
    const colors = { "1": "brand", "2": "mauve", abc: "error", "0": "error", "7": "warning" };
    expect(parseHomeSettings({ notebookColors: colors }).notebookColors).toEqual({ "1": "brand", "7": "warning" });
    expect(parseHomeSettings({ notebookColors: ["brand"] }).notebookColors).toEqual({});
  });

  it("repairs the recent order and notebook", () => {
    expect(parseHomeSettings({ recentSort: "opened", recentNotebook: 4 })).toMatchObject({
      recentSort: "opened",
      recentNotebook: 4,
    });
    expect(parseHomeSettings({ recentSort: "alphabet", recentNotebook: "4" })).toMatchObject({
      recentSort: "edited",
      recentNotebook: null,
    });
  });

  it("keeps the heading, trimmed and kept to its length, and shows it unless told not to", () => {
    expect(parseHomeSettings({ header: { show: false, title: "  Hello  " } }).header).toEqual({ show: false, title: "Hello" });
    expect(parseHomeSettings({ header: { title: "x".repeat(200) } }).header).toEqual({ show: true, title: "x".repeat(80) });
    expect(parseHomeSettings({ header: { show: "no", title: 5 } }).header).toEqual({ show: true, title: "" });
  });
});

describe("validateHomeSettings", () => {
  const valid = {
    layout: "strip",
    sections: [
      { id: "pinned", visible: true },
      { id: "recent", visible: false },
      { id: "notebooks", visible: true },
    ],
    recentCount: 6,
    density: "compact",
    startup: "home",
    pinnedNotebooks: [2, 1],
    notebookColors: { "1": "success" },
    recentSort: "opened",
    recentNotebook: 2,
    header: { show: true, title: "Good morning" },
  };

  it("accepts a complete, known set of choices", () => {
    expect(validateHomeSettings(valid)).toEqual({ settings: valid });
  });

  it.each([
    ["layout", { layout: "grid" }],
    ["density", { density: "huge" }],
    ["startup", { startup: "never" }],
    ["recentCount", { recentCount: 7 }],
    ["a missing section", { sections: valid.sections.slice(1) }],
    ["a repeated section", { sections: [valid.sections[0], valid.sections[0], valid.sections[1]] }],
    ["an unknown section", { sections: [...valid.sections.slice(1), { id: "sidebar", visible: true }] }],
    ["a non-boolean visibility", { sections: valid.sections.map((s) => ({ ...s, visible: "yes" })) }],
    ["a recent order", { recentSort: "alphabet" }],
    ["a recent notebook", { recentNotebook: "2" }],
    ["pinned notebooks that aren't a list", { pinnedNotebooks: 2 }],
    ["a repeated pinned notebook", { pinnedNotebooks: [1, 1] }],
    ["a notebook color it doesn't know", { notebookColors: { "1": "mauve" } }],
    ["a color for something that isn't a notebook", { notebookColors: { abc: "brand" } }],
    ["a missing heading", { header: undefined }],
    ["a heading that is too long", { header: { show: true, title: "x".repeat(81) } }],
  ])("refuses %s", (_, change) => {
    expect(validateHomeSettings({ ...valid, ...change }).error).toBeTruthy();
  });

  it("trims the heading and lets a notebook be unpinned from the recent list", () => {
    const result = validateHomeSettings({ ...valid, recentNotebook: null, header: { show: false, title: "  Hi  " } });
    expect(result.settings).toMatchObject({ recentNotebook: null, header: { show: false, title: "Hi" } });
  });

  it("refuses anything that isn't an object of settings", () => {
    expect(validateHomeSettings(null).error).toBeTruthy();
  });
});
