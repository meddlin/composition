import { describe, expect, it } from "vitest";
import { PANEL_COMMANDS, PALETTE_SHORTCUT, isPaletteShortcut, panelCommandForKey, searchPanelCommands } from "./panelCommands";

const ids = (query: string) => searchPanelCommands(query).map((command) => command.id);

/** What a key event carries, for the one key pressed with Cmd or Ctrl and Shift held (the app's own convention). */
const press = (code: string, over: Partial<KeyboardEvent> = {}) =>
  ({ code, key: "", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, repeat: false, isComposing: false, ...over }) as KeyboardEvent;

describe("the panel commands", () => {
  it("are the seven the palette offers, in the order it lists them", () => {
    expect(PANEL_COMMANDS.map((command) => command.id)).toEqual([
      "split-right",
      "split-down",
      "close-panel",
      "next-panel",
      "previous-panel",
      "move-to-new-window",
      "move-to-main-window",
    ]);
    expect(PANEL_COMMANDS.map((command) => command.label)).toEqual([
      "Split Right",
      "Split Down",
      "Close Panel",
      "Next Panel",
      "Previous Panel",
      "Move to New Window",
      "Move to Main Window",
    ]);
  });

  it("show their keys the way the shortcuts list does, and have none for the ones that are menu-only", () => {
    const keysOf = (id: string) => PANEL_COMMANDS.find((command) => command.id === id)?.shortcut?.keys;

    expect(keysOf("split-right")).toEqual(["Mod", "Shift", "\\"]);
    expect(keysOf("close-panel")).toEqual(["Mod", "Shift", "W"]);
    expect(keysOf("next-panel")).toEqual(["Mod", "Shift", "]"]);
    expect(keysOf("previous-panel")).toEqual(["Mod", "Shift", "["]);
    expect(keysOf("split-down")).toBeUndefined();
    expect(keysOf("move-to-new-window")).toBeUndefined();
    expect(keysOf("move-to-main-window")).toBeUndefined();
    expect(PALETTE_SHORTCUT.keys).toEqual(["Mod", "Shift", "P"]);
  });

  it("use no key twice", () => {
    const codes = [...PANEL_COMMANDS.flatMap((command) => (command.shortcut ? [command.shortcut.code] : [])), PALETTE_SHORTCUT.code];

    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("searching the panel commands", () => {
  it("lists all of them, in order, for an empty query", () => {
    expect(ids("")).toEqual(["split-right", "split-down", "close-panel", "next-panel", "previous-panel", "move-to-new-window", "move-to-main-window"]);
    expect(ids("   ")).toHaveLength(7);
  });

  it("finds a command by the start of a word in its name, whatever the case", () => {
    expect(ids("split")).toEqual(["split-right", "split-down"]);
    expect(ids("CLOSE")).toEqual(["close-panel"]);
    expect(ids("prev")).toEqual(["previous-panel"]);
  });

  it("finds a command by what it is about, not only what it is called", () => {
    expect(ids("pop out")).toEqual(["move-to-new-window"]);
    expect(ids("detach")).toEqual(["move-to-new-window"]);
    expect(ids("below")).toEqual(["split-down"]);
    expect(ids("bring back")).toEqual(["move-to-main-window"]);
  });

  it("needs every word to match", () => {
    expect(ids("window")).toEqual(["move-to-new-window", "move-to-main-window"]);
    expect(ids("move main")).toEqual(["move-to-main-window"]);
    expect(ids("split window")).toEqual([]);
  });

  it("finds a command by its initials or letters in order, as in other palettes", () => {
    expect(ids("sr")).toEqual(["split-right"]);
    expect(ids("sd")).toEqual(["split-down"]);
  });

  it("puts a command whose name matches before one that only has the word as a keyword", () => {
    // "right" begins a word in the name "Split Right", and is only a keyword of "Next Panel".
    expect(ids("right")[0]).toBe("split-right");
    expect(ids("right")).toContain("next-panel");
  });

  it("finds nothing for what it has no command for", () => {
    expect(ids("zebra")).toEqual([]);
  });
});

describe("a key pressed for a panel command", () => {
  it("is matched by the physical key, with Cmd or Ctrl and Shift held", () => {
    expect(panelCommandForKey(press("Backslash"))).toBe("split-right");
    expect(panelCommandForKey(press("KeyW"))).toBe("close-panel");
    expect(panelCommandForKey(press("BracketRight"))).toBe("next-panel");
    expect(panelCommandForKey(press("BracketLeft"))).toBe("previous-panel");
    expect(panelCommandForKey(press("KeyW", { metaKey: false, ctrlKey: true }))).toBe("close-panel");
  });

  it("does not depend on what character the layout types there", () => {
    expect(panelCommandForKey(press("BracketRight", { key: "}" }))).toBe("next-panel");
    expect(panelCommandForKey(press("Backslash", { key: "|" }))).toBe("split-right");
    expect(panelCommandForKey(press("KeyW", { key: "Ц" }))).toBe("close-panel");
  });

  it("is not matched without Shift, without Cmd or Ctrl, or with Alt (which AltGr types characters with)", () => {
    expect(panelCommandForKey(press("KeyW", { shiftKey: false }))).toBeNull();
    expect(panelCommandForKey(press("KeyW", { metaKey: false }))).toBeNull();
    expect(panelCommandForKey(press("KeyW", { altKey: true }))).toBeNull();
  });

  it("is not matched by a key held down, or one pressed while composing text", () => {
    expect(panelCommandForKey(press("KeyW", { repeat: true }))).toBeNull();
    expect(panelCommandForKey(press("KeyW", { isComposing: true }))).toBeNull();
  });

  it("is not matched for a key with no command, including the ones used by the note", () => {
    expect(panelCommandForKey(press("KeyL"))).toBeNull(); // the AI helper's
    expect(panelCommandForKey(press("KeyK"))).toBeNull();
    expect(panelCommandForKey(press("Backslash", { shiftKey: false }))).toBeNull(); // steps the note's view
  });
});

describe("the key for the palette", () => {
  it("is Cmd or Ctrl with Shift and P, by the physical key", () => {
    expect(isPaletteShortcut(press("KeyP"))).toBe(true);
    expect(isPaletteShortcut(press("KeyP", { metaKey: false, ctrlKey: true, key: "п" }))).toBe(true);
  });

  it("is not P alone, with Alt, held down, or any other key", () => {
    expect(isPaletteShortcut(press("KeyP", { shiftKey: false }))).toBe(false);
    expect(isPaletteShortcut(press("KeyP", { altKey: true }))).toBe(false);
    expect(isPaletteShortcut(press("KeyP", { repeat: true }))).toBe(false);
    expect(isPaletteShortcut(press("KeyO"))).toBe(false);
  });
});
